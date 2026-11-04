/**
 * Ball-by-ball match simulator. Drives "live" matches in the demo and is used
 * to generate realistic historical data. Swap this for a real data-feed
 * adapter in production – the rest of the system only sees Ball events.
 */
import type { Ball, DismissalKind, Innings, Match, Player } from '../domain/types.js';
import { createRng, pick, weighted, type Rng } from './rng.js';
import { currentBatters, inningsTotals, isLegal, scorecard } from './scoring.js';

const TEST_DECLARE_OVERS = 110;
const OUTCOMES: Record<Match['format'], Record<0 | 1 | 2 | 3 | 4 | 6 | 'W', number>> = {
  T20: { 0: 34, 1: 33, 2: 8, 3: 0.6, 4: 13, 6: 5.5, W: 4.2 },
  ODI: { 0: 47, 1: 33, 2: 7, 3: 0.6, 4: 7.5, 6: 1.8, W: 2.2 },
  TEST: { 0: 68, 1: 20, 2: 4.5, 3: 0.6, 4: 6, 6: 0.6, W: 1.6 },
};

export interface SimContext {
  player: (id: string) => Player | undefined;
  teamShort: (id: string) => string;
  now?: () => Date;
}

export type SimEvent =
  | { type: 'toss'; match: Match }
  | { type: 'ball'; match: Match; ball: Ball }
  | { type: 'innings_end'; match: Match; innings: Innings }
  | { type: 'match_end'; match: Match };

export class MatchSimulator {
  constructor(private ctx: SimContext, private rng: Rng = createRng(Date.now())) {}

  /** Advance the match by exactly one step (toss, delivery, or innings change). */
  step(m: Match): SimEvent | undefined {
    if (m.status === 'completed') return undefined;
    if (!m.toss) {
      const winnerId = pick(this.rng, m.teamIds);
      m.toss = { winnerId, decision: this.rng() < 0.6 ? 'bowl' : 'bat' };
      m.status = 'live';
      return { type: 'toss', match: m };
    }
    if (m.status === 'innings_break' || m.innings.length === 0) {
      this.startInnings(m);
      m.status = 'live';
    }
    const inn = m.innings.at(-1)!;
    const ball = this.deliver(m, inn);
    inn.balls.push(ball);
    if (this.inningsOver(m, inn)) {
      inn.closed = true;
      if (this.matchOver(m)) {
        this.finish(m);
        return { type: 'match_end', match: m };
      }
      m.status = 'innings_break';
      return { type: 'innings_end', match: m, innings: inn };
    }
    return { type: 'ball', match: m, ball };
  }

  /** Run until the match finishes (or `maxSteps`), used for seeding history. */
  run(m: Match, maxSteps = Infinity) {
    for (let i = 0; i < maxSteps && m.status !== 'completed'; i++) this.step(m);
  }

  private startInnings(m: Match) {
    const [a, b] = m.teamIds;
    const n = m.innings.length + 1;
    let batting: string;
    if (n === 1) {
      const t = m.toss!;
      batting = t.decision === 'bat' ? t.winnerId : t.winnerId === a ? b : a;
    } else {
      batting = m.innings.at(-1)!.bowlingTeamId;
    }
    const bowling = batting === a ? b : a;
    const inn: Innings = { number: n, battingTeamId: batting, bowlingTeamId: bowling, balls: [], closed: false };
    const runsFor = (team: string) => m.innings.filter((i) => i.battingTeamId === team).reduce((s, i) => s + inningsTotals(i).runs, 0);
    if (m.format !== 'TEST' && n === 2) inn.target = inningsTotals(m.innings[0]).runs + 1;
    if (m.format === 'TEST' && n === 4) inn.target = runsFor(bowling) - runsFor(batting) + 1;
    m.innings.push(inn);
  }

  private deliver(m: Match, inn: Innings): Ball {
    const xiBat = m.playingXI[inn.battingTeamId];
    const prev = inn.balls.at(-1);
    let { strikerId, nonStrikerId, bowlerId } = currentBatters(inn);
    const batted = new Set(inn.balls.flatMap((b) => [b.batterId, b.nonStrikerId]));
    const nextIn = () => {
      const id = xiBat.find((p) => !batted.has(p) && p !== strikerId && p !== nonStrikerId)!;
      batted.add(id);
      return id;
    };
    if (!prev) { strikerId = xiBat[0]; nonStrikerId = xiBat[1]; batted.add(xiBat[0]).add(xiBat[1]); }
    if (!strikerId) strikerId = nextIn();
    if (!nonStrikerId) nonStrikerId = nextIn();

    const legalSoFar = inn.balls.filter(isLegal).length;
    const over = Math.floor(legalSoFar / 6);
    const ballInOverBefore = legalSoFar % 6;
    if (!prev || ballInOverBefore === 0 && (prev.ballInOver === 6 && isLegal(prev))) bowlerId = this.chooseBowler(m, inn, prev?.bowlerId);

    const batter = this.ctx.player(strikerId)!;
    const bowler = this.ctx.player(bowlerId!)!;
    const ball: Ball = {
      seq: inn.balls.length + 1, over, ballInOver: ballInOverBefore, batterId: strikerId, nonStrikerId, bowlerId: bowler.id,
      runs: 0, commentary: '', timestamp: (this.ctx.now?.() ?? new Date()).toISOString(),
    };

    const extra = weighted(this.rng, [['none', 94], ['wide', 3.2], ['noball', 0.8], ['legbye', 1.6], ['bye', 0.4]] as const);
    if (extra === 'wide') {
      ball.extra = { kind: 'wide', runs: weighted(this.rng, [[1, 90], [2, 5], [5, 5]]) };
    } else if (extra === 'noball') {
      ball.extra = { kind: 'noball', runs: 1 };
      ball.runs = weighted(this.rng, [[0, 40], [1, 30], [4, 15], [6, 15]]);
    } else if (extra === 'legbye' || extra === 'bye') {
      ball.extra = { kind: extra, runs: weighted(this.rng, [[1, 75], [2, 10], [4, 15]]) };
    } else {
      this.outcome(m, inn, ball, batter, bowler);
    }
    if (isLegal(ball)) ball.ballInOver = ballInOverBefore + 1;
    ball.commentary = this.commentary(ball, batter, bowler);
    return ball;
  }

  private outcome(m: Match, inn: Innings, ball: Ball, batter: Player, bowler: Player) {
    const edge = (batter.batting - bowler.bowling) / 100; // -1..1
    const t = inningsTotals(inn);
    const death = m.oversPerInnings !== null && t.legalBalls >= m.oversPerInnings * 6 * 0.8;
    // Base outcome weights per format, tuned to realistic scoring & wicket rates.
    const base = OUTCOMES[m.format];
    const boundary = (1 + edge * 0.6) * (death ? 1.3 : 1);
    const table: [string, number][] = [
      ['0', base[0]], ['1', base[1]], ['2', base[2]], ['3', base[3]],
      ['4', base[4] * boundary], ['6', base[6] * boundary * (death ? 1.2 : 1)],
      ['W', base.W * (1 - edge * 0.6) * (death ? 1.25 : 1)],
    ];
    const r = weighted(this.rng, table);
    if (r !== 'W') { ball.runs = Number(r); return; }
    const fielders = m.playingXI[inn.bowlingTeamId];
    const keeper = fielders.find((id) => this.ctx.player(id)?.role === 'wicketkeeper') ?? fielders[0];
    const kind = weighted<DismissalKind>(this.rng, [['caught', 55], ['bowled', 20], ['lbw', 15], ['run out', 6], ['stumped', 4]]);
    const fielderId = kind === 'stumped' ? keeper : kind === 'caught' ? weighted(this.rng, [[keeper, 25], [bowler.id, 8], ...fielders.map((f) => [f, 6] as [string, number])]) : kind === 'run out' ? pick(this.rng, fielders) : undefined;
    let playerOutId = ball.batterId;
    if (kind === 'run out') {
      ball.runs = weighted(this.rng, [[0, 50], [1, 40], [2, 10]]);
      if (this.rng() < 0.4) playerOutId = ball.nonStrikerId;
    }
    ball.wicket = { kind, playerOutId, fielderId };
  }

  private chooseBowler(m: Match, inn: Innings, lastBowler?: string): string {
    const xi = m.playingXI[inn.bowlingTeamId];
    const players = xi.map((id) => this.ctx.player(id)!).filter((p) => p.role !== 'wicketkeeper');
    const attack = players.sort((a, b) => b.bowling - a.bowling).slice(0, 6);
    const maxOvers = m.oversPerInnings ? Math.ceil(m.oversPerInnings / 5) : Infinity;
    const sc = scorecard(inn, this.ctx.player);
    const oversBy = (id: string) => Number(sc.bowling.find((l) => l.playerId === id)?.overs.split('.')[0] ?? 0);
    const options = attack.filter((p) => p.id !== lastBowler && oversBy(p.id) < maxOvers);
    const pool = options.length ? options : players.filter((p) => p.id !== lastBowler);
    return weighted(this.rng, pool.map((p, i) => [p.id, (pool.length - i) * p.bowling] as [string, number]));
  }

  private inningsOver(m: Match, inn: Innings): boolean {
    const t = inningsTotals(inn);
    if (t.wickets >= 10) return true;
    if (inn.target && t.runs >= inn.target) return true;
    if (m.oversPerInnings && t.legalBalls >= m.oversPerInnings * 6) return true;
    if (m.format === 'TEST' && inn.number < 4 && t.legalBalls >= TEST_DECLARE_OVERS * 6) return true;
    return false;
  }

  private matchOver(m: Match): boolean {
    const last = m.innings.at(-1)!;
    if (m.format !== 'TEST') return m.innings.length >= 2;
    if (last.target && inningsTotals(last).runs >= last.target) return true;
    return m.innings.length >= 4;
  }

  private finish(m: Match) {
    m.status = 'completed';
    const short = this.ctx.teamShort;
    const total = (team: string) => m.innings.filter((i) => i.battingTeamId === team).reduce((s, i) => s + inningsTotals(i).runs, 0);
    const last = m.innings.at(-1)!;
    const lt = inningsTotals(last);
    const chaser = last.battingTeamId, defender = last.bowlingTeamId;
    if (last.target && lt.runs >= last.target) {
      m.winnerId = chaser;
      const w = 10 - lt.wickets;
      m.result = `${short(chaser)} won by ${w} wicket${w === 1 ? '' : 's'}`;
    } else if (m.format === 'TEST' && lt.wickets < 10) {
      m.result = 'Match drawn';
    } else {
      const diff = total(defender) - total(chaser);
      if (diff === 0) m.result = 'Match tied';
      else if (diff > 0) { m.winnerId = defender; m.result = `${short(defender)} won by ${diff} run${diff === 1 ? '' : 's'}`; }
      else { m.winnerId = chaser; m.result = `${short(chaser)} won by ${-diff} runs`; }
    }
    // Player of the match: best combined impact from the winning side (or anyone if no winner).
    const impact = new Map<string, number>();
    for (const inn of m.innings) {
      const sc = scorecard(inn, this.ctx.player);
      for (const l of sc.batting) impact.set(l.playerId, (impact.get(l.playerId) ?? 0) + l.runs + l.fours + l.sixes * 2);
      for (const l of sc.bowling) impact.set(l.playerId, (impact.get(l.playerId) ?? 0) + l.wickets * 25 - l.runs * 0.2);
    }
    const eligible = [...impact.entries()].filter(([id]) => !m.winnerId || this.ctx.player(id)?.teamId === m.winnerId);
    m.playerOfMatchId = eligible.sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  private commentary(b: Ball, batter: Player, bowler: Player): string {
    const r = this.rng;
    const lead = `${bowler.name.split(' ').at(-1)} to ${batter.name.split(' ').at(-1)}, `;
    if (b.wicket) {
      const out = this.ctx.player(b.wicket.playerOutId)!;
      const f = b.wicket.fielderId ? this.ctx.player(b.wicket.fielderId)?.name : undefined;
      const lines: Record<DismissalKind, string[]> = {
        bowled: ['OUT! Bowled him! Crashes into the top of off stump.', 'OUT! Through the gate and the bails go flying.'],
        caught: [`OUT! Caught by ${f}. Went for the big one and picked out the fielder.`, `OUT! Thin edge and ${f} takes it cleanly.`],
        lbw: ['OUT! Trapped in front, the finger goes up.', 'OUT! Plumb LBW, that was hitting middle.'],
        'run out': [`OUT! Run out! ${out.name} is short of the crease – ${f ?? 'a direct hit'} with the throw.`],
        stumped: [`OUT! Stumped! ${f} whips the bails off in a flash.`],
      };
      return lead + pick(r, lines[b.wicket.kind]);
    }
    if (b.extra?.kind === 'wide') return lead + pick(r, ['wide, strays down the leg side.', 'wide, too far outside off.']);
    if (b.extra?.kind === 'noball') return lead + `no ball! Overstepped. ${b.runs ? `${b.runs} off the bat as well.` : 'Free hit coming up.'}`;
    if (b.extra?.kind === 'legbye') return lead + `${b.extra.runs} leg bye${b.extra.runs > 1 ? 's' : ''}, off the pads.`;
    if (b.extra?.kind === 'bye') return lead + `${b.extra.runs} bye${b.extra.runs > 1 ? 's' : ''}, beats everyone.`;
    const text: Record<number, string[]> = {
      0: ['no run, solid defence back to the bowler.', 'dot ball, beaten outside off!', 'no run, driven straight to cover.', 'no run, left alone outside off.'],
      1: ['1 run, worked off the pads to square leg.', '1 run, dabbed to third man.', '1 run, pushed into the gap at cover.'],
      2: ['2 runs, placed into the gap and they come back for the second.', '2 runs, good running between the wickets.'],
      3: ['3 runs, chased down just inside the rope.'],
      4: ['FOUR! Cracking cover drive, races to the fence.', 'FOUR! Pulled away powerfully through mid-wicket.', 'FOUR! Edged, but it flies past slip.'],
      6: ['SIX! Launched over long-on, that is huge!', 'SIX! Picked up the length early and deposited it into the stands.', 'SIX! Effortless loft over extra cover.'],
    };
    return lead + pick(r, text[b.runs] ?? [`${b.runs} runs.`]);
  }
}

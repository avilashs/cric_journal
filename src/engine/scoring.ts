/**
 * Pure scoring functions. All derived numbers (totals, scorecards, run rates)
 * are computed from the ball-by-ball log, which keeps storage event-sourced
 * and makes the engine trivially unit-testable.
 */
import type { Ball, Innings, Match, Player } from '../domain/types.js';

export const isLegal = (b: Ball) => !b.extra || (b.extra.kind !== 'wide' && b.extra.kind !== 'noball');
export const ballTotal = (b: Ball) => b.runs + (b.extra?.runs ?? 0);
export const oversString = (legalBalls: number) => `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;

export interface InningsTotals {
  runs: number;
  wickets: number;
  legalBalls: number;
  overs: string;
  runRate: number;
  extras: { total: number; wides: number; noballs: number; byes: number; legbyes: number };
}

export function inningsTotals(inn: Innings): InningsTotals {
  let runs = 0, wickets = 0, legalBalls = 0;
  const extras = { total: 0, wides: 0, noballs: 0, byes: 0, legbyes: 0 };
  for (const b of inn.balls) {
    runs += ballTotal(b);
    if (isLegal(b)) legalBalls++;
    if (b.wicket) wickets++;
    if (b.extra) {
      extras.total += b.extra.runs;
      const key = ({ wide: 'wides', noball: 'noballs', bye: 'byes', legbye: 'legbyes' } as const)[b.extra.kind];
      extras[key] += b.extra.runs;
    }
  }
  return {
    runs, wickets, legalBalls, overs: oversString(legalBalls),
    runRate: legalBalls ? round2((runs * 6) / legalBalls) : 0,
    extras,
  };
}

export interface BattingLine {
  playerId: string; name: string; runs: number; balls: number; fours: number; sixes: number;
  strikeRate: number; dismissal: string; out: boolean; onStrike?: boolean;
}
export interface BowlingLine {
  playerId: string; name: string; overs: string; maidens: number; runs: number; wickets: number;
  economy: number; wides: number; noballs: number;
}
export interface FallOfWicket { wicket: number; score: number; over: string; playerId: string; name: string }

type PlayerLookup = (id: string) => Player | undefined;

export function scorecard(inn: Innings, lookup: PlayerLookup) {
  const nameOf = (id: string) => lookup(id)?.name ?? id;
  const bat = new Map<string, BattingLine>();
  const order: string[] = [];
  const touchBatter = (id: string) => {
    if (!bat.has(id)) {
      bat.set(id, { playerId: id, name: nameOf(id), runs: 0, balls: 0, fours: 0, sixes: 0, strikeRate: 0, dismissal: 'not out', out: false });
      order.push(id);
    }
    return bat.get(id)!;
  };
  const bowl = new Map<string, BowlingLine & { legal: number; overRuns: Map<number, number> }>();
  const touchBowler = (id: string) => {
    if (!bowl.has(id)) bowl.set(id, { playerId: id, name: nameOf(id), overs: '0.0', maidens: 0, runs: 0, wickets: 0, economy: 0, wides: 0, noballs: 0, legal: 0, overRuns: new Map() });
    return bowl.get(id)!;
  };
  const fow: FallOfWicket[] = [];
  let score = 0, legal = 0, wkts = 0;

  for (const b of inn.balls) {
    const striker = touchBatter(b.batterId);
    touchBatter(b.nonStrikerId);
    const bw = touchBowler(b.bowlerId);
    const kind = b.extra?.kind;
    if (kind !== 'wide') {
      striker.balls++;
      striker.runs += b.runs;
      if (b.runs === 4) striker.fours++;
      if (b.runs === 6) striker.sixes++;
    }
    // Byes / leg-byes are not charged to the bowler.
    const charged = b.runs + (kind === 'wide' || kind === 'noball' ? b.extra!.runs : 0);
    bw.runs += charged;
    bw.overRuns.set(b.over, (bw.overRuns.get(b.over) ?? 0) + charged);
    if (kind === 'wide') bw.wides += b.extra!.runs;
    if (kind === 'noball') bw.noballs++;
    if (isLegal(b)) { bw.legal++; legal++; }
    score += ballTotal(b);
    if (b.wicket) {
      wkts++;
      const out = touchBatter(b.wicket.playerOutId);
      out.out = true;
      out.dismissal = dismissalText(b, nameOf);
      if (b.wicket.kind !== 'run out') bw.wickets++;
      fow.push({ wicket: wkts, score, over: oversString(legal), playerId: out.playerId, name: out.name });
    }
  }

  const last = inn.balls.at(-1);
  const batting = order.map((id) => {
    const l = bat.get(id)!;
    l.strikeRate = l.balls ? round2((l.runs * 100) / l.balls) : 0;
    return l;
  });
  if (last && !inn.closed) {
    const cur = currentBatters(inn);
    for (const l of batting) if (l.playerId === cur.strikerId) l.onStrike = true;
  }
  const bowling = [...bowl.values()].map(({ legal: lb, overRuns, ...l }) => {
    // A maiden is a completed over with zero runs charged.
    const completed = new Set(inn.balls.filter((b) => b.bowlerId === l.playerId && isLegal(b) && b.ballInOver === 6).map((b) => b.over));
    l.maidens = [...completed].filter((o) => (overRuns.get(o) ?? 0) === 0).length;
    l.overs = oversString(lb);
    l.economy = lb ? round2((l.runs * 6) / lb) : 0;
    return l;
  });
  return { totals: inningsTotals(inn), batting, bowling, fallOfWickets: fow };
}

function dismissalText(b: Ball, nameOf: (id: string) => string): string {
  const w = b.wicket!;
  const bowler = nameOf(b.bowlerId);
  switch (w.kind) {
    case 'bowled': return `b ${bowler}`;
    case 'lbw': return `lbw b ${bowler}`;
    case 'caught': return w.fielderId === b.bowlerId ? `c & b ${bowler}` : `c ${nameOf(w.fielderId!)} b ${bowler}`;
    case 'stumped': return `st ${nameOf(w.fielderId!)} b ${bowler}`;
    case 'run out': return `run out (${w.fielderId ? nameOf(w.fielderId) : 'direct hit'})`;
  }
}

/** Who is at the crease after the last delivery (striker accounts for runs + over change). */
export function currentBatters(inn: Innings): { strikerId?: string; nonStrikerId?: string; bowlerId?: string } {
  const b = inn.balls.at(-1);
  if (!b) return {};
  let striker: string | undefined = b.batterId, non: string | undefined = b.nonStrikerId;
  const ran = b.extra && (b.extra.kind === 'bye' || b.extra.kind === 'legbye') ? b.extra.runs : b.extra?.kind === 'wide' ? b.extra.runs - 1 : b.runs;
  if (ran % 2 === 1) [striker, non] = [non, striker];
  if (b.wicket) {
    if (striker === b.wicket.playerOutId) striker = undefined;
    else if (non === b.wicket.playerOutId) non = undefined;
  }
  if (isLegal(b) && b.ballInOver === 6) [striker, non] = [non, striker];
  return { strikerId: striker, nonStrikerId: non, bowlerId: b.bowlerId };
}

/** Compact symbols for each ball of the most recent overs, e.g. ["1","4","W","wd"]. */
export function recentOvers(inn: Innings, count = 2): { over: number; balls: string[]; runs: number }[] {
  const byOver = new Map<number, Ball[]>();
  for (const b of inn.balls) byOver.set(b.over, [...(byOver.get(b.over) ?? []), b]);
  return [...byOver.entries()].slice(-count).map(([over, balls]) => ({
    over: over + 1,
    runs: balls.reduce((s, b) => s + ballTotal(b), 0),
    balls: balls.map(ballSymbol),
  }));
}

export function ballSymbol(b: Ball): string {
  if (b.wicket) return 'W';
  if (b.extra) {
    const tag = { wide: 'wd', noball: 'nb', bye: 'b', legbye: 'lb' }[b.extra.kind];
    const r = b.extra.kind === 'wide' || b.extra.kind === 'noball' ? b.extra.runs - 1 + b.runs : b.extra.runs;
    return r ? `${r}${tag}` : tag;
  }
  return String(b.runs);
}

/** Human-readable situation line, e.g. "IND need 34 runs in 20 balls". */
export function situation(match: Match, teamShort: (id: string) => string): string {
  if (match.status === 'upcoming') return `Starts ${new Date(match.startTime).toUTCString()}`;
  if (match.status === 'completed') return match.result ?? 'Match completed';
  const inn = match.innings.at(-1);
  if (!inn) return match.toss ? `${teamShort(match.toss.winnerId)} won the toss and opted to ${match.toss.decision}` : 'Match about to start';
  if (match.status === 'innings_break') return `Innings break · ${teamShort(match.innings.at(-1)!.bowlingTeamId)} need ${inningsTotals(inn).runs + 1} to win`;
  const t = inningsTotals(inn);
  if (inn.target && match.oversPerInnings) {
    const need = inn.target - t.runs;
    const left = match.oversPerInnings * 6 - t.legalBalls;
    return `${teamShort(inn.battingTeamId)} need ${need} run${need === 1 ? '' : 's'} in ${left} ball${left === 1 ? '' : 's'}`;
  }
  if (inn.target) return `${teamShort(inn.battingTeamId)} need ${inn.target - t.runs} runs to win`;
  if (inn.number === 1 && match.toss) return `${teamShort(match.toss.winnerId)} won the toss and opted to ${match.toss.decision}`;
  return `${teamShort(inn.battingTeamId)} batting`;
}

export function requiredRunRate(match: Match): number | undefined {
  const inn = match.innings.at(-1);
  if (!inn?.target || !match.oversPerInnings || match.status !== 'live') return undefined;
  const t = inningsTotals(inn);
  const left = match.oversPerInnings * 6 - t.legalBalls;
  return left > 0 ? round2(((inn.target - t.runs) * 6) / left) : undefined;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

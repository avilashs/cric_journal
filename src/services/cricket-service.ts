/**
 * Application service: the single façade used by the REST API, the MCP server
 * and the live engine. Keeps presentation concerns (DTO shapes) in one place.
 */
import type { Format, Match, MatchStatus, Player, Rankings } from '../domain/types.js';
import type { Repository } from '../data/repository.js';
import { currentBatters, inningsTotals, recentOvers, requiredRunRate, round2, scorecard, situation } from '../engine/scoring.js';

export class NotFoundError extends Error {
  constructor(what: string, id: string) { super(`${what} '${id}' not found`); }
}

export interface MatchQuery { status?: MatchStatus | 'recent'; format?: Format; seriesId?: string; teamId?: string; limit?: number }

export class CricketService {
  constructor(private repo: Repository) {}

  private short = (id: string) => this.repo.teamSync(id)?.shortName ?? id;

  // ---------- Matches ----------
  async listMatches(q: MatchQuery = {}) {
    let ms = await this.repo.matches();
    if (q.status === 'recent') ms = ms.filter((m) => m.status === 'completed');
    else if (q.status === 'live') ms = ms.filter((m) => m.status === 'live' || m.status === 'innings_break');
    else if (q.status) ms = ms.filter((m) => m.status === q.status);
    if (q.format) ms = ms.filter((m) => m.format === q.format);
    if (q.seriesId) ms = ms.filter((m) => m.seriesId === q.seriesId);
    if (q.teamId) ms = ms.filter((m) => m.teamIds.includes(q.teamId!));
    const rank = (m: Match) => (m.status === 'live' || m.status === 'innings_break' ? 0 : m.status === 'upcoming' ? 1 : 2);
    ms = [...ms].sort((a, b) => rank(a) - rank(b) || (a.status === 'completed' ? b.startTime.localeCompare(a.startTime) : a.startTime.localeCompare(b.startTime)));
    const out = await Promise.all(ms.map((m) => this.summary(m)));
    return q.limit ? out.slice(0, q.limit) : out;
  }

  async summary(m: Match) {
    const series = await this.repo.seriesById(m.seriesId);
    const venue = await this.repo.venue(m.venueId);
    const order = (id: string) => { const i = m.innings.findIndex((x) => x.battingTeamId === id); return i < 0 ? 99 : i; };
    return {
      id: m.id,
      title: m.title,
      series: series ? { id: series.id, name: series.name } : undefined,
      format: m.format,
      status: m.status,
      startTime: m.startTime,
      venue: venue ? `${venue.name}, ${venue.city}` : m.venueId,
      // Team that batted first is listed first, as on a scoreboard.
      teams: [...m.teamIds].sort((a, b) => order(a) - order(b)).map((id) => {
        const t = this.repo.teamSync(id)!;
        return {
          id, name: t.name, shortName: t.shortName, color: t.color,
          innings: m.innings.filter((i) => i.battingTeamId === id).map((i) => {
            const tot = inningsTotals(i);
            return { number: i.number, runs: tot.runs, wickets: tot.wickets, overs: tot.overs, live: !i.closed && m.status === 'live' };
          }),
        };
      }),
      situation: situation(m, this.short),
      result: m.result,
      winnerId: m.winnerId,
    };
  }

  async getMatch(id: string) {
    const m = await this.mustMatch(id);
    const base = await this.summary(m);
    const name = (pid?: string) => (pid ? this.repo.playerSync(pid)?.name : undefined);
    const inn = m.innings.at(-1);
    let live: unknown;
    if (inn && (m.status === 'live' || m.status === 'innings_break')) {
      const sc = scorecard(inn, (x) => this.repo.playerSync(x));
      const cur = currentBatters(inn);
      const t = sc.totals;
      const lastWkt = sc.fallOfWickets.at(-1);
      const partnershipBalls = inn.balls.slice(inn.balls.map((b) => !!b.wicket).lastIndexOf(true) + 1);
      live = {
        inningsNumber: inn.number,
        battingTeamId: inn.battingTeamId,
        score: `${t.runs}/${t.wickets}`,
        overs: t.overs,
        currentRunRate: t.runRate,
        requiredRunRate: requiredRunRate(m),
        target: inn.target,
        batters: [cur.strikerId, cur.nonStrikerId].filter(Boolean).map((pid) => ({ ...sc.batting.find((l) => l.playerId === pid)!, onStrike: pid === cur.strikerId })),
        bowler: sc.bowling.find((l) => l.playerId === cur.bowlerId),
        partnership: { runs: partnershipBalls.reduce((s, b) => s + b.runs + (b.extra?.runs ?? 0), 0), balls: partnershipBalls.filter((b) => b.extra?.kind !== 'wide').length },
        lastWicket: lastWkt ? `${lastWkt.name} ${sc.batting.find((l) => l.playerId === lastWkt.playerId)?.runs} (${sc.batting.find((l) => l.playerId === lastWkt.playerId)?.balls}) – ${lastWkt.score}/${lastWkt.wicket} in ${lastWkt.over} ov` : undefined,
        recentOvers: recentOvers(inn, 3),
      };
    }
    return {
      ...base,
      toss: m.toss ? `${this.repo.teamSync(m.toss.winnerId)?.name} won the toss and opted to ${m.toss.decision}` : undefined,
      playerOfMatch: m.playerOfMatchId ? { id: m.playerOfMatchId, name: name(m.playerOfMatchId) } : undefined,
      oversPerInnings: m.oversPerInnings,
      live,
    };
  }

  async getScorecard(id: string) {
    const m = await this.mustMatch(id);
    return {
      matchId: m.id,
      status: m.status,
      result: m.result,
      innings: m.innings.map((i) => {
        const sc = scorecard(i, (x) => this.repo.playerSync(x));
        const batted = new Set(sc.batting.map((b) => b.playerId));
        return {
          number: i.number,
          battingTeam: { id: i.battingTeamId, name: this.repo.teamSync(i.battingTeamId)?.name },
          bowlingTeam: { id: i.bowlingTeamId, name: this.repo.teamSync(i.bowlingTeamId)?.name },
          ...sc,
          yetToBat: m.playingXI[i.battingTeamId].filter((p) => !batted.has(p)).map((p) => ({ playerId: p, name: this.repo.playerSync(p)?.name })),
          target: i.target,
        };
      }),
    };
  }

  async getCommentary(id: string, opts: { limit?: number; innings?: number } = {}) {
    const m = await this.mustMatch(id);
    const items = m.innings
      .filter((i) => !opts.innings || i.number === opts.innings)
      .flatMap((i) => i.balls.map((b) => ({
        innings: i.number,
        over: `${b.over}.${b.ballInOver}`,
        runs: b.runs + (b.extra?.runs ?? 0),
        event: b.wicket ? 'wicket' : b.runs === 6 ? 'six' : b.runs === 4 ? 'four' : b.extra ? b.extra.kind : 'ball',
        text: b.commentary,
        timestamp: b.timestamp,
      })))
      .reverse();
    return { matchId: m.id, total: items.length, items: items.slice(0, Math.min(opts.limit ?? 50, 500)) };
  }

  async getSquads(id: string) {
    const m = await this.mustMatch(id);
    return m.teamIds.map((t) => ({
      team: this.repo.teamSync(t),
      playingXI: m.playingXI[t].map((p) => this.playerBrief(this.repo.playerSync(p)!)),
    }));
  }

  // ---------- Series ----------
  async listSeries() {
    const all = await this.repo.series();
    const ms = await this.repo.matches();
    return all.map((s) => {
      const sm = ms.filter((m) => m.seriesId === s.id);
      return { ...s, teams: s.teamIds.map((t) => this.repo.teamSync(t)?.name), matches: sm.length, live: sm.some((m) => m.status === 'live' || m.status === 'innings_break') };
    }).sort((a, b) => Number(b.live) - Number(a.live) || b.startDate.localeCompare(a.startDate));
  }

  async getSeries(id: string) {
    const s = await this.repo.seriesById(id);
    if (!s) throw new NotFoundError('Series', id);
    const matches = await this.listMatches({ seriesId: id });
    matches.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return { ...s, teams: s.teamIds.map((t) => this.repo.teamSync(t)), matches, pointsTable: await this.pointsTable(id) };
  }

  /** Points table with net run rate, computed from completed matches. */
  async pointsTable(seriesId: string) {
    const s = await this.repo.seriesById(seriesId);
    if (!s) throw new NotFoundError('Series', seriesId);
    const rows = new Map(s.teamIds.map((t) => [t, { teamId: t, team: this.repo.teamSync(t)?.name, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, rf: 0, bf: 0, ra: 0, ba: 0 }]));
    for (const m of (await this.repo.matches()).filter((x) => x.seriesId === seriesId && x.status === 'completed')) {
      for (const t of m.teamIds) {
        const r = rows.get(t)!;
        r.played++;
        if (!m.winnerId) { m.result === 'Match tied' ? r.tied++ : r.noResult++; r.points += 1; }
        else if (m.winnerId === t) { r.won++; r.points += 2; } else r.lost++;
      }
      for (const i of m.innings) {
        const tot = inningsTotals(i);
        // NRR convention: a side bowled out is charged its full quota of overs.
        const balls = tot.wickets >= 10 && m.oversPerInnings ? m.oversPerInnings * 6 : tot.legalBalls;
        const bat = rows.get(i.battingTeamId)!, bowl = rows.get(i.bowlingTeamId)!;
        bat.rf += tot.runs; bat.bf += balls; bowl.ra += tot.runs; bowl.ba += balls;
      }
    }
    return [...rows.values()]
      .map(({ rf, bf, ra, ba, ...r }) => ({ ...r, netRunRate: bf && ba ? round2((rf * 6) / bf - (ra * 6) / ba) : 0 }))
      .sort((a, b) => b.points - a.points || b.netRunRate - a.netRunRate);
  }

  // ---------- Teams & players ----------
  async listTeams() { return this.repo.teams(); }

  async getTeam(id: string) {
    const team = await this.repo.team(id);
    if (!team) throw new NotFoundError('Team', id);
    const squad = (await this.repo.players({ teamId: id })).map((p) => this.playerBrief(p));
    const results = await this.listMatches({ teamId: id, status: 'recent', limit: 5 });
    const fixtures = (await this.listMatches({ teamId: id, status: 'upcoming', limit: 5 }));
    return { ...team, squad, recentResults: results, upcomingFixtures: fixtures };
  }

  async listPlayers(f: { teamId?: string; role?: string; q?: string; limit?: number } = {}) {
    let ps = await this.repo.players({ teamId: f.teamId });
    if (f.role) ps = ps.filter((p) => p.role === f.role);
    if (f.q) { const q = f.q.toLowerCase(); ps = ps.filter((p) => p.name.toLowerCase().includes(q)); }
    return ps.slice(0, f.limit ?? 500).map((p) => this.playerBrief(p));
  }

  private playerBrief(p: Player) {
    return { id: p.id, name: p.name, teamId: p.teamId, team: this.repo.teamSync(p.teamId)?.shortName, role: p.role };
  }

  async getPlayer(id: string) {
    const p = await this.repo.player(id);
    if (!p) throw new NotFoundError('Player', id);
    const { batting, bowling, ...profile } = p;
    return { ...profile, team: this.repo.teamSync(p.teamId)?.name, stats: await this.careerStats(id) };
  }

  /** Career aggregates by format, derived from every match in the store. */
  async careerStats(playerId: string) {
    const fmt = new Map<Format, ReturnType<typeof emptyStats>>();
    for (const m of await this.repo.matches()) {
      if (!Object.values(m.playingXI).some((xi) => xi.includes(playerId)) || m.status === 'upcoming') continue;
      const s = fmt.get(m.format) ?? emptyStats();
      fmt.set(m.format, s);
      s.matches++;
      for (const i of m.innings) {
        const sc = scorecard(i, (x) => this.repo.playerSync(x));
        const b = sc.batting.find((l) => l.playerId === playerId);
        if (b) {
          s.innings++; s.runs += b.runs; s.balls += b.balls; s.fours += b.fours; s.sixes += b.sixes;
          if (!b.out) s.notOuts++;
          if (b.runs > s.highest) s.highest = b.runs;
          if (b.runs >= 100) s.hundreds++; else if (b.runs >= 50) s.fifties++;
        }
        const w = sc.bowling.find((l) => l.playerId === playerId);
        if (w) {
          const [o, bb] = w.overs.split('.').map(Number);
          s.ballsBowled += o * 6 + bb; s.runsConceded += w.runs; s.wickets += w.wickets;
          if (w.wickets > s.bestW || (w.wickets === s.bestW && w.runs < s.bestR)) { s.bestW = w.wickets; s.bestR = w.runs; }
        }
      }
    }
    return [...fmt.entries()].map(([format, s]) => ({
      format,
      batting: { matches: s.matches, innings: s.innings, runs: s.runs, notOuts: s.notOuts, highest: s.highest, average: s.innings - s.notOuts ? round2(s.runs / (s.innings - s.notOuts)) : null, strikeRate: s.balls ? round2((s.runs * 100) / s.balls) : null, fifties: s.fifties, hundreds: s.hundreds, fours: s.fours, sixes: s.sixes },
      bowling: { balls: s.ballsBowled, runs: s.runsConceded, wickets: s.wickets, average: s.wickets ? round2(s.runsConceded / s.wickets) : null, economy: s.ballsBowled ? round2((s.runsConceded * 6) / s.ballsBowled) : null, best: s.ballsBowled ? `${s.bestW}/${s.bestR === Infinity ? 0 : s.bestR}` : null },
    }));
  }

  // ---------- Rankings ----------
  async rankings(format: Format, category: Rankings['category']) {
    if (category === 'teams') {
      const teams = await this.repo.teams();
      const ms = (await this.repo.matches()).filter((m) => m.format === format && m.status === 'completed');
      const players = await this.repo.players();
      const rating = (t: string) => {
        const base = players.filter((p) => p.teamId === t).reduce((s, p) => s + Math.max(p.batting, p.bowling), 0) / 15;
        const wins = ms.filter((m) => m.winnerId === t).length, played = ms.filter((m) => m.teamIds.includes(t)).length;
        return Math.round(base * 1.4 + (played ? (wins / played) * 30 : 10));
      };
      return teams.map((t) => ({ teamId: t.id, name: t.name, rating: rating(t.id) })).sort((a, b) => b.rating - a.rating).map((e, i) => ({ rank: i + 1, ...e }));
    }
    const players = await this.repo.players();
    const scored = await Promise.all(players.map(async (p) => {
      const st = (await this.careerStats(p.id)).find((s) => s.format === format);
      const skill = category === 'batting' ? p.batting : p.bowling;
      const form = st ? (category === 'batting' ? st.batting.runs * 0.8 : st.bowling.wickets * 18) : 0;
      return { playerId: p.id, name: p.name, team: this.repo.teamSync(p.teamId)?.shortName, rating: Math.round(skill * 7 + form) };
    }));
    return scored.sort((a, b) => b.rating - a.rating).slice(0, 20).map((e, i) => ({ rank: i + 1, ...e }));
  }

  // ---------- News & search ----------
  async listNews(limit = 20, tag?: string) {
    const all = await this.repo.news();
    return (tag ? all.filter((n) => n.tags.includes(tag)) : all).slice(0, limit);
  }
  async getNews(id: string) {
    const n = (await this.repo.news()).find((x) => x.id === id);
    if (!n) throw new NotFoundError('Article', id);
    return n;
  }

  async search(q: string) {
    const s = q.trim().toLowerCase();
    if (!s) return { teams: [], players: [], series: [], matches: [] };
    const has = (x: string) => x.toLowerCase().includes(s);
    const teams = (await this.repo.teams()).filter((t) => has(t.name) || has(t.shortName));
    const players = (await this.repo.players()).filter((p) => has(p.name)).slice(0, 20).map((p) => this.playerBrief(p));
    const series = (await this.repo.series()).filter((x) => has(x.name));
    const matches = (await this.listMatches()).filter((m) => has(m.title) || m.teams.some((t) => has(t.name)) || has(m.series?.name ?? '')).slice(0, 20);
    return { teams, players, series, matches };
  }

  private async mustMatch(id: string) {
    const m = await this.repo.match(id);
    if (!m) throw new NotFoundError('Match', id);
    return m;
  }
}

const emptyStats = () => ({ matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0, highest: 0, fifties: 0, hundreds: 0, fours: 0, sixes: 0, ballsBowled: 0, runsConceded: 0, wickets: 0, bestW: 0, bestR: Infinity });

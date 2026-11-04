/**
 * Drives live matches: every tick, each live match advances by one delivery
 * and an update is published to subscribers (SSE clients, MCP, webhooks...).
 * In production this would be replaced by an ingestion worker consuming an
 * official scoring feed, publishing the same LiveUpdate events.
 */
import type { Repository } from '../data/repository.js';
import type { PubSub } from '../realtime/hub.js';
import { MatchSimulator } from '../engine/simulator.js';
import type { CricketService } from './cricket-service.js';

export interface LiveEngineOptions { tickMs: number; autoAdvanceFixtures: boolean; onPersist?: () => Promise<void> }

export class LiveEngine {
  private timer?: NodeJS.Timeout;
  private sim: MatchSimulator;
  constructor(private repo: Repository, private hub: PubSub, private service: CricketService, private opts: LiveEngineOptions) {
    this.sim = new MatchSimulator({ player: (id) => repo.playerSync(id), teamShort: (id) => repo.teamSync(id)?.shortName ?? id });
  }

  start() {
    if (this.timer || this.opts.tickMs <= 0) return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('[live-engine]', e)), this.opts.tickMs);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = undefined; }

  /** Advance every live (or due) match by one step. Exposed for tests. */
  async tick() {
    const now = Date.now();
    for (const m of await this.repo.matches()) {
      const due = m.status === 'upcoming' && new Date(m.startTime).getTime() <= now;
      if (!(m.status === 'live' || m.status === 'innings_break' || due)) continue;
      const ev = this.sim.step(m);
      if (!ev) continue;
      await this.repo.saveMatch(m);
      const summary = await this.service.summary(m);
      this.hub.publish({ type: ev.type, matchId: m.id, at: new Date().toISOString(), data: { summary, ball: ev.type === 'ball' ? ev.ball : undefined } });
      if (ev.type === 'match_end') await this.onMatchEnd(m.id);
    }
    await this.opts.onPersist?.();
  }

  private async onMatchEnd(matchId: string) {
    const m = (await this.repo.match(matchId))!;
    const s = await this.repo.seriesById(m.seriesId);
    const sum = await this.service.summary(m);
    await this.repo.saveNews({
      id: `report-${m.id}`,
      title: `${m.result}: ${m.title}, ${s?.name.split(',')[0] ?? ''}`,
      summary: sum.teams.map((t) => `${t.shortName} ${t.innings.map((i) => `${i.runs}/${i.wickets} (${i.overs})`).join(' & ')}`).join(', '),
      body: `${sum.situation}. Full scorecard available on the match page.`,
      tags: ['match report', m.format, ...m.teamIds],
      publishedAt: new Date().toISOString(),
      matchId: m.id,
    });
    if (!this.opts.autoAdvanceFixtures) return;
    // Demo mode: bring the next fixture of the series forward so there is always live action.
    const next = (await this.repo.matches()).filter((x) => x.seriesId === m.seriesId && x.status === 'upcoming').sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    if (next) { next.startTime = new Date(Date.now() + 60_000).toISOString(); await this.repo.saveMatch(next); }
  }
}

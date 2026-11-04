import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PubSub } from '../realtime/hub.js';
import { NotFoundError, type CricketService } from '../services/cricket-service.js';

const FORMAT = z.enum(['T20', 'ODI', 'TEST']);
const intQ = (max: number) => z.coerce.number().int().min(1).max(max).optional();

/** Wrap async handlers and map domain errors to HTTP. */
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).then((data) => { if (data !== undefined && !res.headersSent) res.json(data); }).catch(next);

export function apiRouter(svc: CricketService, hub: PubSub, version: string) {
  const r = express.Router();
  const p = (req: Request, k: string) => String(req.params[k]);

  r.get('/health', h(async () => ({ status: 'ok', version, time: new Date().toISOString() })));

  r.get('/matches', h(async (req) => {
    const q = z.object({ status: z.enum(['live', 'upcoming', 'recent', 'completed']).optional(), format: FORMAT.optional(), seriesId: z.string().optional(), teamId: z.string().optional(), limit: intQ(100) }).parse(req.query);
    return svc.listMatches(q);
  }));
  r.get('/matches/:id', h(async (req, res) => { res.set('Cache-Control', 'public, max-age=2'); return svc.getMatch(p(req, 'id')); }));
  r.get('/matches/:id/scorecard', h(async (req) => svc.getScorecard(p(req, 'id'))));
  r.get('/matches/:id/commentary', h(async (req) => {
    const q = z.object({ limit: intQ(500), innings: z.coerce.number().int().min(1).max(4).optional() }).parse(req.query);
    return svc.getCommentary(p(req, 'id'), q);
  }));
  r.get('/matches/:id/squads', h(async (req) => svc.getSquads(p(req, 'id'))));

  const sse = (topic: (req: Request) => string) => async (req: Request, res: Response) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`retry: 3000\n\n`);
    const unsub = hub.subscribe(topic(req), (u) => res.write(`event: ${u.type}\ndata: ${JSON.stringify(u)}\n\n`));
    const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
    req.on('close', () => { unsub(); clearInterval(ping); });
  };
  r.get('/matches/:id/stream', h(async (req, res) => {
    await svc.getMatch(p(req, 'id')); // 404 for unknown matches
    await sse((x) => `match:${x.params.id}`)(req, res);
  }));
  r.get('/stream', (req, res) => void sse(() => 'all')(req, res));

  r.get('/series', h(async () => svc.listSeries()));
  r.get('/series/:id', h(async (req) => svc.getSeries(p(req, 'id'))));
  r.get('/series/:id/points-table', h(async (req) => svc.pointsTable(p(req, 'id'))));

  r.get('/teams', h(async () => svc.listTeams()));
  r.get('/teams/:id', h(async (req) => svc.getTeam(p(req, 'id'))));

  r.get('/players', h(async (req) => {
    const q = z.object({ q: z.string().optional(), teamId: z.string().optional(), role: z.string().optional(), limit: intQ(500) }).parse(req.query);
    return svc.listPlayers(q);
  }));
  r.get('/players/:id', h(async (req) => svc.getPlayer(p(req, 'id'))));

  r.get('/rankings', h(async (req) => {
    const q = z.object({ format: FORMAT.default('T20'), category: z.enum(['teams', 'batting', 'bowling']).default('teams') }).parse(req.query);
    return { ...q, entries: await svc.rankings(q.format, q.category) };
  }));

  r.get('/news', h(async (req) => {
    const q = z.object({ limit: intQ(100), tag: z.string().optional() }).parse(req.query);
    return svc.listNews(q.limit, q.tag);
  }));
  r.get('/news/:id', h(async (req) => svc.getNews(p(req, 'id'))));
  r.get('/search', h(async (req) => svc.search(z.object({ q: z.string().default('') }).parse(req.query).q)));

  r.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Invalid request', issues: err.issues });
    console.error('[api]', err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return r;
}

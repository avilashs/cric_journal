/**
 * Composition root: wires repository → service → (REST API, MCP, web UI, live engine).
 * Exported as a factory so tests and alternative entrypoints (serverless, workers)
 * can build the same app.
 */
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Config } from './config.js';
import { generateDataset } from './data/seed.js';
import { InMemoryRepository, type Repository } from './data/repository.js';
import { LocalHub, type PubSub } from './realtime/hub.js';
import { CricketService } from './services/cricket-service.js';
import { LiveEngine } from './services/live-engine.js';
import { apiRouter } from './api/router.js';
import { openApiSpec } from './api/openapi.js';
import { mcpRouter } from './mcp/http.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export interface AppContext { repo: Repository; hub: PubSub; service: CricketService; engine: LiveEngine }

export async function buildContext(cfg: Config): Promise<AppContext> {
  const repo = cfg.dataFile ? await InMemoryRepository.load(cfg.dataFile, () => generateDataset(cfg.seed)) : new InMemoryRepository(generateDataset(cfg.seed));
  const hub = new LocalHub();
  const service = new CricketService(repo);
  let lastFlush = 0;
  const engine = new LiveEngine(repo, hub, service, {
    tickMs: cfg.tickMs,
    autoAdvanceFixtures: cfg.autoAdvanceFixtures,
    onPersist: async () => {
      if (repo instanceof InMemoryRepository && Date.now() - lastFlush > 10_000) { lastFlush = Date.now(); await repo.flush(); }
    },
  });
  return { repo, hub, service, engine };
}

/** Fixed-window per-client rate limiter (swap for a Redis-backed limiter when scaling out). */
function rateLimit(perMin: number, apiKeys: string[]) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.header('x-api-key');
    const trusted = key && apiKeys.includes(key);
    if (key && apiKeys.length && !trusted) return void res.status(401).json({ error: 'Invalid API key' });
    const limit = trusted ? perMin * 10 : perMin;
    const id = trusted ? `k:${key}` : `ip:${req.ip}`;
    const now = Date.now();
    const e = hits.get(id);
    const entry = !e || e.reset < now ? { n: 0, reset: now + 60_000 } : e;
    entry.n++;
    hits.set(id, entry);
    res.set({ 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(Math.max(0, limit - entry.n)), 'RateLimit-Reset': String(Math.ceil((entry.reset - now) / 1000)) });
    if (entry.n > limit) return void res.status(429).json({ error: 'Too many requests' });
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

export function createApp(ctx: AppContext, cfg: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors({ origin: cfg.corsOrigins === '*' ? '*' : cfg.corsOrigins.split(',') }));
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });

  app.get('/api/openapi.json', (_req, res) => { res.json(openApiSpec(cfg.version)); });
  app.use('/api/v1', rateLimit(cfg.rateLimitPerMin, cfg.apiKeys), apiRouter(ctx.service, ctx.hub, cfg.version));
  app.use('/mcp', mcpRouter(ctx.service, { token: cfg.mcpToken, version: cfg.version }));

  app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, path) => { if (path.endsWith('sw.js') || path.endsWith('.html')) res.set('Cache-Control', 'no-cache'); },
  }));
  app.get('/docs', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'docs.html')));
  // SPA fallback for client-side routes (/match/..., /series/..., etc).
  app.get(/^\/(?!api|mcp).*/, (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));
  return app;
}

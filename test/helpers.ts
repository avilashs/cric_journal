import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContext, createApp, type AppContext } from '../src/app.js';
import { config } from '../src/config.js';

export async function startTestServer(overrides: Partial<typeof config> = {}): Promise<{ base: string; ctx: AppContext; close: () => Promise<void> }> {
  const cfg = { ...config, tickMs: 0, dataFile: undefined, ...overrides };
  const ctx = await buildContext(cfg);
  const app = createApp(ctx, cfg);
  const server: Server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    ctx,
    close: () => new Promise((res) => { server.closeAllConnections(); server.close(() => res()); }),
  };
}

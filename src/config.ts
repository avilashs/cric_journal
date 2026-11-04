/** 12-factor configuration: everything comes from environment variables. */
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));
export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  tickMs: num(process.env.LIVE_TICK_MS, 4000),
  autoAdvanceFixtures: process.env.AUTO_ADVANCE_FIXTURES !== 'false',
  dataFile: process.env.DATA_FILE || undefined,
  seed: num(process.env.SEED, 2026),
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
  apiKeys: (process.env.API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 600),
  mcpToken: process.env.MCP_TOKEN || undefined,
  version: process.env.APP_VERSION ?? '1.0.0',
};
export type Config = typeof config;

import { config } from './config.js';
import { buildContext, createApp } from './app.js';

const ctx = await buildContext(config);
const app = createApp(ctx, config);
ctx.engine.start();

const server = app.listen(config.port, config.host, () => {
  console.log(`Cric Journal running at http://localhost:${config.port}`);
  console.log(`  Web/PWA   http://localhost:${config.port}/`);
  console.log(`  REST API  http://localhost:${config.port}/api/v1   (OpenAPI: /api/openapi.json, docs: /docs)`);
  console.log(`  MCP       http://localhost:${config.port}/mcp       (Streamable HTTP)`);
});

const shutdown = () => {
  ctx.engine.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

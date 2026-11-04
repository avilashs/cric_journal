/**
 * Stdio MCP entrypoint for desktop AI clients (Claude Desktop, IDEs, etc):
 *   node dist/mcp/stdio.js
 * Runs its own live engine so scores keep moving. Logs go to stderr only.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from '../config.js';
import { buildContext } from '../app.js';
import { createMcpServer } from './server.js';

console.log = console.error; // never write to stdout – it carries JSON-RPC
const ctx = await buildContext(config);
ctx.engine.start();
const server = createMcpServer(ctx.service, config.version);
await server.connect(new StdioServerTransport());
console.error('cric-journal MCP server running on stdio');

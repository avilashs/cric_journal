import type { Request, Response, Router } from 'express';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CricketService } from '../services/cricket-service.js';
import { createMcpServer } from './server.js';

/** Stateless Streamable HTTP MCP endpoint – horizontally scalable, no sticky sessions. */
export function mcpRouter(svc: CricketService, opts: { token?: string; version: string }): Router {
  const r = express.Router();
  r.use((req, res, next) => {
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      return;
    }
    next();
  });
  r.post('/', async (req: Request, res: Response) => {
    const server = createMcpServer(svc, opts.version);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp]', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  const notAllowed = (_: Request, res: Response) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
  r.get('/', notAllowed);
  r.delete('/', notAllowed);
  return r;
}

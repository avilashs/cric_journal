import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startTestServer } from './helpers.js';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let client: Client;
before(async () => {
  srv = await startTestServer();
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.base}/mcp`)));
});
after(async () => { await client.close(); await srv.close(); });

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
  return { data: JSON.parse(r.content[0].text), isError: r.isError };
};

test('exposes the cricket tool set', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['list_matches', 'get_match', 'get_scorecard', 'get_commentary', 'get_series', 'get_player', 'get_rankings', 'search']) assert.ok(names.includes(n), n);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
});

test('tools return live data', async () => {
  const { data: live } = await call('list_matches', { status: 'live' });
  assert.ok(live.length > 0);
  const { data: m } = await call('get_match', { matchId: live[0].id });
  assert.equal(m.id, live[0].id);
  const { data: sc } = await call('get_scorecard', { matchId: live[0].id });
  assert.ok(sc.innings.length >= 1);
  const { data: r } = await call('get_rankings', { format: 'ODI', category: 'teams' });
  assert.equal(r.length, 10);
});

test('tool errors are reported, not thrown', async () => {
  const r = await call('get_match', { matchId: 'nope' });
  assert.equal(r.isError, true);
  assert.match(r.data.error, /not found/);
});

test('resources and prompts', async () => {
  const res = await client.readResource({ uri: 'cricket://matches/live' });
  assert.ok(JSON.parse(String(res.contents[0].text)).length > 0);
  const { data: [m] } = await call('list_matches', { status: 'recent', limit: 1 });
  const one = await client.readResource({ uri: `cricket://matches/${m.id}` });
  assert.equal(JSON.parse(String(one.contents[0].text)).id, m.id);
  const p = await client.getPrompt({ name: 'match_summary', arguments: { matchId: m.id } });
  assert.match(String((p.messages[0].content as { text: string }).text), /match report/);
});

test('bearer token protects /mcp when MCP_TOKEN is set', async () => {
  const s2 = await startTestServer({ mcpToken: 'secret' });
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    assert.equal((await fetch(`${s2.base}/mcp`, { method: 'POST', headers, body })).status, 401);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s2.base}/mcp`), { requestInit: { headers: { authorization: 'Bearer secret' } } }));
    assert.ok((await c.listTools()).tools.length > 5);
    await c.close();
  } finally { await s2.close(); }
});

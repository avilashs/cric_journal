import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let srv: Awaited<ReturnType<typeof startTestServer>>;
before(async () => { srv = await startTestServer({ rateLimitPerMin: 1000 }); });
after(() => srv.close());
const get = async (p: string) => { const r = await fetch(srv.base + p); return { status: r.status, body: await r.json() as any, headers: r.headers }; };

test('health and OpenAPI spec', async () => {
  assert.equal((await get('/api/v1/health')).body.status, 'ok');
  const spec = (await get('/api/openapi.json')).body;
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/matches/{matchId}/scorecard']);
});

test('match listing, filters and detail', async () => {
  const live = (await get('/api/v1/matches?status=live')).body;
  assert.ok(live.length > 0);
  assert.ok(live.every((m: any) => m.status === 'live' || m.status === 'innings_break'));
  const odi = (await get('/api/v1/matches?format=ODI')).body;
  assert.ok(odi.every((m: any) => m.format === 'ODI'));
  const d = (await get(`/api/v1/matches/${live[0].id}`)).body;
  assert.ok(d.live.batters.length >= 1);
  assert.match(d.live.score, /^\d+\/\d+$/);
});

test('scorecard, commentary, squads', async () => {
  const [m] = (await get('/api/v1/matches?status=recent&limit=1')).body;
  const sc = (await get(`/api/v1/matches/${m.id}/scorecard`)).body;
  assert.ok(sc.innings.length >= 2);
  assert.ok(sc.innings[0].batting.length >= 2 && sc.innings[0].bowling.length >= 1);
  const c = (await get(`/api/v1/matches/${m.id}/commentary?limit=5`)).body;
  assert.equal(c.items.length, 5);
  const sq = (await get(`/api/v1/matches/${m.id}/squads`)).body;
  assert.equal(sq[0].playingXI.length, 11);
});

test('series points table, teams, players, rankings, news, search', async () => {
  const series = (await get('/api/v1/series')).body;
  const s = (await get(`/api/v1/series/${series[0].id}`)).body;
  assert.ok(Array.isArray(s.pointsTable) && s.pointsTable.length === s.teamIds.length);
  const team = (await get('/api/v1/teams/ind')).body;
  assert.equal(team.squad.length, 15);
  const p = (await get('/api/v1/players/ind-1')).body;
  assert.ok(p.stats.length >= 1);
  const r = (await get('/api/v1/rankings?format=T20&category=batting')).body;
  assert.equal(r.entries[0].rank, 1);
  assert.ok((await get('/api/v1/news?limit=3')).body.length === 3);
  assert.ok((await get('/api/v1/search?q=india')).body.teams.some((t: any) => t.id === 'ind'));
});

test('errors: 404 for unknown resources, 400 for invalid params', async () => {
  assert.equal((await get('/api/v1/matches/does-not-exist')).status, 404);
  assert.equal((await get('/api/v1/players/nobody')).status, 404);
  assert.equal((await get('/api/v1/matches?format=BASEBALL')).status, 400);
  assert.equal((await get('/api/v1/nope')).status, 404);
});

test('SSE stream delivers ball-by-ball updates', async () => {
  const [m] = (await get('/api/v1/matches?status=live')).body;
  const ctrl = new AbortController();
  const res = await fetch(`${srv.base}/api/v1/matches/${m.id}/stream`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = res.body!.getReader();
  await srv.ctx.engine.tick();
  let text = '';
  while (!text.includes('data: {')) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  const payload = JSON.parse(text.split('data: ')[1].split('\n')[0]);
  assert.equal(payload.matchId, m.id);
  assert.ok(['ball', 'toss', 'innings_end', 'match_end'].includes(payload.type));
});

test('web app shell and SPA fallback are served', async () => {
  const r = await fetch(`${srv.base}/match/anything`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<main id="app"/);
  const mf = await (await fetch(`${srv.base}/manifest.webmanifest`)).json();
  assert.equal(mf.display, 'standalone');
});

test('rate limiting returns 429 when exceeded', async () => {
  const s2 = await startTestServer({ rateLimitPerMin: 3 });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${s2.base}/api/v1/health`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  } finally { await s2.close(); }
});

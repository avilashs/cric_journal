/**
 * MCP (Model Context Protocol) server exposing cricket data to AI agents.
 * Transport-agnostic: mounted over Streamable HTTP at /mcp and also runnable
 * over stdio (see src/mcp/stdio.ts) for desktop AI clients.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CricketService } from '../services/cricket-service.js';

const FORMAT = z.enum(['T20', 'ODI', 'TEST']);
const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const RO = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(svc: CricketService, version = '1.0.0'): McpServer {
  const server = new McpServer(
    { name: 'cric-journal', version },
    { instructions: 'Cricket data: live scores, ball-by-ball commentary, scorecards, series, points tables, teams, players, career stats, rankings and news. Start with list_matches (status "live") or search.' },
  );

  const tool = <S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema, annotations: RO }, (async (args: z.infer<z.ZodObject<S>>) => {
      try { return json(await fn(args)); } catch (e) { return { ...json({ error: (e as Error).message }), isError: true }; }
    }) as never);

  tool('list_matches', 'List matches. Filter by status (live, upcoming, recent/completed), format, series or team.', {
    status: z.enum(['live', 'upcoming', 'recent', 'completed']).optional(),
    format: FORMAT.optional(), seriesId: z.string().optional(), teamId: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }, (a) => svc.listMatches(a));

  tool('get_match', 'Get a match: teams, scores, situation, and live state (batters at crease, bowler, run rates, recent overs).', { matchId: z.string() }, (a) => svc.getMatch(a.matchId));
  tool('get_scorecard', 'Full batting & bowling scorecard for every innings, with fall of wickets and extras.', { matchId: z.string() }, (a) => svc.getScorecard(a.matchId));
  tool('get_commentary', 'Ball-by-ball commentary, newest first.', { matchId: z.string(), limit: z.number().int().min(1).max(500).optional(), innings: z.number().int().min(1).max(4).optional() }, (a) => svc.getCommentary(a.matchId, a));
  tool('get_squads', 'Playing XIs for both teams in a match.', { matchId: z.string() }, (a) => svc.getSquads(a.matchId));
  tool('list_series', 'List all series / tournaments.', {}, () => svc.listSeries());
  tool('get_series', 'Series details: fixtures, results and points table.', { seriesId: z.string() }, (a) => svc.getSeries(a.seriesId));
  tool('list_teams', 'List all teams.', {}, () => svc.listTeams());
  tool('get_team', 'Team profile with squad, recent results and upcoming fixtures.', { teamId: z.string() }, (a) => svc.getTeam(a.teamId));
  tool('find_players', 'Find players by name, team or role.', { q: z.string().optional(), teamId: z.string().optional(), role: z.enum(['batter', 'bowler', 'allrounder', 'wicketkeeper']).optional(), limit: z.number().int().optional() }, (a) => svc.listPlayers(a));
  tool('get_player', 'Player profile and career batting/bowling stats by format.', { playerId: z.string() }, (a) => svc.getPlayer(a.playerId));
  tool('get_rankings', 'Rankings for a format: teams, batting or bowling.', { format: FORMAT, category: z.enum(['teams', 'batting', 'bowling']) }, (a) => svc.rankings(a.format, a.category));
  tool('list_news', 'Latest news and match reports.', { limit: z.number().int().min(1).max(50).optional(), tag: z.string().optional() }, (a) => svc.listNews(a.limit, a.tag));
  tool('search', 'Search teams, players, series and matches by keyword.', { query: z.string().min(1) }, (a) => svc.search(a.query));

  server.registerResource('live-matches', 'cricket://matches/live', { description: 'All matches currently in progress', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await svc.listMatches({ status: 'live' })) }] }));
  server.registerResource('match', new ResourceTemplate('cricket://matches/{matchId}', { list: undefined }), { description: 'A single match with live state', mimeType: 'application/json' },
    async (uri, { matchId }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await svc.getMatch(String(matchId))) }] }));

  server.registerPrompt('match_summary', { description: 'Write a short, journalist-style summary of a match', argsSchema: { matchId: z.string() } },
    async ({ matchId }) => {
      const [m, sc] = await Promise.all([svc.getMatch(matchId), svc.getScorecard(matchId)]);
      return { messages: [{ role: 'user', content: { type: 'text', text: `Write a concise 150-word match report in the style of a cricket journalist.\n\nMatch:\n${JSON.stringify(m)}\n\nScorecard:\n${JSON.stringify(sc)}` } }] };
    });

  return server;
}

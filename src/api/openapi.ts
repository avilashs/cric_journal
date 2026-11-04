/** OpenAPI 3.1 description of the public REST API (served at /api/openapi.json). */
const ref = (n: string) => ({ $ref: `#/components/parameters/${n}` });
const ok = (description: string) => ({ 200: { description, content: { 'application/json': { schema: { type: 'object' } } } }, 404: { $ref: '#/components/responses/NotFound' } });
const get = (summary: string, tags: string[], parameters: unknown[] = [], description = summary) => ({ get: { summary, tags, parameters, responses: ok(description) } });
const q = (name: string, schema: object, description: string) => ({ name, in: 'query', required: false, schema, description });

export function openApiSpec(version: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Cric Journal API', version,
      description: 'Live cricket scores, ball-by-ball commentary, scorecards, series, teams, players, rankings and news. Live updates are available as Server-Sent Events. An MCP endpoint for AI agents is available at /mcp.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Optional. Keys get higher rate limits.' } },
      parameters: {
        matchId: { name: 'matchId', in: 'path', required: true, schema: { type: 'string' } },
        seriesId: { name: 'seriesId', in: 'path', required: true, schema: { type: 'string' } },
        teamId: { name: 'teamId', in: 'path', required: true, schema: { type: 'string' } },
        playerId: { name: 'playerId', in: 'path', required: true, schema: { type: 'string' } },
        newsId: { name: 'newsId', in: 'path', required: true, schema: { type: 'string' } },
      },
      responses: { NotFound: { description: 'Resource not found', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } } },
    },
    security: [{}, { ApiKey: [] }],
    paths: {
      '/health': get('Health check', ['meta']),
      '/matches': get('List matches', ['matches'], [
        q('status', { type: 'string', enum: ['live', 'upcoming', 'recent', 'completed'] }, 'Filter by status'),
        q('format', { type: 'string', enum: ['T20', 'ODI', 'TEST'] }, 'Filter by format'),
        q('seriesId', { type: 'string' }, 'Filter by series'), q('teamId', { type: 'string' }, 'Filter by team'),
        q('limit', { type: 'integer', minimum: 1, maximum: 100 }, 'Max results'),
      ]),
      '/matches/{matchId}': get('Match details with live state', ['matches'], [ref('matchId')]),
      '/matches/{matchId}/scorecard': get('Full scorecard', ['matches'], [ref('matchId')]),
      '/matches/{matchId}/commentary': get('Ball-by-ball commentary (newest first)', ['matches'], [ref('matchId'), q('limit', { type: 'integer', maximum: 500 }, 'Max items'), q('innings', { type: 'integer' }, 'Innings number')]),
      '/matches/{matchId}/squads': get('Playing XIs', ['matches'], [ref('matchId')]),
      '/matches/{matchId}/stream': { get: { summary: 'Live updates for one match (Server-Sent Events)', tags: ['realtime'], parameters: [ref('matchId')], responses: { 200: { description: 'text/event-stream of LiveUpdate events', content: { 'text/event-stream': {} } } } } },
      '/stream': { get: { summary: 'Live updates for all matches (Server-Sent Events)', tags: ['realtime'], responses: { 200: { description: 'text/event-stream', content: { 'text/event-stream': {} } } } } },
      '/series': get('List series', ['series']),
      '/series/{seriesId}': get('Series with fixtures and points table', ['series'], [ref('seriesId')]),
      '/series/{seriesId}/points-table': get('Points table', ['series'], [ref('seriesId')]),
      '/teams': get('List teams', ['teams']),
      '/teams/{teamId}': get('Team profile, squad, results, fixtures', ['teams'], [ref('teamId')]),
      '/players': get('Find players', ['players'], [q('q', { type: 'string' }, 'Name contains'), q('teamId', { type: 'string' }, 'Team'), q('role', { type: 'string', enum: ['batter', 'bowler', 'allrounder', 'wicketkeeper'] }, 'Role')]),
      '/players/{playerId}': get('Player profile and career stats', ['players'], [ref('playerId')]),
      '/rankings': get('Rankings', ['rankings'], [q('format', { type: 'string', enum: ['T20', 'ODI', 'TEST'] }, 'Format (default T20)'), q('category', { type: 'string', enum: ['teams', 'batting', 'bowling'] }, 'Category (default teams)')]),
      '/news': get('Latest news', ['news'], [q('limit', { type: 'integer' }, 'Max items'), q('tag', { type: 'string' }, 'Tag filter')]),
      '/news/{newsId}': get('News article', ['news'], [ref('newsId')]),
      '/search': get('Search everything', ['search'], [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }]),
    },
  };
}

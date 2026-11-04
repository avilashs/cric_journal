/**
 * Storage abstraction. The app ships with an in-memory implementation
 * (optionally snapshotted to a JSON file). Implement this interface with
 * Postgres/Mongo/DynamoDB etc. to scale out without touching API or MCP code.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Match, NewsArticle, Player, Series, Team, Venue } from '../domain/types.js';
import type { Dataset } from './seed.js';

export interface Repository {
  teams(): Promise<Team[]>;
  team(id: string): Promise<Team | undefined>;
  players(filter?: { teamId?: string }): Promise<Player[]>;
  player(id: string): Promise<Player | undefined>;
  venues(): Promise<Venue[]>;
  venue(id: string): Promise<Venue | undefined>;
  series(): Promise<Series[]>;
  seriesById(id: string): Promise<Series | undefined>;
  matches(): Promise<Match[]>;
  match(id: string): Promise<Match | undefined>;
  saveMatch(m: Match): Promise<void>;
  news(): Promise<NewsArticle[]>;
  saveNews(n: NewsArticle): Promise<void>;
  /** Synchronous lookup used by the hot scoring path. */
  playerSync(id: string): Player | undefined;
  teamSync(id: string): Team | undefined;
}

export class InMemoryRepository implements Repository {
  private p: Map<string, Player>;
  private t: Map<string, Team>;
  private m: Map<string, Match>;
  constructor(private data: Dataset, private snapshotFile?: string) {
    this.p = new Map(data.players.map((x) => [x.id, x]));
    this.t = new Map(data.teams.map((x) => [x.id, x]));
    this.m = new Map(data.matches.map((x) => [x.id, x]));
  }

  static async load(file: string, fallback: () => Dataset): Promise<InMemoryRepository> {
    try {
      return new InMemoryRepository(JSON.parse(await readFile(file, 'utf8')), file);
    } catch {
      const repo = new InMemoryRepository(fallback(), file);
      await repo.flush();
      return repo;
    }
  }

  async flush() {
    if (!this.snapshotFile) return;
    await mkdir(dirname(this.snapshotFile), { recursive: true });
    await writeFile(this.snapshotFile, JSON.stringify({ ...this.data, matches: [...this.m.values()] }));
  }

  async teams() { return this.data.teams; }
  async team(id: string) { return this.t.get(id); }
  async players(f?: { teamId?: string }) { return f?.teamId ? this.data.players.filter((p) => p.teamId === f.teamId) : this.data.players; }
  async player(id: string) { return this.p.get(id); }
  async venues() { return this.data.venues; }
  async venue(id: string) { return this.data.venues.find((v) => v.id === id); }
  async series() { return this.data.series; }
  async seriesById(id: string) { return this.data.series.find((s) => s.id === id); }
  async matches() { return [...this.m.values()]; }
  async match(id: string) { return this.m.get(id); }
  async saveMatch(m: Match) { this.m.set(m.id, m); }
  async news() { return this.data.news; }
  async saveNews(n: NewsArticle) { this.data.news = [n, ...this.data.news.filter((x) => x.id !== n.id)]; }
  playerSync(id: string) { return this.p.get(id); }
  teamSync(id: string) { return this.t.get(id); }
}

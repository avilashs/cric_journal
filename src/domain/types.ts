/**
 * Core domain model. Everything else (storage, API, MCP, UI) depends on these
 * types, so they are deliberately framework-free.
 */
export type Format = 'T20' | 'ODI' | 'TEST';
export type MatchStatus = 'upcoming' | 'live' | 'innings_break' | 'completed';
export type Role = 'batter' | 'bowler' | 'allrounder' | 'wicketkeeper';
export type DismissalKind = 'bowled' | 'caught' | 'lbw' | 'run out' | 'stumped';
export type ExtraKind = 'wide' | 'noball' | 'bye' | 'legbye';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  country: string;
  color: string;
}

export interface Player {
  id: string;
  name: string;
  teamId: string;
  role: Role;
  battingStyle: 'Right-hand bat' | 'Left-hand bat';
  bowlingStyle?: string;
  born: string;
  /** Skill ratings 0-100 used by the simulator. */
  batting: number;
  bowling: number;
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  country: string;
}

export interface Series {
  id: string;
  name: string;
  format: Format;
  startDate: string;
  endDate: string;
  teamIds: string[];
}

/** A single delivery – the source of truth for every score. */
export interface Ball {
  seq: number;
  over: number; // 0-based over index
  ballInOver: number; // legal-ball index after this delivery (1..6)
  batterId: string;
  nonStrikerId: string;
  bowlerId: string;
  runs: number; // runs off the bat
  extra?: { kind: ExtraKind; runs: number };
  wicket?: { kind: DismissalKind; playerOutId: string; fielderId?: string };
  commentary: string;
  timestamp: string;
}

export interface Innings {
  number: number;
  battingTeamId: string;
  bowlingTeamId: string;
  balls: Ball[];
  closed: boolean;
  target?: number;
}

export interface Match {
  id: string;
  seriesId: string;
  title: string; // e.g. "2nd T20I"
  format: Format;
  venueId: string;
  startTime: string;
  status: MatchStatus;
  teamIds: [string, string];
  toss?: { winnerId: string; decision: 'bat' | 'bowl' };
  playingXI: Record<string, string[]>;
  innings: Innings[];
  result?: string;
  winnerId?: string;
  playerOfMatchId?: string;
  oversPerInnings: number | null; // null => unlimited (Test)
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  publishedAt: string;
  matchId?: string;
}

export interface RankingEntry {
  rank: number;
  teamId?: string;
  playerId?: string;
  rating: number;
}

export interface Rankings {
  format: Format;
  category: 'teams' | 'batting' | 'bowling';
  entries: RankingEntry[];
}

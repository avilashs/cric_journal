/**
 * Generates a self-contained, deterministic demo dataset: teams, fictional
 * players, venues, series and matches (completed / live / upcoming), with all
 * historical scores produced by the same simulator that drives live games.
 *
 * NOTE: players and match results are simulated demo data, not real records.
 */
import type { Format, Match, NewsArticle, Player, Role, Series, Team, Venue } from '../domain/types.js';
import { MatchSimulator } from '../engine/simulator.js';
import { createRng, pick, type Rng } from '../engine/rng.js';
import { inningsTotals, scorecard } from '../engine/scoring.js';

export interface Dataset {
  teams: Team[];
  players: Player[];
  venues: Venue[];
  series: Series[];
  matches: Match[];
  news: NewsArticle[];
}

const TEAMS: Team[] = [
  { id: 'ind', name: 'India', shortName: 'IND', country: 'India', color: '#1c5bd6' },
  { id: 'aus', name: 'Australia', shortName: 'AUS', country: 'Australia', color: '#e8b400' },
  { id: 'eng', name: 'England', shortName: 'ENG', country: 'England', color: '#1d3b8b' },
  { id: 'pak', name: 'Pakistan', shortName: 'PAK', country: 'Pakistan', color: '#0b6b2e' },
  { id: 'rsa', name: 'South Africa', shortName: 'RSA', country: 'South Africa', color: '#0a7a4a' },
  { id: 'nz', name: 'New Zealand', shortName: 'NZ', country: 'New Zealand', color: '#222222' },
  { id: 'sl', name: 'Sri Lanka', shortName: 'SL', country: 'Sri Lanka', color: '#1a3e8c' },
  { id: 'wi', name: 'West Indies', shortName: 'WI', country: 'West Indies', color: '#7a1630' },
  { id: 'ban', name: 'Bangladesh', shortName: 'BAN', country: 'Bangladesh', color: '#006a4e' },
  { id: 'afg', name: 'Afghanistan', shortName: 'AFG', country: 'Afghanistan', color: '#2457a6' },
];

const NAMES: Record<string, [string[], string[]]> = {
  ind: [['Arjun', 'Kabir', 'Rohan', 'Vikram', 'Aditya', 'Nikhil', 'Sameer', 'Pranav', 'Ishaan', 'Dev', 'Karan', 'Varun', 'Siddharth', 'Manav', 'Yash'], ['Mehra', 'Rathore', 'Iyengar', 'Kulkarni', 'Bhatia', 'Chauhan', 'Desai', 'Naidu', 'Saxena', 'Pillai', 'Gill', 'Bhosale', 'Trivedi', 'Kapoor', 'Menon']],
  aus: [['Lachlan', 'Cooper', 'Riley', 'Jaxon', 'Brodie', 'Hamish', 'Callum', 'Fletcher', 'Darcy', 'Toby', 'Angus', 'Flynn', 'Nate', 'Harvey', 'Zane'], ['Whitfield', 'Barrow', 'Kingsley', 'Holloway', 'Pemberton', 'Ashby', 'Calder', 'Merritt', 'Thornton', 'Rowe', 'Gilchrest', 'Langley', 'Fairbairn', 'Doyle', 'Mackay']],
  eng: [['Oliver', 'Harry', 'Alfie', 'George', 'Freddie', 'Archie', 'Theo', 'Rory', 'Ollie', 'Barnaby', 'Hugo', 'Jasper', 'Felix', 'Rupert', 'Monty'], ['Ashworth', 'Pennington', 'Brooke', 'Hartley', 'Fenwick', 'Dalton', 'Wainwright', 'Sutcliffe', 'Kirby', 'Hollis', 'Marlow', 'Radley', 'Clifton', 'Hargreaves', 'Easton']],
  pak: [['Haris', 'Usman', 'Zain', 'Fahad', 'Bilal', 'Saad', 'Hamza', 'Taimur', 'Ahsan', 'Junaid', 'Faizan', 'Rizwan', 'Daniyal', 'Shoaib', 'Irfan'], ['Qureshi', 'Malik', 'Butt', 'Siddiqui', 'Javed', 'Mirza', 'Chaudhry', 'Rana', 'Abbasi', 'Niazi', 'Khattak', 'Durrani', 'Sheikh', 'Awan', 'Lodhi']],
  rsa: [['Thabo', 'Pieter', 'Ruan', 'Sipho', 'Wian', 'Kagiso', 'Jacques', 'Lungile', 'Dewald', 'Andile', 'Morne', 'Tiaan', 'Bongani', 'Hendrik', 'Lwazi'], ['van Wyk', 'Botha', 'Nkosi', 'du Toit', 'Mokoena', 'Steyn', 'Pretorius', 'Dlamini', 'Visser', 'Jacobs', 'Ndlovu', 'Kruger', 'Mabaso', 'le Roux', 'Fourie']],
  nz: [['Tane', 'Blair', 'Finn', 'Corey', 'Mitchell', 'Logan', 'Ewan', 'Kieran', 'Rawiri', 'Bevan', 'Quinn', 'Hayden', 'Glenn', 'Sione', 'Brent'], ['Ngata', 'McAllister', 'Fraser', 'Tamihana', 'Rutherford', 'Bracewood', 'Kerr', 'Paewai', 'Lindsay', 'Hollander', 'Munro', 'Wiremu', 'Ashcroft', 'Dunbar', 'Forsyth']],
  sl: [['Kasun', 'Dinesh', 'Lahiru', 'Chamika', 'Nuwan', 'Tharindu', 'Sadeera', 'Pathum', 'Ashen', 'Dilshan', 'Kavindu', 'Isuru', 'Ravindu', 'Nimesh', 'Charith'], ['Perera', 'Fernando', 'Jayasuriya', 'Wickramasinghe', 'Bandara', 'Rathnayake', 'Gunawardena', 'Silva', 'Dissanayake', 'Herath', 'Kumara', 'Liyanage', 'Senanayake', 'Abeysekera', 'Weerasinghe']],
  wi: [['Shamar', 'Keon', 'Jermaine', 'Akeem', 'Romario', 'Devon', 'Kirk', 'Shai', 'Obed', 'Rovman', 'Kemar', 'Alzarri', 'Nkrumah', 'Brandon', 'Tevin'], ['Bascombe', 'Thorne', 'Gayle-Hart', 'Belgrave', 'Clarke', 'St. Hill', 'Mottley', 'Greaves', 'Rampersad', 'Hinds', 'Forde', 'Alleyne', 'Seecharan', 'Joseph-Lee', 'Boyce']],
  ban: [['Tanvir', 'Rakibul', 'Mahfuz', 'Shoriful', 'Afif', 'Nazmul', 'Towhid', 'Mehedi', 'Taskin', 'Liton', 'Parvez', 'Saif', 'Rishad', 'Anamul', 'Zakir'], ['Hossain', 'Rahman', 'Islam', 'Chowdhury', 'Ahmed', 'Haque', 'Sarkar', 'Mridha', 'Talukdar', 'Uddin', 'Kabir', 'Bhuiyan', 'Alam', 'Mollah', 'Sheikh']],
  afg: [['Rahmat', 'Najib', 'Farid', 'Azmat', 'Gulbadin', 'Noor', 'Ibrahim', 'Hashmat', 'Fazal', 'Karim', 'Sediq', 'Qais', 'Ikram', 'Naveen', 'Ahmad'], ['Zadran', 'Safi', 'Stanikzai', 'Omarzai', 'Ahmadzai', 'Shinwari', 'Mangal', 'Taniwal', 'Hotak', 'Ghorbandi', 'Wardak', 'Popalzai', 'Alikhil', 'Sharifi', 'Karokhel']],
};

const VENUES: Venue[] = [
  { id: 'mcg', name: 'Melbourne Cricket Ground', city: 'Melbourne', country: 'Australia' },
  { id: 'scg', name: 'Sydney Cricket Ground', city: 'Sydney', country: 'Australia' },
  { id: 'eden', name: 'Eden Gardens', city: 'Kolkata', country: 'India' },
  { id: 'wankhede', name: 'Wankhede Stadium', city: 'Mumbai', country: 'India' },
  { id: 'lords', name: "Lord's", city: 'London', country: 'England' },
  { id: 'oval', name: 'The Oval', city: 'London', country: 'England' },
  { id: 'newlands', name: 'Newlands', city: 'Cape Town', country: 'South Africa' },
  { id: 'basin', name: 'Basin Reserve', city: 'Wellington', country: 'New Zealand' },
  { id: 'gaddafi', name: 'Gaddafi Stadium', city: 'Lahore', country: 'Pakistan' },
  { id: 'premadasa', name: 'R. Premadasa Stadium', city: 'Colombo', country: 'Sri Lanka' },
  { id: 'kensington', name: 'Kensington Oval', city: 'Bridgetown', country: 'West Indies' },
  { id: 'mirpur', name: 'Shere Bangla National Stadium', city: 'Dhaka', country: 'Bangladesh' },
];

const ROLES: Role[] = ['batter', 'batter', 'batter', 'batter', 'wicketkeeper', 'allrounder', 'allrounder', 'bowler', 'bowler', 'bowler', 'bowler', 'batter', 'allrounder', 'bowler', 'wicketkeeper'];
const BOWL = ['Right-arm fast', 'Right-arm fast-medium', 'Left-arm fast', 'Right-arm offbreak', 'Right-arm legbreak', 'Slow left-arm orthodox', 'Left-arm wrist-spin'];

function makePlayers(team: Team, rng: Rng): Player[] {
  const [first, last] = NAMES[team.id];
  const lasts = [...last].sort(() => rng() - 0.5);
  return ROLES.map((role, i) => {
    const bat = role === 'batter' || role === 'wicketkeeper' ? 70 + rng() * 25 : role === 'allrounder' ? 55 + rng() * 25 : 15 + rng() * 25;
    const bowl = role === 'bowler' ? 70 + rng() * 25 : role === 'allrounder' ? 55 + rng() * 25 : 5 + rng() * 25;
    const y = 1990 + Math.floor(rng() * 14);
    return {
      id: `${team.id}-${i + 1}`,
      name: `${first[i]} ${lasts[i]}`,
      teamId: team.id,
      role,
      battingStyle: rng() < 0.7 ? 'Right-hand bat' : 'Left-hand bat',
      bowlingStyle: role === 'bowler' || role === 'allrounder' || rng() < 0.3 ? pick(rng, BOWL) : undefined,
      born: `${y}-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}`,
      batting: Math.round(bat),
      bowling: Math.round(bowl),
    } satisfies Player;
  });
}

/** Pick a sensible XI: 6 batters/keeper, 2 allrounders, 4 bowlers – in batting order. */
function pickXI(players: Player[]): string[] {
  const by = (r: Role) => players.filter((p) => p.role === r).sort((a, b) => b.batting - a.batting);
  const bat = by('batter').slice(0, 4), wk = by('wicketkeeper').slice(0, 1), ar = by('allrounder').slice(0, 2);
  const bw = players.filter((p) => p.role === 'bowler').sort((a, b) => b.bowling - a.bowling).slice(0, 4).sort((a, b) => b.batting - a.batting);
  return [...bat.slice(0, 3), ...wk, bat[3], ...ar, ...bw].map((p) => p.id);
}

const OVERS: Record<Format, number | null> = { T20: 20, ODI: 50, TEST: null };
const DAY = 86_400_000;

export function generateDataset(seed = 2026, now = new Date()): Dataset {
  const rng = createRng(seed);
  const teams = TEAMS.map((t) => ({ ...t }));
  const players = teams.flatMap((t) => makePlayers(t, rng));
  const pById = new Map(players.map((p) => [p.id, p]));
  const short = (id: string) => teams.find((t) => t.id === id)!.shortName;

  let clock = now.getTime();
  const sim = new MatchSimulator({ player: (id) => pById.get(id), teamShort: short, now: () => new Date((clock += 35_000)) }, rng);

  const d = (offsetDays: number, hourUtc = 9) => {
    const x = new Date(now.getTime() + offsetDays * DAY);
    x.setUTCHours(hourUtc, 0, 0, 0);
    return x;
  };

  type Plan = { id: string; name: string; format: Format; teams: string[]; venues: string[]; fixtures: { day: number; state: 'done' | 'live' | 'upcoming'; progress?: number }[] };
  const plans: Plan[] = [
    { id: 'ind-aus-t20-2026', name: 'India tour of Australia, T20I Series 2026', format: 'T20', teams: ['aus', 'ind'], venues: ['mcg', 'scg'],
      fixtures: [{ day: -4, state: 'done' }, { day: -2, state: 'done' }, { day: 0, state: 'live', progress: 0.62 }, { day: 2, state: 'upcoming' }, { day: 4, state: 'upcoming' }] },
    { id: 'eng-rsa-odi-2026', name: 'South Africa tour of England, ODI Series 2026', format: 'ODI', teams: ['eng', 'rsa'], venues: ['lords', 'oval'],
      fixtures: [{ day: -6, state: 'done' }, { day: -3, state: 'done' }, { day: 0, state: 'live', progress: 0.35 }, { day: 3, state: 'upcoming' }] },
    { id: 'nz-pak-test-2026', name: 'Pakistan tour of New Zealand, Test Series 2026', format: 'TEST', teams: ['nz', 'pak'], venues: ['basin'],
      fixtures: [{ day: -14, state: 'done' }, { day: -6, state: 'done' }, { day: 6, state: 'upcoming' }] },
    { id: 'asia-challenge-2026', name: 'Asia Challenge Cup 2026', format: 'T20', teams: ['sl', 'ban', 'afg', 'pak', 'ind'], venues: ['premadasa', 'mirpur'],
      fixtures: [{ day: -10, state: 'done' }, { day: -9, state: 'done' }, { day: -8, state: 'done' }, { day: -7, state: 'done' }, { day: -5, state: 'done' }, { day: 0, state: 'live', progress: 0.12 }, { day: 1, state: 'upcoming' }, { day: 5, state: 'upcoming' }] },
    { id: 'wi-sl-t20-2026', name: 'Sri Lanka tour of West Indies, T20I Series 2026', format: 'T20', teams: ['wi', 'sl'], venues: ['kensington'],
      fixtures: [{ day: -1, state: 'done' }, { day: 1, state: 'upcoming' }, { day: 3, state: 'upcoming' }] },
  ];

  const series: Series[] = [];
  const matches: Match[] = [];
  const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
  const typeName = { T20: 'T20I', ODI: 'ODI', TEST: 'Test' } as const;

  for (const p of plans) {
    const days = p.fixtures.map((f) => f.day);
    series.push({ id: p.id, name: p.name, format: p.format, teamIds: p.teams, startDate: d(Math.min(...days)).toISOString().slice(0, 10), endDate: d(Math.max(...days) + (p.format === 'TEST' ? 4 : 0)).toISOString().slice(0, 10) });
    p.fixtures.forEach((f, i) => {
      // Two-team series alternate home/away; multi-team events rotate through fixtures.
      const pairs = p.teams.length === 2 ? [[p.teams[0], p.teams[1]]] : p.teams.flatMap((a, x) => p.teams.slice(x + 1).map((b) => [a, b]));
      const [a, b] = pairs[i % pairs.length] as [string, string];
      const start = d(f.day, p.format === 'TEST' ? 0 : f.state === 'live' ? now.getUTCHours() - 2 : 8);
      const m: Match = {
        id: `${p.id}-m${i + 1}`,
        seriesId: p.id,
        title: p.teams.length === 2 ? `${ordinal(i + 1)} ${typeName[p.format]}` : `Match ${i + 1}`,
        format: p.format,
        venueId: p.venues[i % p.venues.length],
        startTime: start.toISOString(),
        status: 'upcoming',
        teamIds: [a, b],
        playingXI: { [a]: pickXI(players.filter((x) => x.teamId === a)), [b]: pickXI(players.filter((x) => x.teamId === b)) },
        innings: [],
        oversPerInnings: OVERS[p.format],
      };
      clock = start.getTime();
      if (f.state === 'done') sim.run(m);
      if (f.state === 'live') {
        const approxBalls = (m.oversPerInnings ?? 90) * 6 * 2 * 1.04;
        for (let n = Math.floor(approxBalls * (f.progress ?? 0.5)); n > 0; n--) {
          const snapshot = structuredClone(m);
          sim.step(m);
          // Keep the fixture live for the demo even if the sim would have finished early.
          if (m.status === 'completed') { Object.assign(m, snapshot); break; }
        }
      }
      matches.push(m);
    });
  }

  const news = buildNews(matches, teams, pById, series, now);
  return { teams, players, venues: VENUES.map((v) => ({ ...v })), series, matches, news };
}

function buildNews(matches: Match[], teams: Team[], players: Map<string, Player>, series: Series[], now: Date): NewsArticle[] {
  const team = (id: string) => teams.find((t) => t.id === id)!;
  const out: NewsArticle[] = [];
  for (const m of matches.filter((x) => x.status === 'completed').sort((a, b) => b.startTime.localeCompare(a.startTime))) {
    const s = series.find((x) => x.id === m.seriesId)!;
    const potm = m.playerOfMatchId ? players.get(m.playerOfMatchId) : undefined;
    const scores = m.innings.map((i) => { const t = inningsTotals(i); return `${team(i.battingTeamId).shortName} ${t.runs}/${t.wickets} (${t.overs})`; }).join(', ');
    let star = '';
    if (potm) {
      const lines = m.innings.map((i) => scorecard(i, (id) => players.get(id)));
      const r = lines.flatMap((l) => l.batting).filter((l) => l.playerId === potm.id).reduce((s, l) => s + l.runs, 0);
      const w = lines.flatMap((l) => l.bowling).filter((l) => l.playerId === potm.id).reduce((s, l) => s + l.wickets, 0);
      star = `${potm.name} was named Player of the Match${r ? ` after scoring ${r}` : ''}${r && w ? ' and' : ''}${w ? ` ${r ? '' : 'after '}taking ${w} wicket${w === 1 ? '' : 's'}` : ''}.`;
    }
    out.push({
      id: `report-${m.id}`,
      title: `${m.result}: ${m.title}, ${s.name.split(',')[0]}`,
      summary: `${scores}. ${star}`,
      body: `${team(m.teamIds[0]).name} and ${team(m.teamIds[1]).name} met in the ${m.title} of the ${s.name}. ${m.toss ? `${team(m.toss.winnerId).name} won the toss and chose to ${m.toss.decision}. ` : ''}${scores}. ${m.result}. ${star}`,
      tags: ['match report', m.format, ...m.teamIds],
      publishedAt: new Date(new Date(m.startTime).getTime() + (m.format === 'TEST' ? 4 * DAY : 5 * 3600_000)).toISOString(),
      matchId: m.id,
    });
  }
  out.push(
    { id: 'feature-powerplay', title: 'How the powerplay is reshaping T20 strategy', summary: 'Teams are front-loading aggression like never before. We look at the numbers behind the shift.', body: 'Analysis of scoring rates across the opening six overs shows batting sides taking more risks earlier...', tags: ['analysis', 'T20'], publishedAt: new Date(now.getTime() - 2 * DAY).toISOString() },
    { id: 'feature-test-future', title: 'Opinion: The Test format is in rude health', summary: 'Packed grounds and tight finishes suggest the longest format still has plenty to say.', body: 'Five-day cricket continues to produce the sport\'s most compelling narratives...', tags: ['opinion', 'TEST'], publishedAt: new Date(now.getTime() - 3 * DAY).toISOString() },
  );
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

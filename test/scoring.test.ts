import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ball, Innings, Player } from '../src/domain/types.js';
import { currentBatters, inningsTotals, recentOvers, scorecard } from '../src/engine/scoring.js';

const P = (id: string): Player => ({ id, name: id.toUpperCase(), teamId: 't', role: 'batter', battingStyle: 'Right-hand bat', born: '2000-01-01', batting: 50, bowling: 50 });
let seq = 0;
const ball = (over: number, ballInOver: number, b: Partial<Ball>): Ball => ({ seq: ++seq, over, ballInOver, batterId: 'a', nonStrikerId: 'b', bowlerId: 'x', runs: 0, commentary: '', timestamp: '', ...b });

// Over 1 (bowler x): 1, 4, wd, 0, lb1, W(bowled b), 6  -> legal balls: 6
// Over 2 (bowler y): six dots (maiden)
const inn: Innings = {
  number: 1, battingTeamId: 't', bowlingTeamId: 'u', closed: false, balls: [
    ball(0, 1, { runs: 1 }),
    ball(0, 2, { batterId: 'b', nonStrikerId: 'a', runs: 4 }),
    ball(0, 2, { batterId: 'b', nonStrikerId: 'a', extra: { kind: 'wide', runs: 1 } }),
    ball(0, 3, { batterId: 'b', nonStrikerId: 'a' }),
    ball(0, 4, { batterId: 'b', nonStrikerId: 'a', extra: { kind: 'legbye', runs: 1 } }),
    ball(0, 5, { batterId: 'a', nonStrikerId: 'b', wicket: { kind: 'bowled', playerOutId: 'a' } }),
    ball(0, 6, { batterId: 'c', nonStrikerId: 'b', runs: 6 }),
    ...[1, 2, 3, 4, 5, 6].map((i) => ball(1, i, { batterId: 'b', nonStrikerId: 'c', bowlerId: 'y' })),
  ],
};

test('innings totals include extras and count only legal balls', () => {
  const t = inningsTotals(inn);
  assert.equal(t.runs, 13);
  assert.equal(t.wickets, 1);
  assert.equal(t.legalBalls, 12);
  assert.equal(t.overs, '2.0');
  assert.deepEqual(t.extras, { total: 2, wides: 1, noballs: 0, byes: 0, legbyes: 1 });
  assert.equal(t.runRate, 6.5);
});

test('scorecard: batting figures, dismissal text, bowler not charged leg-byes, maidens', () => {
  const sc = scorecard(inn, P);
  const a = sc.batting.find((l) => l.playerId === 'a')!;
  assert.equal(a.runs, 1); assert.equal(a.balls, 2); assert.equal(a.dismissal, 'b X'); assert.equal(a.out, true);
  const b = sc.batting.find((l) => l.playerId === 'b')!;
  assert.equal(b.runs, 4); assert.equal(b.balls, 9, 'wide is not a ball faced'); assert.equal(b.fours, 1);
  const x = sc.bowling.find((l) => l.playerId === 'x')!;
  assert.equal(x.runs, 12, '1+4+wd1+6, leg-bye not charged'); assert.equal(x.wickets, 1); assert.equal(x.overs, '1.0'); assert.equal(x.maidens, 0);
  const y = sc.bowling.find((l) => l.playerId === 'y')!;
  assert.equal(y.maidens, 1); assert.equal(y.economy, 0);
  assert.deepEqual(sc.fallOfWickets.map((f) => [f.score, f.wicket, f.over]), [[7, 1, '0.5']]);
});

test('strike rotates on odd runs and at the end of an over', () => {
  const one: Innings = { ...inn, balls: [ball(0, 1, { runs: 1 })] };
  assert.equal(currentBatters(one).strikerId, 'b');
  const endOver: Innings = { ...inn, balls: [ball(0, 6, { runs: 0 })] };
  assert.equal(currentBatters(endOver).strikerId, 'b');
  const endOverSingle: Innings = { ...inn, balls: [ball(0, 6, { runs: 1 })] };
  assert.equal(currentBatters(endOverSingle).strikerId, 'a');
});

test('recent overs uses compact ball symbols', () => {
  const r = recentOvers(inn, 2);
  assert.deepEqual(r[0].balls, ['1', '4', 'wd', '0', '1lb', 'W', '6']);
  assert.equal(r[0].runs, 13);
  assert.equal(r[1].runs, 0);
});

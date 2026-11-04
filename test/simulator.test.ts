import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDataset } from '../src/data/seed.js';
import { inningsTotals } from '../src/engine/scoring.js';

const data = generateDataset(7, new Date('2026-06-01T12:00:00Z'));

test('dataset is deterministic for a given seed', () => {
  const again = generateDataset(7, new Date('2026-06-01T12:00:00Z'));
  assert.deepEqual(again.matches.map((m) => m.result), data.matches.map((m) => m.result));
});

test('every completed match obeys the laws of the format', () => {
  const completed = data.matches.filter((m) => m.status === 'completed');
  assert.ok(completed.length >= 10);
  for (const m of completed) {
    assert.ok(m.result, `${m.id} has a result`);
    assert.ok(m.playerOfMatchId);
    for (const inn of m.innings) {
      const t = inningsTotals(inn);
      assert.ok(t.wickets <= 10, `${m.id} wickets`);
      if (m.oversPerInnings) assert.ok(t.legalBalls <= m.oversPerInnings * 6, `${m.id} overs`);
      if (inn.target) assert.ok(t.runs < inn.target + 7, 'chase stops once target is reached');
      // No batter bowls to himself and no player appears for both sides.
      for (const b of inn.balls) {
        assert.ok(m.playingXI[inn.battingTeamId].includes(b.batterId));
        assert.ok(m.playingXI[inn.bowlingTeamId].includes(b.bowlerId));
        assert.notEqual(b.batterId, b.nonStrikerId);
      }
    }
    if (m.format !== 'TEST') assert.equal(m.innings.length, 2);
  }
});

test('no bowler bowls consecutive overs or exceeds the over limit', () => {
  for (const m of data.matches.filter((x) => x.format !== 'TEST')) {
    for (const inn of m.innings) {
      const byOver = new Map<number, string>();
      for (const b of inn.balls) byOver.set(b.over, b.bowlerId);
      const overs = [...byOver.entries()].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < overs.length; i++) assert.notEqual(overs[i][1], overs[i - 1][1], `${m.id} inn ${inn.number} over ${i}`);
      const count = new Map<string, number>();
      for (const [, id] of overs) count.set(id, (count.get(id) ?? 0) + 1);
      for (const c of count.values()) assert.ok(c <= m.oversPerInnings! / 5);
    }
  }
});

test('demo includes live, upcoming and completed fixtures', () => {
  const s = new Set(data.matches.map((m) => m.status));
  assert.ok(s.has('live') && s.has('upcoming') && s.has('completed'));
});

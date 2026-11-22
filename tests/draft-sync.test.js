import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotOf, nextPickOf, matchPlayer, draftState, recommend, predictAvailable, openSlots } from '../docs/advisor/js/draft-sync.js';
import { nextDelay, replaySource } from '../docs/advisor/js/draft-source.js';

const P = (id, name, side, pos, rank, extra = {}) => ({ id, name, side, pos, rank, marketRank: rank, value: 20 - rank / 10, z: { [`${side}:K`]: 0.5 }, ...extra });

test('蛇形順位', () => {
  assert.deepEqual(slotOf(1), { round: 1, slot: 1 });
  assert.deepEqual(slotOf(12), { round: 1, slot: 12 });
  assert.deepEqual(slotOf(13), { round: 2, slot: 12 });
  assert.deepEqual(slotOf(24), { round: 2, slot: 1 });
  assert.equal(nextPickOf(5, 1), 5);
  assert.equal(nextPickOf(5, 6), 20); // 第 2 輪：13 是第 12 順位 … 20 是第 5 順位
  assert.equal(nextPickOf(1, 13), 24);
});

test('名字對應：Ohtani 打者／投手、同名選市場排名前面的', () => {
  const board = [P(1, 'Shohei Ohtani', 'B', 'DH', 3), P(1, 'Shohei Ohtani', 'P', 'SP', 60), P(2, 'Max Muncy', 'B', '3B', 80), P(3, 'Max Muncy', 'B', 'SS', 400)];
  assert.equal(matchPlayer('Shohei Ohtani (Pitcher)', board).side, 'P');
  assert.equal(matchPlayer('Shohei Ohtani (Batter)', board).side, 'B');
  assert.equal(matchPlayer('Max Muncy', board).id, 2);
  assert.equal(matchPlayer('Nobody Here', board), null);
});

test('還差幾順位：第 1 輪選過就自動知道順位', () => {
  const board = Array.from({ length: 40 }, (_, i) => P(i + 1, `Guy ${i + 1}`, 'B', 'OF', i + 1));
  const picks = Array.from({ length: 7 }, (_, i) => ({ overall: i + 1, round: 1, pick: i + 1, name: `Guy ${i + 1}`, team: i === 4 ? '我隊' : `隊${i}` }));
  const s = draftState({ picks, board, myTeam: '我隊' });
  assert.equal(s.slot, 5);
  assert.equal(s.nextOverall, 8);
  assert.equal(s.myNext, 20);
  assert.equal(s.picksUntil, 12);
  assert.equal(s.mine.length, 1);
  // 還沒選過：用手動設定的順位
  const s2 = draftState({ picks: picks.slice(0, 2), board, myTeam: '我隊', mySlot: 5 });
  assert.equal(s2.picksUntil, 2);
});

test('推薦：最後幾輪只推補得上空格的人', () => {
  const board = [P(1, 'A', 'B', 'OF', 1), P(2, 'B', 'P', 'SP', 2), P(3, 'Catcher', 'B', 'C', 300)];
  const mine = [];
  // 只剩 1 次選擇，但空格很多 → 一定要能補空格（三人都能補，正常排序）
  const r = recommend({ board, takenIds: new Set(), myPlayers: mine, myPicksLeft: 30 });
  assert.equal(r.length, 3);
  assert.ok(r[0].reasons.some((x) => x.startsWith('補先發空缺')));
  assert.ok(openSlots([]).length === 23);
});

test('預測下一輪：照市場排名被搶走', () => {
  const board = Array.from({ length: 10 }, (_, i) => P(i + 1, `G${i}`, 'B', 'OF', i + 1));
  const { stay, gone } = predictAvailable({ board, takenIds: new Set([1]), k: 3 });
  assert.deepEqual(gone.map((p) => p.id), [2, 3, 4]);
  assert.equal(stay[0].id, 5);
});

test('輪詢間隔與退避', () => {
  assert.equal(nextDelay({ picksUntil: 10 }), 45000);
  assert.equal(nextDelay({ picksUntil: 2 }), 10000);
  assert.equal(nextDelay({ picksUntil: 2, errors: 2 }), 40000);
  assert.equal(nextDelay({ picksUntil: 2, errors: 9 }), 120000);
  assert.equal(nextDelay({ rateLimited: true }), 120000);
});

test('練習重播：照時間放出', async () => {
  const picks = Array.from({ length: 5 }, (_, i) => ({ overall: i + 1, name: `p${i}` }));
  const src = replaySource(picks, { secondsPerPick: 1, startAt: 3 });
  assert.equal((await src.poll()).picks.length, 3);
  src.pause();
  assert.equal(src.paused, true);
});

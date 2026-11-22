// 預測混合、Marcel、備註（不連網，用假資料）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProjections, marcel, annotate } from '../docs/advisor/js/projections.js';

const bat = (pa, hr, ops, extra = {}) => ({ plateAppearances: pa, atBats: pa * 0.9, runs: pa * 0.14, hits: pa * 0.24, homeRuns: hr, rbi: pa * 0.14, stolenBases: 5, baseOnBalls: pa * 0.1, strikeOuts: pa * 0.22, ops, gamesPlayed: Math.round(pa / 4.2), age: 28, ...extra });
const maps = (hit) => ({ hit: new Map(Object.entries(hit).map(([id, st]) => [Number(id), { id: Number(id), name: `P${id}`, pos: 'OF', team: 'T', stat: st }])), pit: new Map() });

test('受傷那年出賽少：出賽量用預測的，不重複扣分', () => {
  const actual = maps({ 1: bat(280, 24, '.990') }); // 只打了 280 打席，但打得很好
  const proj = { hit: new Map([[1, { name: 'P1', pos: 'OF', stat: bat(630, 42, 0.97) }]]), pit: new Map(), sources: ['projectedRos'] };
  const out = withProjections(actual, proj, [actual, null, null]);
  const st = out.hit.get(1).stat;
  assert.equal(st.plateAppearances, 630);
  assert.ok(st.homeRuns > 42, `全壘打應該依效率放大到整季，實際 ${st.homeRuns}`);
  assert.equal(out.src.get('hit1'), '預測');
});

test('樣本很小的實際成績幾乎不影響預測', () => {
  const actual = maps({ 2: bat(20, 5, '1.500') }); // 20 打席 5 支全壘打
  const proj = { hit: new Map([[2, { name: 'P2', pos: 'OF', stat: bat(500, 15, 0.72) }]]), pit: new Map(), sources: ['x'] };
  const st = withProjections(actual, proj, [actual, null, null]).hit.get(2).stat;
  assert.ok(st.homeRuns < 20, `不該被 20 打席帶飛，實際 ${st.homeRuns}`);
});

test('沒有官方預測 → Marcel；沒有任何資料 → null', () => {
  const y = maps({ 3: bat(600, 30, '.850'), 9: bat(600, 20, '.750') });
  const st = marcel([y, y, null], 3, 'hit');
  assert.ok(st.plateAppearances > 400 && st.plateAppearances < 600);
  assert.ok(st.homeRuns > 20 && st.homeRuns < 30, '往聯盟平均拉回');
  assert.equal(marcel([y, null, null], 99, 'hit'), null);
  const out = withProjections(y, null, [y, y, null]);
  assert.equal(out.src.get('hit3'), 'Marcel');
});

test('備註：傷兵與運氣', () => {
  const ps = annotate([{ id: 5, side: 'B' }, { id: 6, side: 'P', IP: 100, ER: 30 }], {
    luck: new Map([['B5', { diff: 0.04 }], ['P6', { xfip: 4.2 }]]),
    inj: new Map([[5, { on: true, long: true, last: '右手肘', stints: 1, days: 80 }]]),
  });
  assert.match(ps[0].extraNotes.join(), /運氣偏好/);
  assert.match(ps[0].extraNotes.join(), /60 天傷兵名單（右手肘）/);
  assert.match(ps[1].extraNotes.join(), /ERA 比實力好/);
});

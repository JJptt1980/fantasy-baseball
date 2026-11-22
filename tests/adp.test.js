// 各家 ADP：對名字、選市場來源、選秀表市場排名改用 ADP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attach, marketSource, adpLine } from '../docs/advisor/js/adp.js';
import { board } from '../docs/advisor/js/rank.js';

const bat = (id, name, hr) => ({ id, name, team: 'T', side: 'B', pos: 'OF', age: 27, G: 150, G25: 150, AB: 550, PA: 620, R: 80, H: 150, HR: hr, RBI: 80, SB: 10, BB: 60, K: 120, AVG: 0.27, OPS: 0.8, OPS25: 0.8 });

test('對名字（含二刀流標記）與選市場來源', () => {
  const ps = [bat(1, 'Shohei Ohtani', 40), { ...bat(1, 'Shohei Ohtani', 0), side: 'P', pos: 'SP' }, bat(2, 'José Ramírez', 30)];
  const m = attach(ps, { yahoo: [{ name: 'Jose Ramirez', adp: 6.2 }], espn: [{ name: 'Shohei Ohtani', pitcher: false, rank: 1, adp: null }], league: { rows: [{ name: 'Shohei Ohtani (Batter)', adp: 2, last: 1 }] } });
  assert.equal(m.get('B2').Y, 6.2);
  assert.equal(m.get('B1').E, 1);
  assert.equal(m.get('B1').Llast, 1);
  assert.equal(m.has('P1'), false);
  assert.equal(marketSource(m), null, '不到 120 人不採用');
  assert.match(adpLine(m.get('B1')), /ESPN 排名 1｜聯盟去年第 1/);
});

test('有 ADP 時市場排名照 ADP，名單外的排後面', () => {
  const ps = Array.from({ length: 10 }, (_, i) => bat(i + 1, `P${i + 1}`, 40 - i * 3));
  const est = board(ps, {});
  assert.equal(est.find((p) => p.id === 10).marketRank, 10);
  const market = new Map([['B10', 1.5], ['B9', 2.5]]);
  const withAdp = board(ps, { market });
  assert.equal(withAdp.find((p) => p.id === 10).marketRank, 1);
  assert.equal(withAdp.find((p) => p.id === 9).marketRank, 2);
  assert.equal(withAdp.find((p) => p.id === 1).marketRank, 3);
});

test('FantasyPros：專家共識與綜合 ADP 對到球員，市場來源排在 Yahoo 之後', () => {
  const nm = (i) => `Player ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
  const ps = Array.from({ length: 130 }, (_, i) => bat(i + 1, nm(i), 30));
  const fp = { ecr: ps.map((p, i) => ({ name: p.name, pos: 'OF', rank: i + 1 })), adp: ps.map((p, i) => ({ name: p.name, pos: 'OF', rank: 130 - i })) };
  const m = attach(ps, { fp });
  assert.equal(m.get('B1').X, 1);
  assert.equal(m.get('B1').F, 130);
  assert.deepEqual(marketSource(m), { key: 'F', label: 'FantasyPros 綜合 ADP' });
  assert.match(adpLine(m.get('B1')), /FP ADP 130｜專家 1/);
});

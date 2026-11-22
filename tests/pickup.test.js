import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWants, normName, teamLine, recommend } from '../docs/advisor/js/pickup.js';

const bat = (name, o = {}) => ({ id: name, name, side: 'B', pos: 'OF', team: 'T', AB: 25, PA: 28, R: 4, H: 7, HR: 1, RBI: 4, SB: 1, BB: 3, K: 6, OPS: 0.75, AVG: 0.28, ...o });
const arm = (name, o = {}) => ({ id: name, name, side: 'P', pos: 'RP', team: 'T', IP: 3, W: 0, L: 0, SV: 0, HLD: 0, BB: 1, K: 3, ER: 1, WH: 3, QS: 0, ...o });

test('打字需求對應類別（「whip」不會誤判成局數）', () => {
  assert.deepEqual(Object.keys(parseWants('我缺救援')), ['P:SV']);
  assert.ok(parseWants('盜壘')['B:SB']);
  assert.ok(!parseWants('whip')['P:QS']);
  assert.ok(parseWants('這週局數不夠')['P:QS']);
});

test('名字比對：去重音、去 Jr.、去括號', () => {
  assert.equal(normName('Héctor Rodríguez'), normName('Hector Rodriguez'));
  assert.equal(normName('Vladimir Guerrero Jr.'), normName('Vladimir Guerrero'));
  assert.equal(normName('Shohei Ohtani (Batter)'), normName('Shohei Ohtani'));
});

test('球隊一週數字：比率類別正確', () => {
  const t = teamLine([bat('a', { AB: 20, H: 5 }), bat('b', { AB: 30, H: 10 }), arm('c', { IP: 9, ER: 3, WH: 9 })]);
  assert.equal(t['B:AVG'], 15 / 50);
  assert.equal(t['P:ERA'], 3);
  assert.equal(t['P:WHIP'], 1);
});

test('推薦：打者投手分開，說「救援」時終結者排前面', () => {
  const idx = new Map();
  const add = (p) => idx.set(`${p.side}:${normName(p.name)}`, p);
  for (let i = 0; i < 40; i++) add(bat(`Bat ${i}`, { HR: i % 5, R: 3 + (i % 4) }));
  for (let i = 0; i < 30; i++) add(arm(`Arm ${i}`, { K: 2 + (i % 6) }));
  add(arm('Closer Guy', { SV: 3, K: 2 }));
  const fa = [...idx.values()].map((p) => ({ name: p.name, side: p.side }));
  const my = [...idx.values()].slice(0, 5).map((p) => ({ name: p.name, side: p.side, slot: 'OF' }));
  const r = recommend({ idx, myRoster: my, oppRoster: null, freeAgents: fa, wants: '救援' });
  assert.ok(r.lists.recent.B.every((x) => x.p.side === 'B'));
  assert.equal(r.lists.recent.P[0].p.name, 'Closer Guy');
  assert.equal(r.lists.opp, null);
});

import { moveBudget } from '../docs/advisor/js/budget.js';

test('換人額度：保留季後賽、配額、警示', () => {
  const po = [24, 25, 26];
  const a = moveBudget({ cap: 150, used: 0, week: 1, playoffWeeks: po });
  assert.equal(a.reserve, 25);
  assert.equal(a.thisWeek, Math.floor(125 / 23));
  assert.equal(a.level, 'ok');
  // 2021 年你的情況：上限 100、第 20 週已用 90 → 動用到保留額度
  const b = moveBudget({ cap: 100, used: 90, week: 20, playoffWeeks: [23, 24, 25] });
  assert.equal(b.level, 'bad');
  assert.equal(b.thisWeek, 0);
  // 用得比進度快
  const c = moveBudget({ cap: 150, used: 80, week: 10, playoffWeeks: po });
  assert.equal(c.level, 'warn');
  // 季後賽：剩下的平均分到剩餘週數
  const d = moveBudget({ cap: 150, used: 125, week: 24, playoffWeeks: po });
  assert.equal(d.phase, 'playoff');
  assert.equal(d.thisWeek, 9);
});

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

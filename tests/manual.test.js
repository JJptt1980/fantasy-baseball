// 手動玩：選秀、換人、排先發、開打；存檔讀檔後狀態完全一樣（需要 sim/data）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { toMaps } from '../docs/advisor/js/mlb.js';
import { buildPlayers, board } from '../docs/advisor/js/rank.js';
import { buildConfig, PREFS } from '../docs/advisor/js/strategies.js';
import { createGame, restoreGame } from '../docs/advisor/js/demo-manual.js';

const DATA = new URL('../sim/data/', import.meta.url);
const has = existsSync(new URL('hit25.json', DATA)) && existsSync(new URL('hit24.json', DATA));
const L = (f) => JSON.parse(readFileSync(new URL(f, DATA))).stats[0].splits;

test('手動玩一季＋存檔讀檔', { skip: !has && '沒有 sim/data' }, () => {
  const weekly = JSON.parse(readFileSync(new URL('../docs/advisor/data/weekly-2026.json', import.meta.url)));
  const players = board(buildPlayers(toMaps({ hit: L('hit25.json'), pit: L('pit25.json') }), toMaps({ hit: L('hit24.json'), pit: L('pit24.json') })), buildConfig(new Set(), new Set(PREFS.map((p) => p.id))));
  const g = createGame(players, { mySlot: 7, profiles: null, seed: 9, weekly });
  assert.equal(g.turn().team, 7);
  assert.throws(() => g.draftPick(-1));
  g.draftPick(g.draftOptions().recommended[2].id);
  g.autoDraftRest();
  assert.equal(g.phase, 'season');
  assert.equal(g.teams[7].length, 25);
  const pv = g.preview();
  assert.ok(pv.opp != null && pv.cats.length === 18);
  // 板凳上有同類球員時，手動坐板凳一定要生效
  const sideWithBench = pv.bench[0]?.side;
  if (sideWithBench) {
    const starter = pv.lineup.find((x) => x.p && x.p.side === sideWithBench && ['Util', 'P'].includes(x.slot)).p;
    g.setLineup(starter.id, 'bench');
    assert.ok(!g.preview().lineup.some((x) => x.p?.id === starter.id), '手動坐板凳要生效');
  }
  const fa = g.searchFA('', 'P')[0];
  const drop = g.teams[7].find((p) => p.side === 'P');
  g.move(fa.id, drop.id);
  assert.throws(() => g.move(g.searchFA('', 'B')[0].id, g.teams[7].find((p) => p.side === 'P').id), /打者換打者/);
  for (let i = 0; i < 4; i++) g.playWeek();
  const g2 = restoreGame(players, JSON.parse(JSON.stringify(g.serialize())), { profiles: null, weekly });
  assert.deepEqual(g2.rec, g.rec);
  assert.deepEqual(g2.teams[7].map((p) => p.id), g.teams[7].map((p) => p.id));
  g2.autoRest();
  assert.equal(g2.phase, 'done');
  assert.ok(g2.champ >= 0 && g2.champ < 12);
});

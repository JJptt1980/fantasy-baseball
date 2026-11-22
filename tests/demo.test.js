// Demo 模擬器：跑完整一季，事件完整（需要 sim/data；沒有就略過）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { toMaps } from '../docs/advisor/js/mlb.js';
import { buildPlayers, board } from '../docs/advisor/js/rank.js';
import { buildConfig, PREFS } from '../docs/advisor/js/strategies.js';
import { runSeason, buildProfiles } from '../docs/advisor/js/demo-sim.js';

const DATA = new URL('../sim/data/', import.meta.url);
const has = existsSync(new URL('hit.json', DATA));
const L = (f) => JSON.parse(readFileSync(new URL(f, DATA))).stats[0].splits;

test('Demo：選秀 25 輪、23 週、季後賽、冠軍', { skip: !has && '沒有 sim/data' }, () => {
  const players = board(buildPlayers(toMaps({ hit: L('hit.json'), pit: L('pit.json') }), toMaps({ hit: L('hit25.json'), pit: L('pit25.json') })), buildConfig(new Set(), new Set(PREFS.map((p) => p.id))));
  const picks = players.slice(0, 300).map((p, i) => ({ round: Math.floor(i / 12) + 1, pick: (i % 12) + 1, overall: i + 1, name: p.name, team: `隊${i % 12}` }));
  const teams = Array.from({ length: 12 }, (_, i) => ({ team: `隊${i}`, teamId: String(i + 1), managerId: `m${i}`, moves: 40 + i }));
  const history = [{ season: 2026, picks, teams }, { season: 2025, picks, teams }];
  const profiles = buildProfiles(history, players, 'm0');
  assert.ok(profiles.every((p) => p.years === 2 && p.movesPerWeek > 1));
  assert.equal(profiles.length, 11);
  const { events } = runSeason(players, { mySlot: 3, profiles, seed: 123 });
  assert.equal(events[0].type, 'draft');
  assert.equal(events[0].log.length, 12 * 25);
  assert.equal(events.filter((e) => e.type === 'week').length, 23);
  assert.equal(events.filter((e) => e.type === 'playoff').length, 5);
  const end = events.at(-1);
  assert.equal(end.type, 'end');
  assert.ok(end.champ >= 0 && end.champ < 12);
  // 真實逐週重播
  const wfile = new URL('../docs/advisor/data/weekly-2026.json', import.meta.url);
  if (existsSync(wfile)) {
    const weekly = JSON.parse(readFileSync(wfile));
    const ev = runSeason(players, { mySlot: 0, profiles, seed: 5, weekly }).events;
    assert.equal(ev.at(-1).real, true);
    assert.equal(ev.filter((e) => e.type === 'week').length, 23);
    assert.ok(ev.at(-1).aiMoves > 0);
  }
  // 同一個 seed 結果要一樣
  assert.equal(runSeason(players, { mySlot: 3, profiles, seed: 123 }).events.at(-1).champ, end.champ);
});

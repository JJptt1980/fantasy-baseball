// JS 版選秀排名要和 Python 版（sim/rank.py 產生的 draft/2027-draft-board.csv）一致
// 需要 sim/data/（./sim/fetch.sh 下載）；沒有資料就略過
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { toMaps } from '../docs/advisor/js/mlb.js';
import { buildPlayers, board } from '../docs/advisor/js/rank.js';
import { buildConfig, PREFS } from '../docs/advisor/js/strategies.js';

const DATA = new URL('../sim/data/', import.meta.url);
const has = existsSync(new URL('hit.json', DATA)) && existsSync(new URL('draft/2027-draft-board.csv', new URL('../', import.meta.url)));

const load = (f) => {
  const j = JSON.parse(readFileSync(new URL(f, DATA)));
  return { hit: [], pit: [], ...j, splits: j.stats[0].splits };
};

test('JS 選秀排名與 Python 版前 150 名一致', { skip: !has && '沒有 sim/data' }, () => {
  const cur = toMaps({ hit: load('hit.json').splits, pit: load('pit.json').splits });
  const prev = toMaps({ hit: load('hit25.json').splits, pit: load('pit25.json').splits });
  const cfg = buildConfig(new Set(), new Set(PREFS.map((p) => p.id)));
  const js = board(buildPlayers(cur, prev), cfg).slice(0, 150).map((p) => p.name);
  const csv = readFileSync(new URL('../draft/2027-draft-board.csv', import.meta.url), 'utf8').replace(/^﻿/, '');
  const py = csv.trim().split('\n').slice(1, 151).map((line) => line.split(',')[3]);
  const diff = js.map((n, i) => (n === py[i] ? null : `${i + 1}: JS=${n} PY=${py[i]}`)).filter(Boolean);
  assert.deepEqual(diff, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as parse from '../docs/js/yahoo-parse.js';
import { compute, judge, formatDiff } from '../docs/js/scoring/h2h-categories.js';
import { getScorer } from '../docs/js/scoring/index.js';
import { isValidPath } from '../worker/src/yahoo.js';
import { isAllowedReturn, randomHex } from '../worker/src/oauth.js';
import { gamesJson, leaguesJson, settingsJson, scoreboardJson } from './fixtures.js';

test('parseGameKey', () => {
  assert.equal(parse.parseGameKey(gamesJson), '469');
});

test('parseLeagues', () => {
  const ls = parse.parseLeagues(leaguesJson);
  assert.equal(ls.length, 2);
  assert.deepEqual([ls[0].key, ls[0].name, ls[0].scoringType, ls[0].endWeek, ls[0].isFinished], ['469.l.1111', '台灣好棒', 'head', 26, true]);
});

test('parseSettings：過濾停用類別、判斷方向與只顯示', () => {
  const s = parse.parseSettings(settingsJson);
  assert.equal(s.categories.length, 8);
  const era = s.categories.find((c) => c.abbr === 'ERA');
  assert.equal(era.higherBetter, false);
  assert.equal(s.categories.find((c) => c.abbr === 'H/AB').displayOnly, true);
  assert.equal(s.categories.find((c) => c.abbr === 'HR').higherBetter, true);
});

test('parseScoreboard + findMyMatchup：我方排第一', () => {
  const ms = parse.parseScoreboard(scoreboardJson);
  assert.equal(ms.length, 2);
  const m = parse.findMyMatchup(ms);
  assert.equal(m.teams[0].name, '我的隊');
  assert.equal(m.teams[0].isMine, true);
  assert.equal(m.teams[1].manager, '對手隊主');
  assert.equal(m.teams[0].stats['3'], '.275');
  assert.equal(m.statWinners['26'], '469.l.1111.t.1');
});

test('H2H 類別制：戰況計算', () => {
  const s = parse.parseSettings(settingsJson);
  const m = parse.findMyMatchup(parse.parseScoreboard(scoreboardJson));
  const r = compute({ categories: s.categories, matchup: m });
  const by = Object.fromEntries(r.rows.map((x) => [x.abbr, x]));
  assert.equal(by['H/AB'].result, 'display');
  assert.equal(by.R.result, 'win');
  assert.equal(by.HR.result, 'tie');
  assert.equal(by.SB.result, 'loss');
  assert.equal(by.AVG.result, 'loss');
  assert.equal(by.AVG.diff, '.003');
  assert.equal(by.W.result, 'win');
  assert.equal(by.ERA.result, 'win'); // 數值是 "-"，採用 Yahoo stat_winners
  assert.equal(by.WHIP.result, 'win'); // 越低越好
  assert.equal(by.WHIP.diff, '0.10');
  assert.equal(r.recordText, '4-2-1');
});

test('judge / formatDiff 邊界', () => {
  assert.equal(judge('3.50', '3.5', false), 'tie');
  assert.equal(judge('2.10', '3.00', false), 'win');
  assert.equal(judge('-', '3.00', false), null);
  assert.equal(formatDiff('10', '7'), '3');
  assert.equal(formatDiff('12/30', '7'), '');
});

test('getScorer', () => {
  assert.equal(getScorer('head').implemented, true);
  assert.equal(getScorer('headpoint').implemented, false);
  assert.equal(getScorer('roto').implemented, false);
  assert.equal(getScorer('xxx'), null);
});

test('Worker：Yahoo 路徑白名單', () => {
  assert.ok(isValidPath('users;use_login=1/games;game_keys=469/leagues'));
  assert.ok(isValidPath('games;game_codes=mlb;seasons=2026'));
  assert.ok(isValidPath('league/469.l.1111/scoreboard;week=5'));
  assert.ok(!isValidPath('https://evil.com'));
  assert.ok(!isValidPath('league/../../x'));
  assert.ok(!isValidPath('league/1?x=1'));
  assert.ok(!isValidPath(''));
});

test('Worker：登入導回網址只允許 GitHub Pages', () => {
  const o = 'https://jjptt1980.github.io';
  assert.ok(isAllowedReturn('https://jjptt1980.github.io/fantasy-baseball/', o));
  assert.ok(!isAllowedReturn('https://jjptt1980.github.io.evil.com/', o));
  assert.ok(!isAllowedReturn('javascript:alert(1)', o));
  assert.match(randomHex(32), /^[a-f0-9]{64}$/);
});

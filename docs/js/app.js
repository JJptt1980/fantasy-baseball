import { SEASONS, DEFAULT_SEASON } from './config.js';
import * as api from './api.js';
import * as parse from './yahoo-parse.js';
import { getScorer } from './scoring/index.js';

const $ = (s) => document.querySelector(s);
const LS = { season: 'fb.season', league: 'fb.league' };

const state = { season: null, gameKey: null, leagues: [], league: null, settings: null, week: null };

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(msg, kind = 'info') {
  const el = $('#status');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = `status ${kind}`;
  el.textContent = msg;
}

function fillSelect(sel, options, value) {
  sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (value != null) sel.value = String(value);
}

function showLogin(msg = '') {
  $('#view-app').hidden = true;
  $('#btn-logout').hidden = true;
  $('#btn-refresh').hidden = true;
  $('#view-login').hidden = false;
  $('#login-msg').textContent = msg;
  const btn = $('#btn-login');
  if (api.isConfigured()) {
    btn.href = api.loginUrl();
    btn.classList.remove('disabled');
  } else {
    btn.removeAttribute('href');
    btn.classList.add('disabled');
    $('#login-msg').textContent = '尚未設定 Worker 網址（docs/js/config.js 的 WORKER_URL）。';
  }
}

function showApp() {
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#btn-logout').hidden = false;
  $('#btn-refresh').hidden = false;
}

async function run(task) {
  try {
    await task();
  } catch (e) {
    if (e instanceof api.AuthError) return showLogin(e.message);
    console.error(e);
    setStatus(e.message || '發生錯誤', 'error');
  }
}

// ── 載入流程：球季 → 聯盟 → 週次 → 對戰 ──

async function loadSeason(season) {
  state.season = Number(season);
  lsSet(LS.season, state.season);
  $('#matchup').innerHTML = '';
  setStatus('載入聯盟中…');
  state.gameKey = parse.parseGameKey(await api.yahoo(`games;game_codes=mlb;seasons=${state.season}`));
  state.leagues = parse.parseLeagues(await api.yahoo(`users;use_login=1/games;game_keys=${state.gameKey}/leagues`));
  if (!state.leagues.length) {
    fillSelect($('#sel-league'), [], null);
    fillSelect($('#sel-week'), [], null);
    return setStatus(`${state.season} 球季找不到你的聯盟。`, 'warn');
  }
  const saved = lsGet(LS.league);
  const key = state.leagues.some((l) => l.key === saved) ? saved : state.leagues[0].key;
  fillSelect($('#sel-league'), state.leagues.map((l) => ({ value: l.key, label: l.name })), key);
  await loadLeague(key);
}

async function loadLeague(key) {
  lsSet(LS.league, key);
  $('#matchup').innerHTML = '';
  setStatus('載入聯盟設定中…');
  state.settings = parse.parseSettings(await api.yahoo(`league/${key}/settings`));
  const s = state.settings;
  const weeks = [];
  for (let w = s.startWeek ?? 1; w <= (s.endWeek ?? s.currentWeek ?? 1); w++) weeks.push({ value: w, label: `第 ${w} 週` });
  const week = s.isFinished ? s.endWeek : (s.currentWeek ?? s.startWeek);
  fillSelect($('#sel-week'), weeks, week);
  await loadWeek(week);
}

async function loadWeek(week, { fresh = false } = {}) {
  state.week = Number(week);
  const s = state.settings;
  const scorer = getScorer(s.scoringType);
  if (!scorer?.implemented) {
    $('#matchup').innerHTML = '';
    return setStatus(`這個聯盟是「${scorer?.label ?? s.scoringType}」，目前只支援 H2H 類別制。`, 'warn');
  }
  setStatus('載入對戰中…');
  const json = await api.yahoo(`league/${s.key}/scoreboard;week=${state.week}`, { fresh });
  const mine = parse.findMyMatchup(parse.parseScoreboard(json));
  if (!mine) {
    $('#matchup').innerHTML = '';
    return setStatus(`第 ${state.week} 週沒有你的對戰（可能是輪空或已淘汰）。`, 'warn');
  }
  setStatus('');
  renderMatchup(mine, scorer.compute({ categories: s.categories, matchup: mine }));
}

// ── 畫面 ──

const RESULT_TEXT = {
  live: { win: '領先', loss: '落後', tie: '平手' },
  final: { win: '勝', loss: '負', tie: '平' },
};

function renderMatchup(m, r) {
  const done = m.status === 'postevent';
  const words = done ? RESULT_TEXT.final : RESULT_TEXT.live;
  const { win, loss } = r.record;
  const overall = win > loss ? 'win' : win < loss ? 'loss' : 'tie';
  const statusText = { preevent: '尚未開始', midevent: '進行中', postevent: '已結束' }[m.status] ?? '';
  const tags = [m.isPlayoffs && '季後賽', m.isConsolation && '安慰賽'].filter(Boolean).join(' · ');
  const range = m.weekStart && m.weekEnd ? `${m.weekStart.slice(5)} ～ ${m.weekEnd.slice(5)}` : '';

  const teamHtml = (t, side) => `
    <div class="team ${side}">
      ${t?.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '<div class="logo-ph"></div>'}
      <div class="tname">${esc(t?.name ?? '—')}</div>
      <div class="tmgr">${esc(t?.manager ?? '')}</div>
    </div>`;

  const rowHtml = (row) => {
    const cls = row.result;
    const txt = row.result === 'display' ? '—' : row.result === 'na' ? '?' : words[row.result];
    return `<tr class="${cls}">
      <th scope="row">${esc(row.abbr)}${row.higherBetter || row.displayOnly ? '' : '<span class="low" title="越低越好">↓</span>'}</th>
      <td class="num my">${esc(row.my)}</td>
      <td class="num opp">${esc(row.opp)}</td>
      <td class="res"><span class="pill ${cls}">${esc(txt)}</span></td>
      <td class="num diff">${esc(row.diff)}</td>
    </tr>`;
  };

  const scored = r.rows.filter((x) => !x.displayOnly);
  const display = r.rows.filter((x) => x.displayOnly);

  $('#matchup').innerHTML = `
    <div class="card summary">
      <div class="meta">第 ${m.week} 週 ${range ? `· ${esc(range)}` : ''} · ${esc(statusText)}${tags ? ` · ${esc(tags)}` : ''}</div>
      <div class="vs">
        ${teamHtml(r.me, 'me')}
        <div class="record ${overall}">
          <div class="big">${esc(r.recordText)}</div>
          <div class="sub">${done ? (overall === 'win' ? '本週獲勝' : overall === 'loss' ? '本週落敗' : '本週平手') : words[overall]}</div>
        </div>
        ${teamHtml(r.opp, 'opp')}
      </div>
    </div>
    <div class="card">
      <table class="cats">
        <thead><tr><th>類別</th><th>我方</th><th>對手</th><th>結果</th><th>差距</th></tr></thead>
        <tbody>${scored.map(rowHtml).join('')}</tbody>
        ${display.length ? `<tbody class="display"><tr class="sep"><td colspan="5">只顯示、不計分</td></tr>${display.map(rowHtml).join('')}</tbody>` : ''}
      </table>
      <p class="hint">↓ 表示越低越好（如 ERA、WHIP）</p>
    </div>`;
}

// ── 啟動 ──

function bind() {
  $('#sel-season').addEventListener('change', (e) => run(() => loadSeason(e.target.value)));
  $('#sel-league').addEventListener('change', (e) => run(() => loadLeague(e.target.value)));
  $('#sel-week').addEventListener('change', (e) => run(() => loadWeek(e.target.value)));
  $('#btn-refresh').addEventListener('click', () => {
    if (state.settings && state.week) run(() => loadWeek(state.week, { fresh: true }));
  });
  $('#btn-logout').addEventListener('click', async () => {
    await api.logout();
    showLogin('已登出。');
  });
}

function init() {
  api.captureSessionFromHash();
  bind();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!api.isConfigured() || !api.getSid()) return showLogin();
  showApp();
  const season = Number(lsGet(LS.season)) || DEFAULT_SEASON;
  fillSelect($('#sel-season'), SEASONS.map((y) => ({ value: y, label: `${y}` })), season);
  run(() => loadSeason(season));
}

init();

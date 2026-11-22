import { seasonStats, toMaps } from './mlb.js';
import { buildPlayers, board } from './rank.js';
import { BASE, STRATEGIES, PREFS, buildConfig } from './strategies.js';
import { initPickup } from './pickup-ui.js';
import { initDemo } from './demo-ui.js';
import { initLive } from './live-ui.js';
import { initDraftSync } from './draft-sync-ui.js';

const $ = (s) => document.querySelector(s);
const LS = { strat: 'adv.strategies', prefs: 'adv.prefs', notes: 'adv.notes', marks: 'adv.marks', tab: 'adv.tab' };

function lsGet(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 不存也能用 */ }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  players: null,     // 原始球員（不含偏好）
  season: null,
  selected: new Set(lsGet(LS.strat, [])),
  prefs: new Set(lsGet(LS.prefs, PREFS.map((p) => p.id))),
  marks: lsGet(LS.marks, {}), // id → 'mine' | 'taken'
  ranked: [],
};

// 最近一個「已打完」的球季：11 月起算當年，否則算前一年
function lastSeason() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}

function setStatus(msg, kind = '') {
  const el = $('#status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

// ── 選秀方向（打勾） ──

function rateClass(r) {
  return r >= 28 ? 'hi' : r < 20 ? 'lo' : '';
}

function renderChecks() {
  $('#prefs').innerHTML = PREFS.map((p) => `
    <label class="check"><input type="checkbox" data-pref="${p.id}" ${state.prefs.has(p.id) ? 'checked' : ''}>
      <div><div class="t">${esc(p.label)}</div></div></label>`).join('');
  $('#strategies').innerHTML = STRATEGIES.map((s) => `
    <label class="check"><input type="checkbox" data-strat="${s.id}" ${state.selected.has(s.id) ? 'checked' : ''}>
      <div><div class="t">${esc(s.label)} <span class="rate ${rateClass(s.sim[0])}">（${s.sim[0]}%／${s.sim[1]}%）</span></div>
      <div class="d">${esc(s.desc)}</div></div></label>`).join('');
  updateSummary();
}

function updateSummary() {
  const names = STRATEGIES.filter((s) => state.selected.has(s.id)).map((s) => s.label);
  $('#strategy-summary').textContent = names.length ? `：${BASE.label}＋${names.join('＋')}` : `：${BASE.label}`;
}

// ── 選秀表 ──

function statLine(p) {
  if (p.side === 'B') {
    return `R ${p.R}｜HR ${p.HR}｜RBI ${p.RBI}｜SB ${p.SB}｜AVG ${p.AVG.toFixed(3).replace(/^0/, '')}｜OPS ${p.OPS.toFixed(3).replace(/^0/, '')}`;
  }
  const era = ((p.ER * 9) / p.IP).toFixed(2);
  const whip = (p.WH / p.IP).toFixed(2);
  return `${p.IP.toFixed(0)} 局｜W ${p.W}｜SV ${p.SV}｜HLD ${p.HLD}｜K ${p.K}｜ERA ${era}｜WHIP ${whip}`;
}

function recompute() {
  if (!state.players) return;
  state.ranked = board(state.players, buildConfig(state.selected, state.prefs));
  renderBoard();
}

function renderBoard() {
  const q = $('#search').value.trim().toLowerCase();
  const pos = $('#filter-pos').value;
  const hide = $('#hide-taken').checked;
  const rows = [];
  let lastRound = 0;
  let shown = 0;
  for (const p of state.ranked) {
    if (shown >= 400) break;
    const mark = state.marks[p.id];
    if (hide && mark) continue;
    if (q && !p.name.toLowerCase().includes(q)) continue;
    if (pos && !(pos === p.side || pos === p.pos)) continue;
    if (!q && !pos && p.round !== lastRound) {
      rows.push(`<li class="round-sep">第 ${p.round} 輪</li>`);
      lastRound = p.round;
    }
    shown++;
    rows.push(`<li class="row ${mark || ''}" data-id="${p.id}">
      <div class="no"><b>${p.rank}</b><span>市 ${p.marketRank}</span></div>
      <div>
        <div class="name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div>
        <div class="line">${esc(p.team)}・${p.age} 歲｜${esc(statLine(p))}</div>
        ${p.notes.length ? `<div class="note">${esc(p.notes.join('、'))}</div>` : ''}
      </div>
      <div class="acts">
        <button type="button" class="b-mine" data-act="mine" aria-label="我選了">我選</button>
        <button type="button" class="b-taken" data-act="taken" aria-label="被選走">被選</button>
      </div></li>`);
  }
  $('#board').innerHTML = rows.join('') || '<li class="muted">沒有符合的球員</li>';
  const mine = Object.values(state.marks).filter((m) => m === 'mine').length;
  const taken = Object.values(state.marks).filter((m) => m === 'taken').length;
  $('#board-meta').textContent = `依 ${state.season} 季（含 ${state.season - 1} 季判斷傷病）MLB 官方數據｜我選了 ${mine} 人、被選走 ${taken} 人｜「市」＝市場排名`;
}

// ── 事件 ──

function bind() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  $('#strategy-box').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.strat) {
      t.checked ? state.selected.add(t.dataset.strat) : state.selected.delete(t.dataset.strat);
      lsSet(LS.strat, [...state.selected]);
    } else if (t.dataset.pref) {
      t.checked ? state.prefs.add(t.dataset.pref) : state.prefs.delete(t.dataset.pref);
      lsSet(LS.prefs, [...state.prefs]);
    } else return;
    updateSummary();
    recompute();
  });

  const notes = $('#my-notes');
  notes.value = lsGet(LS.notes, '');
  notes.addEventListener('input', () => lsSet(LS.notes, notes.value));

  $('#search').addEventListener('input', renderBoard);
  $('#filter-pos').addEventListener('change', renderBoard);
  $('#hide-taken').addEventListener('change', renderBoard);

  $('#board').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.row').dataset.id;
    const act = btn.dataset.act;
    if (state.marks[id] === act) delete state.marks[id];
    else state.marks[id] = act;
    lsSet(LS.marks, state.marks);
    renderBoard();
  });
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-draft').hidden = tab !== 'draft';
  $('#tab-pickup').hidden = tab !== 'pickup';
  $('#tab-demo').hidden = tab !== 'demo';
  $('#tab-live').hidden = tab !== 'live';
  if (tab === 'live') live?.onShow();
  lsSet(LS.tab, tab);
  if (tab === 'pickup') pickup?.onShow();
}

async function load() {
  state.season = lastSeason();
  setStatus(`讀取 ${state.season} 與 ${state.season - 1} 季 MLB 數據中…（第一次比較久）`);
  try {
    const [cur, prev] = await Promise.all([seasonStats(state.season), seasonStats(state.season - 1)]);
    state.players = buildPlayers(toMaps(cur), toMaps(prev));
    setStatus('');
    recompute();
  } catch (e) {
    console.error(e);
    setStatus(`${e.message || '讀取失敗'}，請確認網路後重開`, 'error');
  }
}

let pickup = null;
let live = null;
renderChecks();
bind();
pickup = initPickup();
// 選秀即時同步：自動標記（只會新增或改成「我選／被選」，不會清掉你手動標的）
initDraftSync({
  getBoard: () => state.ranked,
  applyMarks: (marks) => {
    let changed = false;
    for (const [id, v] of Object.entries(marks)) if (state.marks[id] !== v) { state.marks[id] = v; changed = true; }
    if (changed) { lsSet(LS.marks, state.marks); renderBoard(); }
  },
});
live = initLive({ getBoard: () => state.ranked, weeklyUrl: `data/weekly-${lastSeason()}.json` });
initDemo({ getBoard: () => state.ranked, getConfig: () => buildConfig(state.selected, state.prefs), getSeason: () => state.season, getSelection: () => ({ selected: [...state.selected], prefs: [...state.prefs] }) });
showTab(lsGet(LS.tab, 'draft'));
load();

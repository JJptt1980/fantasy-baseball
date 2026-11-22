import { seasonStats, toMaps } from './mlb.js';
import { buildPlayers, board } from './rank.js';
import { BASE, STRATEGIES, PREFS, buildConfig } from './strategies.js';
import { initPickup } from './pickup-ui.js';
import { initDemo } from './demo-ui.js';
import { initLive } from './live-ui.js';
import { initDraftSync } from './draft-sync-ui.js';
import { haptic, toast, sheet, closeSheet, swipeRows, pullToRefresh, sparkline, miniBars, skeleton, zPct } from './ui-kit.js';

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

function setStatus(msg, kind = '', retry = null) {
  const el = $('#status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
  if (retry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn status-act';
    b.textContent = '重試';
    b.onclick = retry;
    el.append(b);
  }
}

// ── 一句話理由：最強的 1~2 個類別＋加分／風險 ──
const NICE = {
  'B:R': '得分', 'B:H': '安打', 'B:HR': '全壘打', 'B:RBI': '打點', 'B:SB': '盜壘', 'B:BB': '保送', 'B:K': '少三振', 'B:AVG': '打擊率', 'B:OPS': 'OPS',
  'P:W': '勝投', 'P:L': '少敗投', 'P:SV': '救援', 'P:BB': '少保送', 'P:K': '三振', 'P:HLD': '中繼', 'P:ERA': 'ERA', 'P:WHIP': 'WHIP', 'P:QS': '優質先發',
};
const topPct = (z) => Math.max(1, Math.round((1 - zPct(z)) * 100));
function reasonOf(p) {
  const top = Object.entries(p.z ?? {}).filter(([, z]) => z > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 2);
  let t = top.length ? top.map(([c, z]) => `${NICE[c]}前 ${topPct(z)}%`).join('、') : '各類別都在平均附近，沒有明顯強項';
  const plus = p.notes.find((n) => /上升|進步/.test(n));
  const risk = p.notes.find((n) => /不足|避開|偏大|保送/.test(n));
  if (plus) t += `，${plus}`;
  if (risk) t += `；注意：${risk}`;
  return t;
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
  if (!$('#tab-today').hidden) renderToday();
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
        <div class="why1">${esc(reasonOf(p))}</div>
      </div>
      <div class="acts">
        <button type="button" class="b-mine" data-act="mine" aria-label="我選了">我選</button>
        <button type="button" class="b-taken" data-act="taken" aria-label="被選走">被選</button>
      </div></li>`);
  }
  $('#board').innerHTML = rows.join('') || '<li class="muted">沒有符合的球員</li>';
  const mine = Object.values(state.marks).filter((m) => m === 'mine').length;
  const taken = Object.values(state.marks).filter((m) => m === 'taken').length;
  $('#board-meta').textContent = `依 ${state.season} 季（含 ${state.season - 1} 季判斷傷病）MLB 官方數據｜我選了 ${mine} 人、被選走 ${taken} 人｜「市」＝市場排名｜往右滑＝我選、往左滑＝被選，點一下看詳情`;
}

// ── 標記（震動＋可復原） ──
function saveMarks() { lsSet(LS.marks, state.marks); renderBoard(); }
function setMark(id, act) {
  const prev = state.marks[id];
  if (prev === act) delete state.marks[id];
  else state.marks[id] = act;
  saveMarks();
  haptic('mark');
  const p = state.ranked.find((x) => String(x.id) === String(id));
  const now = state.marks[id];
  toast(`${p?.name ?? ''}：${now === 'mine' ? '我選了' : now === 'taken' ? '被選走' : '取消標記'}`, {
    undo: () => { if (prev) state.marks[id] = prev; else delete state.marks[id]; saveMarks(); },
  });
}

// ── 球員詳情卡 ──
let weeklyP = null;
const weeklyData = () => (weeklyP ??= fetch(`data/weekly-${state.season}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
function trendOf(p, wk) {
  const rec = wk?.players?.[`${p.side}${p.id}`];
  if (!rec) return null;
  const col = (cols, name) => cols.indexOf(name);
  if (p.side === 'B') {
    const iO = col(wk.hitCols, 'OPSx1000');
    const iP = col(wk.hitCols, 'PA');
    return { label: '每週 OPS', vals: rec.w.map((w) => (Array.isArray(w) && w[iP] >= 8 ? w[iO] / 1000 : null)), fmt: (v) => v.toFixed(3).replace(/^0/, '') };
  }
  if (p.pos === 'SP') {
    const iK = col(wk.pitCols, 'K');
    return { label: '每週三振', vals: rec.w.map((w) => (Array.isArray(w) ? w[iK] : null)), fmt: (v) => String(v) };
  }
  const iS = col(wk.pitCols, 'SV');
  const iH = col(wk.pitCols, 'HLD');
  return { label: '每週 SV＋HLD', vals: rec.w.map((w) => (Array.isArray(w) ? w[iS] + w[iH] : null)), fmt: (v) => String(v) };
}
function openPlayer(id) {
  const p = state.ranked.find((x) => String(x.id) === String(id));
  if (!p) return;
  haptic('tap');
  const mark = state.marks[p.id];
  const bars = miniBars(Object.entries(p.z ?? {}).map(([c, z]) => {
    const pct = zPct(z);
    return { label: NICE[c], pct, text: `前 ${topPct(z)}%`, cls: pct >= 0.8 ? 'good' : pct <= 0.3 ? 'bad' : '' };
  }));
  const box = sheet(`
    <div class="sh-head"><div><div class="sh-name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div><div class="muted small">${esc(p.team)}・${p.age} 歲</div></div><button type="button" class="sh-x" data-close aria-label="關閉">✕</button></div>
    <div class="kpis"><div><b>${p.rank}</b><span>選秀表</span></div><div><b>${p.round}</b><span>建議輪次</span></div><div><b>${p.marketRank}</b><span>市場排名</span></div></div>
    <p class="why1 lead">${esc(reasonOf(p))}</p>
    <h3>各類別在聯盟的位置（${state.season} 季）</h3>${bars}
    <h3 id="sh-trend-t">${state.season} 逐週走勢</h3><div id="sh-trend" class="muted small">讀取中…</div>
    <div class="line small muted" style="margin-top:10px">${esc(statLine(p))}</div>
    ${p.notes.length ? `<div class="note">${esc(p.notes.join('、'))}</div>` : ''}
    <div class="sh-acts"><button type="button" class="btn primary" data-sh="mine">${mark === 'mine' ? '取消「我選」' : '我選了'}</button><button type="button" class="btn" data-sh="taken">${mark === 'taken' ? '取消「被選」' : '被選走'}</button></div>`);
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-sh]')?.dataset.sh;
    if (a) { closeSheet(); setMark(p.id, a); }
  });
  weeklyData().then((wk) => {
    const el = document.getElementById('sh-trend');
    if (!el) return;
    const t = trendOf(p, wk);
    if (!t) { el.textContent = '沒有逐週資料'; return; }
    const got = t.vals.filter((v) => v != null);
    const recent = got.slice(-4);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    document.getElementById('sh-trend-t').textContent = `${state.season} ${t.label}`;
    el.className = 'trend';
    el.innerHTML = `${sparkline(t.vals, { w: 240, h: 44, label: t.label })}<div class="muted small">全季平均 ${t.fmt(Math.round(avg(got) * 1000) / 1000)}｜最後 4 週 ${t.fmt(Math.round(avg(recent) * 1000) / 1000)}</div>`;
  });
}

// ── 事件 ──

function bind() {
  document.querySelectorAll('.tb').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  // 卡片、列表裡的捷徑：data-goto（頁面）＋ data-open（順便展開哪個區塊）
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    showTab(g.dataset.goto);
    if (g.dataset.open) { const el = document.getElementById(g.dataset.open); if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); } }
  });
  $('#nav-back').addEventListener('click', () => showTab('more'));

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
  $('#clear-marks').addEventListener('click', (e) => {
    e.preventDefault();
    const n = Object.keys(state.marks).length;
    if (!n) { toast('沒有標記可以清除'); return; }
    const saved = { ...state.marks };
    state.marks = {};
    saveMarks();
    haptic('warn');
    toast(`已清除 ${n} 個標記`, { undo: () => { state.marks = saved; saveMarks(); }, ms: 6000 });
  });

  $('#board').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const btn = e.target.closest('button[data-act]');
    if (btn) { setMark(row.dataset.id, btn.dataset.act); return; }
    if (!row.dataset.justSwiped) openPlayer(row.dataset.id);
  });
  swipeRows($('#board'), '.row', {
    right: (row) => setMark(row.dataset.id, 'mine'),
    left: (row) => setMark(row.dataset.id, 'taken'),
  });
}

const PAGES = ['today', 'draft', 'pickup', 'live', 'more', 'demo'];
function showTab(tab) {
  if (!PAGES.includes(tab)) tab = 'today';
  // Demo 是「更多」底下的子頁
  const bar = tab === 'demo' ? 'more' : tab;
  document.querySelectorAll('.tb').forEach((b) => b.classList.toggle('active', b.dataset.tab === bar));
  for (const p of PAGES) $(`#tab-${p}`).hidden = p !== tab;
  $('#nav-back').hidden = tab !== 'demo';
  $('#mini-title').textContent = $(`#tab-${tab} .large-title`)?.textContent ?? '';
  window.scrollTo(0, 0);
  watchTitle(tab);
  if (tab === 'live') live?.onShow();
  if (tab === 'pickup') pickup?.onShow();
  if (tab === 'today') renderToday();
  lsSet(LS.tab, tab);
}

// 大標題捲出畫面 → 頂列顯示小標題
let titleObs = null;
function watchTitle(tab) {
  titleObs?.disconnect();
  const t = $(`#tab-${tab} .large-title`);
  if (!t || !('IntersectionObserver' in window)) return;
  titleObs = new IntersectionObserver(([e]) => $('.topbar').classList.toggle('scrolled', !e.isIntersecting), { rootMargin: '-44px 0px 0px 0px' });
  titleObs.observe(t);
}

// 今天：依季節顯示最重要的事
function renderToday() {
  if (!state.players) { $('#today').innerHTML = '<div class="today-card sk-card"><i></i><b></b><b></b></div><div class="today-card sk-card"><i></i><b></b></div>'; return; }
  const m = new Date().getMonth() + 1;
  const next = state.ranked.filter((p) => !state.marks[p.id]).slice(0, 3);
  const strat = $('#strategy-summary')?.textContent.replace(/^：/, '') ?? '';
  const cards = [];
  if (m >= 4 && m <= 9) {
    cards.push(`<div class="today-card"><div class="k">本週對戰</div><div class="hero">即時比分</div><div class="muted small">18 類誰領先、今天誰在打、週末預估</div>
      <div class="acts"><button type="button" class="btn primary" data-goto="live">看本週對戰</button><button type="button" class="btn" data-goto="pickup">撿人建議</button></div></div>`);
  } else if (m >= 2 && m <= 3) {
    cards.push(`<div class="today-card"><div class="k">選秀季</div><div class="hero">準備選秀</div><div class="muted small">選秀當天打開「選秀即時同步」，App 會自動標記並在快輪到你時震動提醒</div>
      <div class="acts"><button type="button" class="btn primary" data-goto="draft" data-open="ds-box">選秀即時同步</button><button type="button" class="btn" data-goto="draft">選秀表</button></div></div>`);
  } else {
    const y = m >= 10 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    cards.push(`<div class="today-card"><div class="k">休賽季</div><div class="hero">${y} 選秀</div><div class="muted small">大約 3 月下旬｜選秀方向：${esc(strat || '均衡＋輕度偏好')}</div>
      ${next.length ? `<div class="sumline" style="margin-top:8px">選秀表前 3 名：${next.map((p) => `<b>${esc(p.name)}</b>`).join('、')}</div>` : ''}
      <div class="acts"><button type="button" class="btn primary" data-goto="draft">看選秀表</button><button type="button" class="btn" data-goto="demo">練習：手動玩 ${y}</button></div></div>`);
    cards.push(`<div class="today-card"><div class="k">複習</div><div class="sumline">重播 ${y - 1} 任一週的即時對戰，或練習選秀同步</div>
      <div class="acts"><button type="button" class="btn" data-goto="live">重播 ${y - 1}</button><button type="button" class="btn" data-goto="draft" data-open="ds-box">練習選秀同步</button></div></div>`);
  }
  $('#today').innerHTML = cards.join('');
}

async function load() {
  state.season = lastSeason();
  setStatus(`讀取 ${state.season} 與 ${state.season - 1} 季 MLB 數據中…（第一次比較久）`);
  if (!state.players) $('#board').innerHTML = skeleton(8);
  try {
    const [cur, prev] = await Promise.all([seasonStats(state.season), seasonStats(state.season - 1)]);
    state.players = buildPlayers(toMaps(cur), toMaps(prev));
    setStatus('');
    recompute();
  } catch (e) {
    console.error(e);
    haptic('error');
    $('#board').innerHTML = '';
    setStatus(`${e.message || '讀取失敗'}。請確認網路連線後按重試。`, 'error', () => load());
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
  getMarks: () => state.marks,
  setMarks: (m) => { state.marks = m; lsSet(LS.marks, m); renderBoard(); },
});
live = initLive({ getBoard: () => state.ranked, weeklyUrl: `data/weekly-${lastSeason()}.json` });
initDemo({ getBoard: () => state.ranked, getConfig: () => buildConfig(state.selected, state.prefs), getSeason: () => state.season, getSelection: () => ({ selected: [...state.selected], prefs: [...state.prefs] }) });
showTab(lsGet(LS.tab, 'today'));
// 下拉更新：今天＝重讀 MLB 數據；撿人＝重抓 Yahoo；即時＝重算比分
pullToRefresh($('#tab-today'), async () => { await load(); });
pullToRefresh($('#tab-pickup'), () => pickup?.refresh?.());
pullToRefresh($('#tab-live'), () => live?.refresh?.());
load();

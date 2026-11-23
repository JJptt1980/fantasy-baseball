import { seasonStats, toMaps, lastFetched } from './mlb.js';
import { projections, luck, injuries, withProjections, annotate } from './projections.js';
import * as ADP from './adp.js';
import * as Y from './yahoo-source.js';
import { buildPlayers, board } from './rank.js';
import { BASE, STRATEGIES, PREFS, buildConfig } from './strategies.js';
import { initPickup } from './pickup-ui.js';
import { initDemo, reloadProfiles } from './demo-ui.js';
import * as PACK from './pack.js';
import { initLive } from './live-ui.js';
import { initDraftSync } from './draft-sync-ui.js';
import { haptic, sound, fxSetting, toast, pullToRefresh, skeleton, sheet, closeSheet, icon } from './ui-kit.js';
import { reasonOf, openPlayerCard, quickList, handleQuickList, statLine as cardStatLine } from './player-card.js';
import { getList } from './mylist.js';
import { isOffseason, nextOpening, daysUntil, refreshOpening } from './season.js';

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
  // 劃記只在「選秀即時同步」進行中使用（自動劃掉被選走的人）；以前手動標的一次清掉
  marks: lsGet('marks.v2', false) ? lsGet(LS.marks, {}) : (lsSet(LS.marks, {}), lsSet('marks.v2', true), {}),
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

// 數字一律四捨五入（混了預測之後會有小數）
const statLine = cardStatLine;

function recompute() {
  if (!state.players) return;
  state.ranked = board(state.players, { ...buildConfig(state.selected, state.prefs), market: state.market });
  renderBoard();
}

function renderBoard() {
  const q = $('#search').value.trim().toLowerCase();
  const pos = $('#filter-pos').value;
  const rows = [];
  let lastRound = 0;
  let shown = 0;
  const ml = getList();
  const mlOf = (id) => (ml.prio.includes(String(id)) ? 'prio' : ml.no.includes(String(id)) ? 'no' : null);
  const onlyList = $('#filter-pos').value === 'ML';
  const lf = state.listFilter ?? null;
  for (const p of state.ranked) {
    if (shown >= 400) break;
    const mark = state.marks[p.id];
    const mk = mlOf(p.id);
    if (onlyList && !mk) continue;
    if (lf && mk !== lf) continue;
    if (q && !p.name.toLowerCase().includes(q)) continue;
    if (pos && !onlyList && !(pos === p.side || pos === p.pos)) continue;
    if (!q && !pos && !lf && p.round !== lastRound) {
      rows.push(`<li class="round-sep">第 ${p.round} 輪</li>`);
      lastRound = p.round;
    }
    shown++;
    rows.push(`<li class="row ${mark || ''} ${mk === 'no' ? 'ml-no' : ''}" data-id="${p.id}">
      <div class="no"><b>${p.rank}</b><span>市${p.marketRank}</span></div>
      <div class="row-m">
        <div class="name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div>
        <div class="why1">${esc(reasonOf(p))}</div>
        <div class="line one">${esc(p.team)}・${p.age} 歲｜${esc(statLine(p))}</div>
      </div>${quickList(p.id, p.name)}</li>`);
  }
  $('#board').innerHTML = rows.join('') || `<li class="muted">${lf === 'prio' ? '最愛名單是空的：按球員右邊的 ⭐ 加入' : lf === 'no' ? '不愛名單是空的：按球員右邊的 🚫 加入' : '沒有符合的球員'}</li>`;
  document.querySelectorAll('[data-lf]').forEach((b) => { const on = b.dataset.lf === lf; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const at = lastFetched(state.season);
  const atTxt = at ? `｜MLB 數據 ${new Date(at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} 抓的（${state.season} 季已結束就不再抓；季中一天最多抓一次）` : '';
  // 說明看過一次（點過球員）就收起來
  $('#board-meta').hidden = lsGet('adv.boardTipSeen', false);
  $('#board-meta').innerHTML = '點球員看詳細（左右滑換人）｜右邊 ⭐＝優先想要、🚫＝不要｜左邊「市」＝別人大概第幾個選他';
  $('#board-src').textContent = `排名根據：${state.dataNote ?? `${state.season} 季成績`}｜「市」來源：${state.marketLabel ?? '自己估計'}${state.adpNote ? `｜${state.adpNote}` : ''}${atTxt}`;
}

// ── 資料來源與金鑰（FantasyPros 金鑰只存在這支手機） ──
function openSources() {
  haptic('tap');
  const has = !!ADP.fpKey.get();
  const box = sheet(`
    <div class="sh-head"><div class="sh-name">資料來源與金鑰</div><button type="button" class="sh-x" data-close aria-label="關閉">✕</button></div>
    <p class="muted small">全部一天最多抓一次，抓到的存在手機裡。</p>
    <div class="sumline">• MLB 官方：成績、明年預測、Statcast、傷兵名單</div>
    <div class="sumline">• ESPN 排名／ADP（公開資料）</div>
    <div class="sumline">• Yahoo 全站 ADP、你們聯盟近兩年順位（用 App 裡的 Yahoo 登入）</div>
    <div class="sumline">• FantasyPros 專家共識＋綜合 ADP（要你自己的金鑰）</div>
    <h3>FantasyPros 金鑰 ${has ? '<span class="tag good">已設定</span>' : '<span class="tag">未設定</span>'}</h3>
    <input id="fp-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${has ? '已存（要換再貼新的）' : '從 Email 複製金鑰貼在這裡'}">
    <p class="muted small">只存在這支手機的 App 裡，不會上傳到其他地方。免費版每天 50 次（App 一天用 2 次），回傳可能被截短。</p>
    <div class="sh-acts"><button type="button" class="btn primary" data-src="save">儲存並測試</button>${has ? '<button type="button" class="btn" data-src="test">測試</button><button type="button" class="btn" data-src="clear">刪除金鑰</button>' : ''}</div>
    <div id="fp-result" class="sumline" style="margin-top:10px"></div>
    <h3>${icon('box')} 資料包（換手機、兩支手機同步用）</h3>
    <p class="muted small">把這支手機的資料存成一個檔案，到另一支手機「從檔案匯入」就一樣了。包含：${Object.values(PACK.PACK_KEYS).join('、')}。不含 FantasyPros 金鑰。</p>
    <div class="sh-acts"><button type="button" class="btn" data-src="export">匯出成檔案</button><button type="button" class="btn" data-src="import">從檔案匯入</button></div>
    <div id="pack-result" class="sumline" style="margin-top:8px"></div>`);
  const out = box.querySelector('#fp-result');
  const test = async () => {
    out.textContent = '連線 FantasyPros 中…';
    try {
      const fp = await ADP.fantasypros(state.season + 1, { force: true });
      out.innerHTML = `${icon('checkCircle')} 成功：專家共識 <b>${fp.ecr.length}</b> 人、綜合 ADP <b>${fp.adp.length}</b> 人（${fp.season} 季）。${fp.ecr.length < 200 ? '<br>人數偏少，免費版可能只給前面一部分。' : ''}`;
      haptic('success');
      loadAdp();
    } catch (e) { out.textContent = `❌ ${e.message}`; haptic('error'); }
  };
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-src]')?.dataset.src;
    if (a === 'save') { const v = box.querySelector('#fp-key').value.trim(); if (!v && !has) { out.textContent = '請先貼上金鑰'; return; } if (v) ADP.fpKey.set(v); box.querySelector('#fp-key').value = ''; test(); }
    if (a === 'test') test();
    if (a === 'clear') { ADP.fpKey.set(''); out.textContent = '已刪除金鑰'; loadAdp(); }
    const pr = box.querySelector('#pack-result');
    if (a === 'export') {
      window.__onFileSaved = (ok) => { pr.innerHTML = ok ? `${icon('checkCircle')} 已存好檔案` : '沒有存檔（取消了或存不進去）'; haptic(ok ? 'success' : 'warn'); };
      if (PACK.exportPack() === 'browser') pr.innerHTML = `${icon('checkCircle')} 已下載檔案`;
    }
    if (a === 'import') {
      PACK.pickPackText().then((text) => {
        if (!text) { pr.textContent = '沒有選檔案'; return; }
        try {
          const done = PACK.applyPack(JSON.parse(text));
          pr.innerHTML = `${icon('checkCircle')} 匯入 ${done.length} 項：${done.map((k) => PACK.PACK_KEYS[k]).join('、')}。重新整理中…`;
          haptic('success');
          setTimeout(() => location.reload(), 1200);
        } catch (err) { pr.textContent = `❌ ${err.message === 'Unexpected end of JSON input' ? '檔案壞掉了' : err.message}`; haptic('error'); }
      });
    }
  });
}

// ── 球員詳情卡（左右滑看選秀表上一位／下一位） ──
function cardOpts(p) {
  const av = state.adp?.get(`${p.side}${p.id}`);
  return { season: state.season, extra: av ? `<div class="sumline">各家順位：${esc(ADP.adpLine(av))}</div>` : '' };
}
function openPlayer(id) {
  const p = state.ranked.find((x) => String(x.id) === String(id));
  if (!p) return;
  const ids = [...document.querySelectorAll('#board .row')].map((r) => r.dataset.id);
  openPlayerCard(p, {
    ...cardOpts(p),
    nav: (cur, dir) => {
      const nid = ids[ids.indexOf(String(cur.id)) + dir];
      const np = nid != null ? state.ranked.find((x) => String(x.id) === nid) : null;
      return np ? { p: np, opts: cardOpts(np) } : null;
    },
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
  $('#open-sources').addEventListener('click', openSources);
  // 設定：震動、聲音開關（預設都開）＋「試一下」
  document.querySelectorAll('[data-fx]').forEach((sw) => {
    sw.checked = fxSetting.get(sw.dataset.fx);
    sw.addEventListener('change', () => { fxSetting.set(sw.dataset.fx, sw.checked); if (sw.checked) { if (sw.dataset.fx === 'vibe') haptic('success'); else sound('pick'); } });
  });
  document.querySelectorAll('[data-fx-test]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.fxTest === 'vibe') haptic('now', { force: true, mute: true }); else sound('now', { force: true });
  }));
  // 打字時（鍵盤打開）把底部分頁列藏起來，不要擠在鍵盤上面
  const typing = (el) => el?.matches?.('input[type=search], input[type=text], textarea');
  document.addEventListener('focusin', (e) => { if (typing(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', (e) => { if (typing(e.target)) document.body.classList.remove('kb'); });

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

  // 選秀方向：預設收合，記住上次開或關
  const sb = $('#strategy-box');
  sb.open = lsGet('adv.stratOpen', false);
  sb.addEventListener('toggle', () => lsSet('adv.stratOpen', sb.open));

  const notes = $('#my-notes');
  notes.value = lsGet(LS.notes, '');
  notes.addEventListener('input', () => lsSet(LS.notes, notes.value));

  $('#search').addEventListener('input', renderBoard);
  $('#filter-pos').addEventListener('change', renderBoard);
  window.addEventListener('mylist:change', renderBoard);
  // 最愛／不愛：只看自己名單裡的人，再按一次回到全部
  document.querySelectorAll('[data-lf]').forEach((b) => b.addEventListener('click', () => {
    haptic('tap');
    state.listFilter = state.listFilter === b.dataset.lf ? null : b.dataset.lf;
    renderBoard();
    window.scrollTo(0, 0);
  }));
  // 搜尋列右邊的「同步」小按鈕：打開／收起選秀即時同步
  const dsBox = $('#ds-box');
  const dsTg = $('#ds-toggle');
  dsTg.addEventListener('click', () => { haptic('tap'); dsBox.open = !dsBox.open; });
  dsBox.addEventListener('toggle', () => { dsTg.setAttribute('aria-expanded', dsBox.open); dsTg.classList.toggle('open', dsBox.open); });


  $('#board').addEventListener('click', (e) => {
    if (handleQuickList(e)) return;
    const row = e.target.closest('.row');
    if (!row) return;
    if (!lsGet('adv.boardTipSeen', false)) { lsSet('adv.boardTipSeen', true); $('#board-meta').hidden = true; }
    openPlayer(row.dataset.id);
  });
}

const PAGES = ['demo', 'draft', 'pickup', 'live', 'more'];
// 返回手勢用：記住走過的分頁
const tabHist = [];
let curTab = null;
function showTab(tab, { fromBack = false } = {}) {
  if (!PAGES.includes(tab)) tab = 'demo';
  if (!fromBack && curTab && curTab !== tab) { tabHist.push(curTab); if (tabHist.length > 20) tabHist.shift(); }
  curTab = tab;
  document.getElementById('toast')?.classList.remove('show'); // 換頁就收起上一頁的「復原」
  document.querySelectorAll('.tb').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const p of PAGES) $(`#tab-${p}`).hidden = p !== tab;
  $('#mini-title').textContent = $(`#tab-${tab} .large-title`)?.textContent ?? '';
  window.scrollTo(0, 0);
  watchTitle(tab);
  if (tab === 'live' || tab === 'pickup') renderOffseason();
  if (tab === 'live') live?.onShow();
  if (tab === 'pickup') pickup?.onShow();
  if (tab === 'demo') document.dispatchEvent(new Event('demo:shown'));
  lsSet(LS.tab, tab);
}

// 休賽季：「球季中」「即時」顯示說明卡＋開季倒數，藏起季中才用得到的東西
function renderOffseason() {
  const off = isOffseason();
  const d = nextOpening();
  const txt = d ? `開季還有 ${daysUntil(d)} 天` : '';
  const sub = d ? `（${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日）` : '';
  for (const k of ['pk', 'lv']) {
    $(`#${k}-off`).hidden = !off;
    $(`#${k}-off-days`).innerHTML = `${txt}<small>${sub}</small>`;
  }
  $('#tab-pickup').classList.toggle('off', off);
  $('#tab-live').classList.toggle('off', off);
}
refreshOpening().then(() => { if (curTab === 'live' || curTab === 'pickup') renderOffseason(); });
refreshOpening(new Date().getFullYear() + 1);

// 大標題捲出畫面 → 頂列顯示小標題
let titleObs = null;
function watchTitle(tab) {
  titleObs?.disconnect();
  const t = $(`#tab-${tab} .large-title`);
  if (!t || !('IntersectionObserver' in window)) return;
  titleObs = new IntersectionObserver(([e]) => {
    $('.topbar').classList.toggle('scrolled', !e.isIntersecting);
    document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
  }, { rootMargin: '-44px 0px 0px 0px' });
  titleObs.observe(t);
}


async function load() {
  state.season = lastSeason();
  setStatus(`讀取 ${state.season} 與 ${state.season - 1} 季 MLB 數據中…（第一次比較久）`);
  if (!state.players) $('#board').innerHTML = skeleton(8);
  try {
    const [cur, prev, prev2] = await Promise.all([seasonStats(state.season), seasonStats(state.season - 1), seasonStats(state.season - 2)]);
    const years = [toMaps(cur), toMaps(prev), toMaps(prev2)];
    // 額外資料：抓不到就略過（不影響基本選秀表）
    setStatus(`讀取 ${state.season + 1} 預測、Statcast、傷兵名單…`);
    const [proj, lk, inj] = await Promise.all([
      projections(state.season + 1).catch(() => null),
      luck(state.season).catch(() => null),
      injuries().catch(() => null),
    ]);
    const mixed = withProjections(years[0], proj?.sources.length ? proj : null, years);
    state.players = annotate(buildPlayers(mixed, years[1]), { luck: lk, inj, src: mixed.src });
    state.dataNote = proj?.sources.length ? `${state.season + 1} 預測（MLB ${proj.sources.join('、')}）60%＋${state.season} 實際 40%` : `${state.season} 實際成績（預測讀不到，改用 Marcel 推估）`;
    setStatus('');
    recompute();
    loadAdp();
  } catch (e) {
    console.error(e);
    haptic('error');
    $('#board').innerHTML = '';
    setStatus(`${e.message || '讀取失敗'}。請確認網路連線後按重試。`, 'error', () => load());
  }
}

// 各家 ADP（背景讀，讀到就重排）：ESPN 隨處可讀；Yahoo 全站與聯盟歷史要在 App 裡（用你的 Yahoo 登入）
async function loadAdp() {
  const season = state.season + 1;
  const app = Y.hasBridge();
  const [es, ya, lg, fp] = await Promise.all([
    ADP.espn(season).catch(() => undefined),
    app ? ADP.yahoo().catch(() => undefined) : null,
    app ? ADP.league().catch(() => undefined) : null,
    ADP.fantasypros(season).catch((e) => ({ error: e.message })),
  ]);
  const note = [];
  if (es === null) note.push(`ESPN ${season} 排名還沒公布`);
  if (es === undefined) note.push('ESPN 讀取失敗');
  if (fp?.error) note.push(fp.error);
  else if (!fp) note.push('FantasyPros 還沒設定金鑰（更多 → 資料來源）');
  if (!app) note.push('Yahoo 要在 App 裡才讀得到');
  else if (!ya) note.push(`Yahoo ${season} ADP 還沒開放`);
  state.adp = ADP.attach(state.players, { yahoo: ya, espn: es, league: lg, fp: fp?.error ? null : fp });
  const src = ADP.marketSource(state.adp);
  state.market = src ? new Map([...state.adp].filter(([, v]) => v[src.key] != null).map(([k, v]) => [k, v[src.key]])) : null;
  state.marketLabel = src?.label ?? '自己估計';
  state.adpNote = note.join('、');
  recompute();
}

// 手機的「返回」（從邊緣往內滑）：先關彈出視窗 → 離開放大模式 → 回上一頁 → 回「今天」→ 再滑一次才離開 App
let exitArmed = 0;
window.__appBack = () => {
  if (document.querySelector('.sheet-bg')) { closeSheet(); return 'handled'; }
  const fm = document.getElementById('ds-focus');
  if (fm && !fm.hidden) { fm.querySelector('#ds-focus-close')?.click(); return 'handled'; }
  if (document.activeElement?.matches?.('input, textarea')) { document.activeElement.blur(); return 'handled'; }
  const prev = tabHist.pop();
  if (prev && prev !== curTab) { showTab(prev, { fromBack: true }); return 'handled'; }
  if (curTab !== 'demo') { showTab('demo', { fromBack: true }); return 'handled'; }
  if (Date.now() - exitArmed < 2000) return 'exit';
  exitArmed = Date.now();
  toast('再滑一次離開', { ms: 2000 });
  return 'handled';
};

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
live = initLive({ getBoard: () => state.ranked });
initDemo({ getBoard: () => state.ranked, getConfig: () => buildConfig(state.selected, state.prefs), getSeason: () => state.season, getSelection: () => ({ selected: [...state.selected], prefs: [...state.prefs] }) });
showTab(lsGet(LS.tab, 'demo'));
// 內建資料包：手機裡還沒有的資料（對手 10 年習慣、聯盟順位）直接補上，不用等 Yahoo 慢慢讀
PACK.seedBundled().then((done) => { if (done.includes('demo.profiles')) reloadProfiles(); });
// 下拉更新：撿人＝重抓 Yahoo 陣容與自由球員；即時＝重抓今天比分（今天頁的資料一天才抓一次，不用下拉）
pullToRefresh($('#tab-pickup'), () => pickup?.refresh?.());
pullToRefresh($('#tab-live'), () => live?.refresh?.());
load();

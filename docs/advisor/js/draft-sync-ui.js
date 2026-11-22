// 選秀頁「🔄 選秀即時同步」：自動標我選／被選、還差幾順位、前 3 推薦、預測下一輪、快輪到時震動
import * as Y from './yahoo-source.js';
import { yahooSource, replaySource, nextDelay, RateLimited } from './draft-source.js';
import { haptic, toast } from './ui-kit.js';
import { draftState, recommend, predictAvailable, openSlots, TEAMS, ROUNDS } from './draft-sync.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { slot: 'ds.slot', mode: 'ds.mode', speed: 'ds.speed' };
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 略 */ } }

const st = {
  running: false, timer: null, source: null, league: null, myTeam: null, errors: 0,
  lastPoll: null, nextAt: null, buzzed: new Set(), recBefore: null, practiceLog: [], ctx: null,
};

function status(msg, kind = '') {
  const el = $('#ds-status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);

// ── 資料來源 ──
async function latestLeague() {
  const ls = await Y.leagues();
  const latest = Math.max(...ls.map((l) => l.season));
  return ls.find((l) => l.season === latest);
}

// 練習用：App 內讀聯盟最近一年的真實選秀；電腦瀏覽器沒有 Yahoo → 用選秀表模擬 11 隊照市場排名選
function fakeDraft(board) {
  const avail = [...board].sort((a, b) => a.marketRank - b.marketRank);
  const picks = [];
  const taken = new Set();
  for (let o = 1; o <= TEAMS * ROUNDS; o++) {
    const round = Math.ceil(o / TEAMS);
    const k = (o - 1) % TEAMS;
    const slot = round % 2 ? k + 1 : TEAMS - k;
    const p = avail.find((x) => !taken.has(x.id) && (slot === 6 ? true : true));
    taken.add(p.id);
    picks.push({ overall: o, round, pick: k + 1, name: p.side === 'P' && board.some((x) => x.id === p.id && x.side === 'B') ? `${p.name} (Pitcher)` : p.name, team: slot === 6 ? '示範：我的隊' : `示範隊 ${slot}` });
  }
  return picks;
}

async function start() {
  const mode = $('#ds-mode').value;
  lsSet(LS.mode, mode);
  stop();
  st.errors = 0;
  st.buzzed.clear();
  st.practiceLog = [];
  st.recBefore = null;
  try {
    if (mode === 'yahoo') {
      if (!Y.hasBridge()) throw new Error('即時同步要在 Android App 裡用（需要登入 Yahoo）');
      status('讀取 Yahoo 聯盟…');
      st.league = await latestLeague();
      st.myTeam = st.league.teamName;
      st.source = yahooSource(st.league);
    } else {
      const speed = Number($('#ds-speed').value);
      lsSet(LS.speed, speed);
      let picks;
      if (Y.hasBridge()) {
        status('讀取聯盟最近一年的真實選秀結果（練習用）…');
        st.league = await latestLeague();
        st.myTeam = st.league.teamName;
        picks = await Y.draftResults(st.league);
        if (!picks.length) throw new Error('讀不到選秀結果');
      } else {
        picks = fakeDraft(st.getBoard());
        st.myTeam = '示範：我的隊';
      }
      st.source = replaySource(picks, { secondsPerPick: speed });
      // 練習不能弄髒正式的選秀表：先存下原本的標記，停止時還原
      st.savedMarks = JSON.parse(JSON.stringify(st.getMarks()));
    }
    st.running = true;
    renderButtons();
    status('');
    tick();
  } catch (e) {
    console.error(e);
    status(e instanceof Y.LoginNeeded ? '請先到「撿人」頁登入 Yahoo。' : e.message, 'error');
  }
}

function stop() {
  clearTimeout(st.timer);
  st.running = false;
  if (st.savedMarks) { st.setMarks(st.savedMarks); st.savedMarks = null; }
  if ($('#ds-focus') && !$('#ds-focus').hidden) openFocus(false);
  // 停止後清掉舊的倒數與推薦，免得誤以為還在同步
  st.ctx = null;
  $('#ds-panel').innerHTML = '';
  renderButtons();
  renderMeta();
}

async function tick() {
  if (!st.running) return;
  let picksUntil = null;
  let rateLimited = false;
  try {
    const { picks } = await st.source.poll();
    st.lastPoll = Date.now();
    st.errors = 0;
    picksUntil = update(picks);
  } catch (e) {
    console.error(e);
    st.errors++;
    rateLimited = e instanceof RateLimited;
    status(rateLimited ? e.message : `讀取失敗（第 ${st.errors} 次）：${e.message}，稍後自動重試`, 'error');
  }
  const delay = nextDelay({ picksUntil, errors: st.errors, rateLimited, replay: st.source?.kind === 'replay' });
  st.nextAt = Date.now() + delay;
  if (st.running) st.timer = setTimeout(tick, delay);
  renderMeta();
}

// ── 同步與計算 ──
function update(picks) {
  st.lastPicks = picks;
  const board = st.getBoard();
  if (!board?.length) return null;
  const manualSlot = Number($('#ds-slot').value) || null;
  const s = draftState({ picks, board, myTeam: st.myTeam, mySlot: manualSlot });
  // 自動標記：我選的 → 我選；其他 → 被選
  const marks = {};
  for (const m of s.made) if (m.player) marks[m.player.id] = m.team === st.myTeam ? 'mine' : 'taken';
  st.applyMarks(marks);

  // 練習：記下「輪到你之前 App 推薦什麼、你實際選了誰」
  const lastMine = [...s.made].reverse().find((m) => m.team === st.myTeam);
  if (lastMine && st.recBefore && st.recBefore.overall === lastMine.overall && !st.practiceLog.some((x) => x.overall === lastMine.overall)) {
    st.practiceLog.push({ overall: lastMine.overall, round: lastMine.round, picked: lastMine.player?.name ?? lastMine.name, recs: st.recBefore.recs });
  }

  // 你手動按「被選走」的人也當成被選走（Yahoo 還沒更新也立刻生效）
  const marked = st.getMarks?.() ?? {};
  for (const p of board) if (marked[p.id] === 'taken') s.takenIds.add(p.id);
  const recs = s.done || !s.slot ? [] : recommend({ board, takenIds: s.takenIds, myPlayers: s.mine, picksUntil: s.picksUntil, myPicksLeft: s.myPicksLeft, n: 5 });
  if (s.myNext && s.picksUntil <= 1) st.recBefore = { overall: s.myNext, recs: recs.slice(0, 3).map((r) => r.p.name) };
  const atMine = s.picksUntil != null ? predictAvailable({ board, takenIds: s.takenIds, k: s.picksUntil }) : null;

  // 震動：剩 2 順位提醒一次、輪到你再提醒一次
  if (s.myNext && s.picksUntil != null) {
    const key = `${s.myNext}:${s.picksUntil === 0 ? 'now' : 'soon'}`;
    if (s.picksUntil <= 2 && !st.buzzed.has(key)) {
      st.buzzed.add(key);
      haptic(s.picksUntil === 0 ? 'now' : 'soon');
    }
  }
  if (s.done && !st.buzzed.has('done')) { st.buzzed.add('done'); haptic('success'); }
  st.ctx = { s, recs, atMine, board };
  render();
  renderFocus();
  return s.picksUntil;
}

// 前 3 名＋建議程度（⭐⭐⭐／⭐⭐／⭐），下面一行備案：上面的被選走了改選誰
function starRows(recs) {
  const top = recs[0];
  const lv = (r, i) => (i === 0 ? 3 : r.score >= top.score - Math.abs(top.score) * 0.05 ? 2 : r.score >= top.score - Math.abs(top.score) * 0.15 ? 1 : 0);
  const TAG = ['<span class="tag">備案</span>', '<span class="tag lv1">⭐ 可以考慮</span>', '<span class="tag lv2">⭐⭐ 也很好</span>', '<span class="tag lv3">⭐⭐⭐ 最推薦</span>'];
  return recs.slice(0, 3).map((r, i) => `<div class="mn-row"><div><b>${esc(r.p.name)}</b> <span class="pos">${esc(r.p.pos)}</span> ${TAG[lv(r, i)]}
      <div class="muted small">${esc(r.reasons[0] ?? '')}</div></div>${takenBtn(r.p)}</div>`).join('') + backupLine(recs);
}
// 「被選走」：在 Yahoo 看到別人選了他，按一下立刻從推薦拿掉（可復原）
const takenBtn = (p) => `<button type="button" class="btn taken-btn" data-taken="${p.id}" aria-label="${esc(p.name)} 被別人選走了">被選走</button>`;
function markTaken(id) {
  const before = { ...(st.getMarks?.() ?? {}) };
  const p = st.getBoard().find((x) => x.id === id);
  st.applyMarks({ [id]: 'taken' });
  haptic('mark');
  if (st.lastPicks) update(st.lastPicks);
  toast(`${p?.name ?? ''} 被選走了`, { undo: () => { st.setMarks(before); if (st.lastPicks) update(st.lastPicks); } });
}

function backupLine(recs) {
  const b = recs.slice(3, 5);
  return b.length ? `<div class="backup">🔄 上面的被選走了？改選：<b>${b.map((r) => esc(r.p.name)).join('</b>、<b>')}</b></div>` : '';
}

// ── 選秀專注模式：全螢幕只顯示「還差幾順位＋前 3 推薦＋剛剛誰被選」 ──
function renderFocus() {
  const box = $('#ds-focus');
  if (!box || box.hidden || !st.ctx) return;
  const { s, recs } = st.ctx;
  const now = s.picksUntil === 0;
  const big = s.done ? '✅' : s.picksUntil == null ? '?' : now ? '輪到你' : s.picksUntil;
  const sub = s.done ? '選秀結束' : s.picksUntil == null ? '還不知道你第幾個選' : now ? `總第 ${s.myNext} 位` : `個人後輪到你`;
  const last = s.made.slice(-3).reverse();
  box.innerHTML = `
    <div class="fc-top"><span class="muted small">第 ${s.done ? ROUNDS : Math.ceil(s.nextOverall / TEAMS)} 輪｜已選 ${s.made.length}/${TEAMS * ROUNDS}</span><button type="button" class="btn" id="ds-focus-close">離開</button></div>
    <div class="fc-hero ${now ? 'now' : ''}"><div class="fc-n">${big}</div><div class="fc-s">${esc(sub)}</div></div>
    ${now ? '<button type="button" class="btn primary fc-room" id="ds-room">打開 Yahoo 選秀室</button>' : ''}
    ${recs.length ? `<h3>App 建議選 <span class="muted small">（別人選走了就按「被選走」）</span></h3>${recs.slice(0, 3).map((r, i) => `<div class="fc-rec"><div class="fc-i">${i + 1}</div><div><div class="fc-name">${esc(r.p.name)} <span class="pos">${esc(r.p.pos)}</span></div><div class="muted small">${esc(r.reasons[0] ?? '')}</div></div>${takenBtn(r.p)}</div>`).join('')}${backupLine(recs)}` : ''}
    ${last.length ? `<h3>剛剛被選</h3>${last.map((m) => `<div class="sumline small">${m.overall}. ${esc(m.player?.name ?? m.name)}<span class="muted">｜${esc(m.team ?? '')}</span></div>`).join('')}` : ''}`;
}
function openFocus(on) {
  let box = $('#ds-focus');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ds-focus';
    box.className = 'focus-mode';
    box.hidden = true;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target.id === 'ds-focus-close') openFocus(false);
      if (e.target.id === 'ds-room') openRoom();
      const t = e.target.closest('[data-taken]');
      if (t) markTaken(Number(t.dataset.taken));
    });
  }
  box.hidden = !on;
  document.body.classList.toggle('no-scroll', on);
  haptic('tap');
  // 專注模式時螢幕不要自動關掉（支援的瀏覽器才有）
  if (on) navigator.wakeLock?.request('screen').then((l) => { st.wake = l; }).catch(() => {});
  else { st.wake?.release?.(); st.wake = null; }
  renderFocus();
}
function openRoom() {
  // 開 Yahoo 聯盟首頁（選秀進行中上面有「進入選秀室」）；App 會交給 Yahoo App 或瀏覽器開
  const url = st.league ? `https://baseball.fantasysports.yahoo.com/${st.league.key}` : 'https://baseball.fantasysports.yahoo.com/';
  window.location.href = url;
}

// ── 畫面 ──
// 別人選了清單外的人：打名字找到他 → 按「被選走」
function renderOther() {
  const q = $('#ds-q').value.trim().toLowerCase();
  const res = $('#ds-q-res');
  if (q.length < 2) { res.innerHTML = '<div class="muted small">打 2 個字以上</div>'; return; }
  const marks = st.getMarks?.() ?? {};
  const taken = new Set([...(st.ctx?.s.takenIds ?? [])]);
  const hits = st.getBoard().filter((p) => p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) && !taken.has(p.id) && !marks[p.id]).slice(0, 6);
  res.innerHTML = hits.map((p) => `<div class="mn-row"><div><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span> <span class="muted small">選秀表第 ${p.rank}</span></div>${takenBtn(p)}</div>`).join('') || '<div class="muted small">找不到（可能已經標過了）</div>';
}

function renderButtons() {
  $('#ds-other').hidden = !st.running;
  $('#ds-start').hidden = st.running;
  $('#ds-stop').hidden = !st.running;
  $('#ds-pause').hidden = !(st.running && st.source?.kind === 'replay');
  if (st.source?.kind === 'replay') $('#ds-pause').textContent = st.source.paused ? '▶ 繼續' : '⏸ 暫停';
}

function renderMeta() {
  const el = $('#ds-meta');
  if (!st.running) { el.textContent = ''; return; }
  const src = st.source?.label ?? '';
  el.textContent = `${src}｜上次更新 ${st.lastPoll ? hhmmss(st.lastPoll) : '-'}${st.source?.kind === 'yahoo' && st.nextAt ? `｜下次 ${Math.max(0, Math.round((st.nextAt - Date.now()) / 1000))} 秒後` : ''}`;
}

function playerRow(p, extra = '') {
  return `<div class="mn-row"><div><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span> <span class="muted small">選秀表第 ${p.rank}｜市 ${p.marketRank}</span>${extra}</div></div>`;
}

function render() {
  const c = st.ctx;
  if (!c) return;
  const { s, recs, atMine } = c;
  const panel = $('#ds-panel');
  const cur = s.done ? null : s.nextOverall;
  const curRound = cur ? Math.ceil(cur / TEAMS) : ROUNDS;
  let banner = '';
  if (s.done) banner = '<div class="ds-banner">✅ 選秀結束</div>';
  else if (!s.slot) banner = '<div class="ds-banner warn">還不知道你第幾個選：在上面選「你第幾個選」，或等你第 1 輪選完，App 會自己知道。</div>';
  else if (s.picksUntil === 0) banner = `<div class="ds-banner now"><span>⏰ 輪到你了！</span><button type="button" class="btn primary" id="ds-room">打開 Yahoo 選秀室</button></div>`;
  else banner = `<div class="ds-banner"><span>再 <b>${s.picksUntil}</b> 個人就輪到你（大約 ${s.picksUntil} 分鐘）</span></div>`;

  const open = openSlots(s.mine);
  const cnt = open.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const missing = Object.entries(cnt).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('、');

  const recHtml = recs.length ? `<h3>App 建議選 <span class="muted small">（別人選走了就按「被選走」，會立刻換人）</span></h3>${starRows(recs)}` : '';
  const predHtml = atMine && s.picksUntil > 0 ? `<details class="sub"><summary>輪到你時，大概還剩誰？</summary>
      <div class="sumline">應該還在：${atMine.stay.slice(0, 6).map((p) => esc(p.name)).join('、')}</div>
      <div class="sumline muted">可能被搶走：${atMine.gone.sort((a, b) => a.rank - b.rank).slice(0, 6).map((p) => esc(p.name)).join('、') || '—'}</div></details>` : '';
  const logHtml = st.practiceLog.length ? `<details class="sub"><summary>你選的 vs App 建議的（${st.practiceLog.length} 次）</summary>
      ${st.practiceLog.map((x) => `<div class="sumline small">第 ${x.round} 輪：你選 <b>${esc(x.picked)}</b>｜App 推薦 ${x.recs.map(esc).join('、') || '—'}${x.recs.includes(x.picked) ? ' ✅' : ''}</div>`).join('')}</details>` : '';

  panel.innerHTML = `${banner}
    ${s.done ? '' : '<button type="button" class="btn" id="ds-focus-open">⛶ 放大模式（只看最重要的）</button>'}
    ${st.source?.kind === 'replay' ? '<div class="muted small">練習中：選秀表上的劃記是暫時的，按「停止」就會恢復原狀。</div>' : ''}
    <div class="sumline muted small">第 ${curRound} 輪｜你第 ${s.slot ?? '?'} 個選｜你已經選了 ${s.mine.length} 人</div>
    <div class="sumline">${open.length ? `還缺：<b>${esc(missing)}</b>` : '上場位置都有人了'}${s.mine.length ? `<span class="muted small">｜${s.mine.map((p) => esc(p.name)).join('、')}</span>` : ''}</div>
    ${recHtml}${predHtml}${logHtml}
    ${s.unmatched.length ? `<div class="muted small">對不到選秀表的球員（多半是冷門或新人）：${s.unmatched.slice(-5).map(esc).join('、')}</div>` : ''}`;
}

export function initDraftSync({ getBoard, applyMarks, getMarks, setMarks }) {
  st.getBoard = getBoard;
  st.applyMarks = applyMarks;
  st.getMarks = getMarks;
  st.setMarks = setMarks;
  $('#ds-slot').innerHTML = '<option value="">自動偵測</option>' + Array.from({ length: TEAMS }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 順位</option>`).join('');
  $('#ds-slot').value = String(lsGet(LS.slot, ''));
  $('#ds-mode').value = lsGet(LS.mode, 'replay');
  $('#ds-speed').value = String(lsGet(LS.speed, 4));
  const syncMode = () => { $('#ds-speed-wrap').hidden = $('#ds-mode').value !== 'replay'; };
  syncMode();
  $('#ds-mode').addEventListener('change', syncMode);
  $('#ds-slot').addEventListener('change', (e) => { lsSet(LS.slot, e.target.value); if (st.running) tick(); });
  $('#ds-start').addEventListener('click', start);
  $('#ds-q').addEventListener('input', renderOther);
  $('#ds-other').addEventListener('click', (e) => {
    const t = e.target.closest('[data-taken]');
    if (t) { markTaken(Number(t.dataset.taken)); $('#ds-q').value = ''; renderOther(); }
  });
  $('#ds-stop').addEventListener('click', stop);
  $('#ds-pause').addEventListener('click', () => {
    if (st.source?.paused) st.source.resume(); else st.source?.pause();
    renderButtons();
  });
  $('#ds-panel').addEventListener('click', (e) => {
    const t = e.target.closest('[data-taken]');
    if (t) return markTaken(Number(t.dataset.taken));
    if (e.target.id === 'ds-focus-open') openFocus(true);
    if (e.target.id === 'ds-room') openRoom();
  });
  setInterval(() => { if (st.running) renderMeta(); }, 1000);
}

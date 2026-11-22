// 撿人頁：登入 Yahoo → 抓我的陣容、對手、自由球員 → 三張推薦表（打勾＋備註）
import * as Y from './yahoo-source.js';
import { rangeStats, toMaps } from './mlb.js';
import { recommend, recentWindow, weeklyIndex, CAT_LABEL } from './pickup.js';
import { moveBudget, budgetMessage } from './budget.js';
import { haptic, toast, swipeRows, skeleton, sheet, closeSheet } from './ui-kit.js';

const $ = (s) => document.querySelector(s);
const LS = { league: 'pk.league', wants: 'pk.wants', picks: 'pk.picks', mode: 'pk.mode', side: 'pk.side' };
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 略 */ } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CHIPS = [
  ['救援', '救援'], ['中繼', '中繼'], ['盜壘', '盜壘'], ['全壘打', '全壘打'],
  ['打擊率', '打擊率'], ['先發局數', '局數'], ['ERA/WHIP', '防禦率 whip'],
];

const MODE_DESC = {
  recent: '看最近兩週誰打得最好。',
  fit: '找能補你弱項的人（你哪一類比別隊差，就補哪一類）。',
  opp: '找這週對付對手最有用的人（差一點就能贏的類別優先）。',
};

const st = {
  leagues: [], league: null, weeks: [], week: null,
  myRoster: [], oppRoster: null, oppName: null, myName: null, fa: [],
  idx: null, win: null, result: null,
  mode: lsGet(LS.mode, 'recent'), side: lsGet(LS.side, 'B'),
  wants: lsGet(LS.wants, ''), picks: lsGet(LS.picks, {}),
  loaded: false, busy: false,
};

function status(msg, kind = '') {
  const el = $('#pk-status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

function fmt(v, d = 1) { return Number.isFinite(v) ? v.toFixed(d) : '-'; }
function rate(v) { return Number.isFinite(v) ? v.toFixed(3).replace(/^0/, '') : '-'; }

function lineOf(p) {
  if (p.side === 'B') return `每週 R ${fmt(p.R)}｜HR ${fmt(p.HR)}｜RBI ${fmt(p.RBI)}｜SB ${fmt(p.SB)}｜AVG ${rate(p.AVG)}｜OPS ${rate(p.OPS)}`;
  const era = p.IP ? (p.ER * 9) / p.IP : NaN;
  const whip = p.IP ? p.WH / p.IP : NaN;
  return `每週 ${fmt(p.IP)} 局｜K ${fmt(p.K)}｜W ${fmt(p.W)}｜SV ${fmt(p.SV)}｜HLD ${fmt(p.HLD)}｜ERA ${fmt(era, 2)}｜WHIP ${fmt(whip, 2)}`;
}

// ── 讀資料 ──

async function loadAll({ keepWeek = false } = {}) {
  if (st.busy) return;
  st.busy = true;
  try {
    status('讀取 Yahoo 聯盟…');
    if (!st.result) $('#pk-list').innerHTML = skeleton(6);
    st.leagues = await Y.leagues();
    if (!st.leagues.length) throw new Error('找不到你的 Yahoo 聯盟');
    const latest = Math.max(...st.leagues.map((l) => l.season));
    const cand = st.leagues.filter((l) => l.season === latest);
    const saved = lsGet(LS.league, null);
    st.league = cand.find((l) => l.key === saved) ?? cand[0];
    $('#pk-league').innerHTML = cand.map((l) => `<option value="${esc(l.key)}">${esc(l.name)}</option>`).join('');
    $('#pk-league').value = st.league.key;
    await loadLeague(keepWeek ? st.week : null);
  } catch (e) {
    handleError(e);
  } finally {
    st.busy = false;
  }
}

async function loadLeague(week) {
  const lg = st.league;
  lsSet(LS.league, lg.key);
  status('讀取對戰與陣容…');
  const mu = await Y.matchup(lg, week);
  st.weeks = mu.weeks;
  st.week = mu.week;
  $('#pk-week').innerHTML = st.weeks.map((w) => `<option value="${w}">第 ${w} 週</option>`).join('');
  if (st.week) $('#pk-week').value = String(st.week);

  const [me, opp] = mu.matchup?.teams ?? [];
  const myId = lg.teamId ?? me?.key;
  st.myName = lg.teamName ?? me?.name ?? '我的隊';
  st.oppName = opp?.name ?? null;
  const [myRoster, oppRoster, fa, rules, teams] = await Promise.all([
    Y.roster(lg, myId),
    opp ? Y.roster(lg, opp.key) : Promise.resolve(null),
    Y.freeAgents(lg),
    Y.rules(lg).catch(() => null),
    Y.teams(lg).catch(() => []),
  ]);
  const mine = teams.find((t) => String(t.teamId) === String(myId));
  st.budget = rules && mine ? moveBudget({ cap: rules.maxSeason, used: mine.moves, week: mu.week, playoffWeeks: rules.playoffWeeks, weekCap: rules.maxWeek, seasonOver: seasonOver(mu.week, rules.playoffWeeks) }) : null;
  renderBudget();
  st.myRoster = myRoster;
  st.oppRoster = oppRoster;
  st.fa = fa;

  status('讀取 MLB 近況數據…');
  st.win = await recentWindow(14);
  st.idx = weeklyIndex(toMaps(await rangeStats(st.win.start, st.win.end)), st.win.days);
  st.loaded = true;
  $('#pk-who').textContent = `${lg.name}｜${st.myName}`;
  $('#pk-login').textContent = '登出';
  status('');
  compute();
}

async function changeWeek(week) {
  if (st.busy || !st.league) return;
  st.busy = true;
  try {
    await loadLeague(Number(week));
  } catch (e) {
    handleError(e);
  } finally {
    st.busy = false;
  }
}

function handleError(e) {
  console.error(e);
  if (e instanceof Y.LoginNeeded) {
    $('#pk-who').textContent = '尚未登入';
    $('#pk-login').textContent = '登入 Yahoo';
    status('請按「登入 Yahoo」。登入一次之後 App 會記住。', 'error');
  } else {
    status(`${e.message || '讀取失敗'}。請確認網路連線後按重試。`, 'error');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn status-act';
    b.textContent = '重試';
    b.onclick = () => loadAll({ keepWeek: true });
    $('#pk-status').append(b);
  }
  if (!st.result) $('#pk-list').innerHTML = '';
  haptic('error');
}

// ── 計算與畫面 ──

function compute() {
  if (!st.loaded) return;
  st.result = recommend({ idx: st.idx, myRoster: st.myRoster, oppRoster: st.oppRoster, freeAgents: st.fa, wants: st.wants });
  renderSummary();
  renderList();
  renderPicked();
}

function renderSummary() {
  const r = st.result;
  const box = $('#pk-summary');
  const weak = [...r.gaps].sort((a, b) => a[1] - b[1]).slice(0, 4);
  const strong = [...r.gaps].sort((a, b) => b[1] - a[1]).slice(0, 3);
  let oppHtml = '<div class="sumline muted">這週沒有對手（輪空或季後賽已結束），「配合對手」表不會出現。</div>';
  if (r.oppLine) {
    const close = [...r.swing].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1])).slice(0, 5);
    const win = r.swing.filter(([, m]) => m > 0.5).length;
    const lose = r.swing.filter(([, m]) => m < -0.5).length;
    oppHtml = `<div class="sumline">對手 <b>${esc(st.oppName)}</b>：預估你領先 ${win} 類、落後 ${lose} 類、${18 - win - lose} 類拉鋸</div>
      <div class="sumline">關鍵拉鋸：${close.map(([c, m]) => `<span class="tag ${m >= 0 ? 'good' : 'bad'}">${esc(CAT_LABEL[c])} ${m >= 0 ? '小贏' : '小輸'}</span>`).join('')}</div>`;
  }
  box.hidden = false;
  box.innerHTML = `
    <div class="sumline muted small">近況期間：${esc(st.win.start)}～${esc(st.win.end)}（${st.win.days} 天，換算成一週）｜可撿球員 ${st.fa.length} 人</div>
    <div class="sumline">你的弱項：${weak.map(([c]) => `<span class="tag bad">${esc(CAT_LABEL[c])}</span>`).join('')}
      強項：${strong.map(([c]) => `<span class="tag good">${esc(CAT_LABEL[c])}</span>`).join('')}</div>
    ${oppHtml}
    ${r.missing.length ? `<div class="sumline muted small">找不到近況數據（最近沒上場或名字對不上）：${esc(r.missing.join('、'))}</div>` : ''}`;
}

// 休賽季：已經是最後一個季後賽週，而且現在是 10 月～2 月
function seasonOver(week, playoffWeeks) {
  const m = new Date().getMonth();
  return week >= (playoffWeeks?.at(-1) ?? 26) && (m >= 9 || m <= 1);
}

// 一句話理由（依目前的推薦方式換說法）
function whyLine(why) {
  if (!why?.length) return '綜合分數高，沒有特別突出的單一類別';
  const w = why.join('、');
  if (st.mode === 'fit') return `補你的弱項：${w}`;
  if (st.mode === 'opp') return `這週對手的 ${w} 跟你差一點，撿他最有機會翻盤`;
  return `最近 14 天 ${w} 表現突出`;
}

function renderList() {
  document.querySelectorAll('#pk-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
  document.querySelectorAll('#pk-side button').forEach((b) => b.classList.toggle('on', b.dataset.side === st.side));
  $('#pk-mode-desc').textContent = MODE_DESC[st.mode];
  const list = st.result?.lists[st.mode]?.[st.side];
  if (!st.result) { $('#pk-list').innerHTML = ''; return; }
  if (!list) {
    $('#pk-list').innerHTML = '<li class="muted small">這週沒有對手，請在上面換一個有對手的週次。</li>';
    return;
  }
  $('#pk-list').innerHTML = list.map((x, i) => {
    const p = x.p;
    const pick = st.picks[p.id] ?? {};
    return `<li class="pk ${pick.on ? 'checked' : ''}" data-id="${p.id}" data-name="${esc(p.name)}">
      <input type="checkbox" ${pick.on ? 'checked' : ''} aria-label="要撿 ${esc(p.name)}">
      <div>
        <div class="name">${i + 1}. ${esc(p.name)}<span class="pos">${esc(p.pos)}</span>${x.yahoo?.status ? ` <span class="tag warn">${esc(x.yahoo.status)}</span>` : ''}</div>
        <div class="line">${esc(p.team)}｜${esc(lineOf(p))}</div>
        <div class="why1">${esc(whyLine(x.why))}</div>
        <input class="note" type="text" placeholder="備註／想法（例如：等週三再撿、要換掉誰）" value="${esc(pick.note ?? '')}" ${pick.on || pick.note ? '' : 'hidden'}>
      </div></li>`;
  }).join('') || '<li class="muted small">沒有符合的球員</li>';
}

function renderBudget() {
  const b = st.budget;
  const box = $('#pk-budget');
  if (!b) { box.hidden = true; return; }
  const pct = (n) => `${Math.min(100, (n / b.cap) * 100).toFixed(1)}%`;
  box.hidden = false;
  box.className = `card budget ${b.level}`;
  box.innerHTML = `
    <div class="b-head"><b>換人額度</b><span>今年已換 <b>${b.used}</b> / ${b.cap}${b.phase === 'over' ? '' : `｜季後賽保留 ${b.reserve}`}</span></div>
    <div class="b-bar" role="img" aria-label="已用 ${b.used} 次，上限 ${b.cap} 次">
      <i style="width:${pct(b.used)}"></i>${b.reserve ? `<s style="left:${pct(b.cap - b.reserve)}"></s>` : ''}
    </div>
    <div class="b-msg">${esc(budgetMessage(b))}</div>`;
}

function picksWarning() {
  const n = Object.values(st.picks).filter((v) => v.on).length;
  const b = st.budget;
  if (!b || b.phase === 'over' || !n || n <= b.thisWeek) return '';
  return `<div class="sumline warn-text">你勾了 ${n} 人，超過這週建議的 ${b.thisWeek} 次。${b.phase === 'regular' ? `多換的會吃到季後賽保留額度。` : ''}</div>`;
}

function renderPicked() {
  const on = Object.entries(st.picks).filter(([, v]) => v.on);
  const box = $('#pk-picked');
  box.hidden = !on.length;
  box.innerHTML = `<h3 class="first">已勾選要撿（${on.length}）</h3>` + picksWarning() +
    on.map(([, v]) => `<div class="sumline">✓ ${esc(v.name)}${v.note ? `<span class="muted">｜${esc(v.note)}</span>` : ''}</div>`).join('') +
    '<button type="button" class="btn" id="pk-clear">清除勾選</button>';
}

function setPick(li, on, fromSwipe = false) {
  const was = !!st.picks[li.dataset.id]?.on;
  savePick(li, { on });
  li.classList.toggle('checked', on);
  li.querySelector('input[type=checkbox]').checked = on;
  const note = li.querySelector('.note');
  if (note && !note.value) note.hidden = !on;
  renderPicked();
  const over = st.budget && st.budget.phase !== 'over' && on && Object.values(st.picks).filter((v) => v.on).length > st.budget.thisWeek;
  haptic(over ? 'warn' : 'mark');
  if (fromSwipe && was !== on) toast(`${li.dataset.name}：${on ? '要撿' : '取消'}`, { undo: () => setPick(li, was) });
}

function savePick(li, patch) {
  const id = li.dataset.id;
  const cur = st.picks[id] ?? { name: li.dataset.name };
  st.picks[id] = { ...cur, ...patch, name: li.dataset.name };
  if (!st.picks[id].on && !st.picks[id].note) delete st.picks[id];
  lsSet(LS.picks, st.picks);
}

export function initPickup() {
  $('#pk-chips').innerHTML = CHIPS.map(([label, kw]) => `<button type="button" class="chip" data-kw="${esc(kw)}">${esc(label)}</button>`).join('');
  const wants = $('#pk-wants');
  if (st.wants) $('#pk-wants-box').open = true;
  wants.value = st.wants;
  const syncChips = () => document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', st.wants.includes(c.dataset.kw)));
  syncChips();
  const setWants = (v) => { st.wants = v; lsSet(LS.wants, v); syncChips(); compute(); };
  wants.addEventListener('input', () => setWants(wants.value));
  $('#pk-chips').addEventListener('click', (e) => {
    const kw = e.target.closest('.chip')?.dataset.kw;
    if (!kw) return;
    const v = st.wants.includes(kw) ? st.wants.replace(kw, '').replace(/\s+/g, ' ').trim() : `${st.wants} ${kw}`.trim();
    wants.value = v;
    setWants(v);
  });

  $('#pk-mode').addEventListener('click', (e) => {
    const m = e.target.closest('button')?.dataset.mode;
    if (m) { st.mode = m; lsSet(LS.mode, m); renderList(); }
  });
  $('#pk-side').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.side;
    if (s) { st.side = s; lsSet(LS.side, s); renderList(); }
  });
  $('#pk-list').addEventListener('change', (e) => {
    const li = e.target.closest('.pk');
    if (!li) return;
    if (e.target.type === 'checkbox') setPick(li, e.target.checked);
  });
  $('#pk-list').addEventListener('input', (e) => {
    const li = e.target.closest('.pk');
    if (li && e.target.classList.contains('note')) { savePick(li, { note: e.target.value }); renderPicked(); }
  });
  $('#pk-picked').addEventListener('click', (e) => {
    if (e.target.id !== 'pk-clear') return;
    const saved = st.picks;
    st.picks = {};
    lsSet(LS.picks, st.picks);
    renderList();
    renderPicked();
    haptic('warn');
    toast('已清除勾選', { undo: () => { st.picks = saved; lsSet(LS.picks, st.picks); renderList(); renderPicked(); } });
  });
  // 點球員（不是勾選框、備註框）→ 詳情卡
  $('#pk-list').addEventListener('click', (e) => {
    const li = e.target.closest('.pk');
    if (!li || li.dataset.justSwiped || e.target.closest('input, button')) return;
    const x = st.result?.lists[st.mode]?.[st.side]?.find((y) => String(y.p.id) === li.dataset.id);
    if (!x) return;
    const p = x.p;
    const on = !!st.picks[p.id]?.on;
    haptic('tap');
    const box = sheet(`
      <div class="sh-head"><div><div class="sh-name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div><div class="muted small">${esc(p.team)}${x.yahoo?.status ? `・<span class="warn-text">${esc(x.yahoo.status)}</span>` : ''}</div></div><button type="button" class="sh-x" data-close aria-label="關閉">✕</button></div>
      <p class="why1 lead">${esc(whyLine(x.why))}</p>
      <h3>最近 14 天（換算成一週）</h3><div class="sumline">${esc(lineOf(p))}</div>
      <p class="muted small">${esc(MODE_DESC[st.mode])}</p>
      <div class="sh-acts"><button type="button" class="btn primary" data-pk="toggle">${on ? '取消要撿' : '我要撿他'}</button></div>`);
    box.addEventListener('click', (ev) => { if (ev.target.closest('[data-pk]')) { closeSheet(); setPick(li, !on, true); } });
  });
  // 往右滑＝勾選要撿、往左滑＝取消
  swipeRows($('#pk-list'), '.pk', { right: (li) => setPick(li, true, true), left: (li) => setPick(li, false, true) });

  $('#pk-login').addEventListener('click', () => {
    if (st.loaded) {
      Y.logout();
      st.loaded = false;
      st.result = null;
      $('#pk-who').textContent = '尚未登入';
      $('#pk-login').textContent = '登入 Yahoo';
      $('#pk-summary').hidden = true;
      renderList();
    } else {
      Y.login();
    }
  });
  $('#pk-refresh').addEventListener('click', () => loadAll({ keepWeek: true }));
  $('#pk-league').addEventListener('change', (e) => {
    st.league = st.leagues.find((l) => l.key === e.target.value);
    changeWeek(null);
  });
  $('#pk-week').addEventListener('change', (e) => changeWeek(e.target.value));

  // 登入完成後原生端會呼叫
  window.__onYahooLogin = () => loadAll();

  if (!Y.hasBridge()) {
    status('「球季中」要在 Android App 裡使用（App 內登入 Yahoo 後自動抓陣容）。', 'error');
    $('#pk-login').disabled = true;
    $('#pk-refresh').disabled = true;
    return { onShow() {} };
  }
  return {
    onShow() { if (!st.loaded && !st.busy) loadAll(); },
    refresh: () => loadAll({ keepWeek: true }),
  };
}

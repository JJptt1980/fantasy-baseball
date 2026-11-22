// 「即時」分頁：本週對戰即時追蹤；休賽季可重播 2026 任一週（逐日）
import * as Y from './yahoo-source.js';
import { seasonStats, toMaps } from './mlb.js';
import { CAT_LABEL } from './pickup.js';
import { track, resolveRoster, gameStatus, addDays } from './live.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const wd = (d) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

const st = { mode: 'live', weekly: null, week: 20, day: null, timer: null, playTimer: null, busy: false, maps: null, league: null, getBoard: null };

function status(msg, kind = '') {
  const el = $('#lv-status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

const fmtVal = (c, v) => {
  if (!Number.isFinite(v)) return '-';
  if (c === 'B:AVG' || c === 'B:OPS') return v.toFixed(3).replace(/^0/, '');
  if (c === 'P:ERA' || c === 'P:WHIP') return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
const verdictTxt = { win: '領先', loss: '落後', tie: '平手', na: '-' };
const probTxt = (p) => (p > 0.85 ? '穩贏' : p > 0.6 ? '小贏' : p >= 0.4 ? '拉鋸' : p >= 0.15 ? '小輸' : '穩輸');
const probCls = (p) => (p > 0.6 ? 'good' : p >= 0.4 ? 'warn' : 'bad');

// ── 陣容來源 ──
// App 內：Yahoo（指定日期的真實陣容）；瀏覽器預覽：用選秀表做示範陣容
async function rosters(date, weekNo) {
  if (Y.hasBridge()) {
    if (!st.league) {
      const ls = await Y.leagues();
      const latest = Math.max(...ls.map((l) => l.season));
      st.league = ls.find((l) => l.season === latest);
    }
    const mu = await Y.matchup(st.league, weekNo);
    const [meT, oppT] = mu.matchup?.teams ?? [];
    if (!oppT) return { me: null, opp: null, oppName: null, week: { start: mu.weekStart, end: mu.weekEnd }, weekNo: mu.week };
    const [me, opp] = await Promise.all([Y.roster(st.league, st.league.teamId ?? meT.key, date), Y.roster(st.league, oppT.key, date)]);
    return { me, opp, oppName: oppT.name, week: { start: mu.weekStart, end: mu.weekEnd }, weekNo: mu.week };
  }
  const board = st.getBoard?.() ?? [];
  if (!board.length) throw new Error('選秀表還沒載入完成');
  const snake = (slot) => board.filter((_, i) => { const r = Math.floor(i / 12); const k = i % 12; return (r % 2 ? 11 - k : k) === slot; }).slice(0, 25);
  const toR = (list) => list.map((p, i) => ({ name: p.name, side: p.side, slot: i < 23 ? (p.side === 'B' ? 'Util' : 'P') : 'BN' }));
  return { me: toR(snake(0)), opp: toR(snake(1)), oppName: '示範對手（電腦預覽，非 Yahoo 資料）', week: null, weekNo };
}

// ── 計算＋畫面 ──
async function refresh() {
  if (st.busy) return;
  st.busy = true;
  try {
    let now;
    let week;
    let weekNo;
    let past;
    if (st.mode === 'replay') {
      const w = st.weekly.weeks[st.week - 1];
      week = { start: w.start, end: w.end };
      now = st.day ?? w.start;
      weekNo = st.week;
      past = true;
    } else {
      now = new Date().toISOString().slice(0, 10);
      past = false;
    }
    status('讀取陣容…');
    const r = await rosters(st.mode === 'replay' ? now : null, weekNo);
    week ??= r.week;
    if (!r.opp) { status('這週沒有對手（輪空或季後賽已結束）。休賽季請切到「重播 2026」。', 'warn'); return clear(); }
    if (!week?.start || now > week.end || now < week.start) {
      status('現在不在比賽週內（休賽季）。請切到「重播 2026」看看實際運作。', 'warn');
      return clear();
    }
    const year = Number(now.slice(0, 4));
    status('讀取 MLB 即時數據…');
    st.maps ??= {};
    st.maps[year] ??= toMaps(await seasonStats(year));
    const res = await track({ now, week, me: resolveRoster(r.me, st.maps[year]), opp: resolveRoster(r.opp, st.maps[year]), past });
    status('');
    render(res, { now, week, oppName: r.oppName, weekNo: r.weekNo });
    scheduleAuto(res);
  } catch (e) {
    console.error(e);
    status(e instanceof Y.LoginNeeded ? '請先到「撿人」頁登入 Yahoo。' : (e.message || '讀取失敗'), 'error');
  } finally {
    st.busy = false;
  }
}

function clear() {
  for (const id of ['#lv-head', '#lv-cats', '#lv-players']) $(id).hidden = true;
}

function render(res, ctx) {
  const n = res.nowTally;
  const p = res.projTally;
  const cls = (w, l) => (w > l ? 'win' : w < l ? 'loss' : 'tie');
  const t = new Date();
  $('#lv-head').hidden = false;
  $('#lv-head').innerHTML = `
    <div class="sumline">第 ${ctx.weekNo ?? '-'} 週｜對手 <b>${esc(ctx.oppName)}</b></div>
    <div class="sumline muted small">${esc(ctx.now)}（週${wd(ctx.now)}）｜本週 ${esc(ctx.week.start.slice(5))}～${esc(ctx.week.end.slice(5))}｜還剩 ${res.daysLeft} 天
      ${st.mode === 'live' ? `｜更新 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}${res.live ? '（比賽進行中，每 60 秒自動更新）' : ''}` : '｜重播'}</div>
    <div class="score">
      <div><div class="n ${cls(n.win ?? 0, n.loss ?? 0)}">${n.win ?? 0}-${n.loss ?? 0}-${n.tie ?? 0}</div><div class="l">目前</div></div>
      <div><div class="n ${cls(p.win, p.loss)}">${p.win}-${p.loss}-${p.tie}</div><div class="l">預估週末</div></div>
    </div>`;

  $('#lv-cats').hidden = false;
  $('#lv-cats').innerHTML = `<table class="tbl lv"><thead><tr><th>類別</th><th class="v">我</th><th class="v">對手</th><th class="c">目前</th><th class="v">預估</th><th>週末</th></tr></thead><tbody>
    ${res.cats.map((c) => `<tr>
      <td>${esc(CAT_LABEL[c.cat])}</td>
      <td class="v">${fmtVal(c.cat, c.me)}</td><td class="v">${fmtVal(c.cat, c.opp)}</td>
      <td class="c"><span class="pill ${c.now}">${verdictTxt[c.now]}</span></td>
      <td class="v small">${fmtVal(c.cat, c.meProj)}／${fmtVal(c.cat, c.oppProj)}</td>
      <td><span class="tag ${probCls(c.prob)}">${probTxt(c.prob)} ${Math.round(c.prob * 100)}%</span></td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">「目前」＝本週至今（含今天已打完的部分）；「預估」＝再加上剩餘比賽 × 最近 14 天表現。只算先發格子的球員。</p>`;

  const row = (p) => {
    const g = p.today.game;
    const s = gameStatus(g, ctx.now);
    const live = g?.status?.abstractGameState === 'Live';
    return `<div class="pl ${p.active ? '' : 'bench'} ${live ? 'live' : ''}">
      <div><b>${esc(p.name)}</b> <span class="pos">${esc(p.slot)}</span>${p.status ? ` <span class="tag warn">${esc(p.status)}</span>` : ''}${p.id ? '' : ' <span class="tag bad">對不到數據</span>'}</div>
      <div class="st">${esc(s)}</div>
      <div class="sm">${p.today.summary ? esc(p.today.summary) : g ? (g.status?.abstractGameState === 'Preview' ? '尚未開打' : '沒有上場') : ''}</div></div>`;
  };
  const sortP = (list) => [...list].sort((a, b) => Number(b.active) - Number(a.active));
  $('#lv-players').hidden = false;
  $('#lv-players').innerHTML = `<h3 class="first">今天｜我方</h3>${sortP(res.me).map(row).join('')}
    <h3>今天｜對手</h3>${sortP(res.opp).map(row).join('')}`;
}

function scheduleAuto(res) {
  clearTimeout(st.timer);
  if (st.mode !== 'live' || !res.live) return;
  st.timer = setTimeout(() => { if (!$('#tab-live').hidden && document.visibilityState === 'visible') refresh(); else scheduleAuto(res); }, 60000);
}

// ── 重播控制 ──
function renderDays() {
  const w = st.weekly.weeks[st.week - 1];
  const days = [];
  for (let d = w.start; d <= w.end; d = addDays(d, 1)) days.push(d);
  st.day = days.includes(st.day) ? st.day : days[0];
  $('#lv-days').innerHTML = days.map((d) => `<button type="button" class="chip ${d === st.day ? 'on' : ''}" data-day="${d}">${d.slice(5)} ${wd(d)}</button>`).join('');
}

function stopPlay() {
  clearTimeout(st.playTimer);
  st.playTimer = null;
  $('#lv-play').textContent = '▶ 播放這一週';
}

async function playWeek() {
  if (st.playTimer) return stopPlay();
  const w = st.weekly.weeks[st.week - 1];
  st.day = w.start;
  $('#lv-play').textContent = '⏸ 停止';
  const step = async () => {
    renderDays();
    await refresh();
    if (st.day >= w.end) return stopPlay();
    st.day = addDays(st.day, 1);
    st.playTimer = setTimeout(step, Number($('#lv-speed').value));
  };
  st.playTimer = setTimeout(step, 0);
}

function setMode(m) {
  st.mode = m;
  stopPlay();
  clearTimeout(st.timer);
  document.querySelectorAll('#lv-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#lv-replay').hidden = m !== 'replay';
  if (m === 'replay') renderDays();
  refresh();
}

export function initLive({ getBoard, weeklyUrl }) {
  st.getBoard = getBoard;
  let loaded = false;
  const ensure = async () => {
    if (loaded) return;
    loaded = true;
    try {
      st.weekly = await (await fetch(weeklyUrl)).json();
      $('#lv-week').innerHTML = st.weekly.weeks.map((w, i) => `<option value="${i + 1}">第 ${i + 1} 週（${w.start.slice(5)}～${w.end.slice(5)}）</option>`).join('');
      $('#lv-week').value = String(st.week);
    } catch { $('#lv-mode [data-mode=replay]').disabled = true; }
    // 休賽季直接進重播
    const m = new Date().getMonth();
    setMode(m >= 10 || m <= 1 ? 'replay' : 'live');
  };
  $('#lv-mode').addEventListener('click', (e) => { const m = e.target.closest('button')?.dataset.mode; if (m) setMode(m); });
  $('#lv-week').addEventListener('change', (e) => { st.week = Number(e.target.value); st.day = null; stopPlay(); renderDays(); refresh(); });
  $('#lv-days').addEventListener('click', (e) => { const d = e.target.closest('.chip')?.dataset.day; if (d) { stopPlay(); st.day = d; renderDays(); refresh(); } });
  $('#lv-play').addEventListener('click', playWeek);
  return { onShow: ensure };
}

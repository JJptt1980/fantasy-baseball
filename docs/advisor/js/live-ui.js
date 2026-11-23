// 「即時」分頁：本週對戰即時追蹤；休賽季可重播 2026 任一週（逐日）
import * as Y from './yahoo-source.js';
import { seasonStats, toMaps } from './mlb.js';
import { CAT_LABEL } from './pickup.js';
import { track, resolveRoster, gameStatus } from './live.js';
import { haptic } from './ui-kit.js';
const LOWER = new Set(['B:K', 'P:L', 'P:BB', 'P:ERA', 'P:WHIP']);
// 我方占比（0~1）：越小越好的類別反過來算；都沒有數字就算 0.5
function share(cat, me, opp) {
  if (!Number.isFinite(me) || !Number.isFinite(opp) || me + opp <= 0) return 0.5;
  return LOWER.has(cat) ? opp / (me + opp) : me / (me + opp);
}

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const wd = (d) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

const st = { timer: null, busy: false, maps: null, league: null, getBoard: null };

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
const rosterCache = new Map();
async function rosters(weekNo, year, today) {
  st.maps ??= {};
  st.maps[year] ??= toMaps(await seasonStats(year));
  const maps = st.maps[year];
  if (Y.hasBridge()) {
    if (!st.league) {
      const ls = await Y.leagues();
      const latest = Math.max(...ls.map((l) => l.season));
      st.league = ls.find((l) => l.season === latest);
    }
    const mu = await Y.matchup(st.league, weekNo);
    const [meT, oppT] = mu.matchup?.teams ?? [];
    const week = { start: mu.weekStart, end: mu.weekEnd };
    if (!oppT) return { oppName: null, week, weekNo: mu.week };
    const myId = st.league.teamId ?? meT.key;
    // 過去的日期陣容不會再變 → 快取；今天的每次重抓
    const get = async (teamId, date) => {
      const key = `${teamId}@${date}`;
      if (date < today && rosterCache.has(key)) return rosterCache.get(key);
      const r = resolveRoster(await Y.roster(st.league, teamId, date), maps);
      rosterCache.set(key, r);
      return r;
    };
    const rosterAt = async (date) => {
      const [me, opp] = await Promise.all([get(myId, date), get(oppT.key, date)]);
      return { me, opp };
    };
    return { rosterAt, oppName: oppT.name, week, weekNo: mu.week };
  }
  const board = st.getBoard?.() ?? [];
  if (!board.length) throw new Error('選秀表還沒載入完成');
  const snake = (slot) => board.filter((_, i) => { const r = Math.floor(i / 12); const k = i % 12; return (r % 2 ? 11 - k : k) === slot; }).slice(0, 25);
  const toR = (list) => resolveRoster(list.map((p, i) => ({ name: p.name, side: p.side, slot: i < 23 ? (p.side === 'B' ? 'Util' : 'P') : 'BN' })), maps);
  const me = toR(snake(0));
  const opp = toR(snake(1));
  return { rosterAt: async () => ({ me, opp }), oppName: '示範對手（電腦預覽，非 Yahoo 資料）', week: null, weekNo };
}

// ── 計算＋畫面 ──
async function refresh() {
  if (st.busy) return;
  st.busy = true;
  try {
    const now = new Date().toISOString().slice(0, 10);
    const past = false;
    status('讀取陣容…');
    const r = await rosters(undefined, Number(now.slice(0, 4)), now);
    const week = r.week;
    if (!r.rosterAt) { status('這週沒有對手（輪空，或季後賽已經結束）。', 'warn'); return clear(); }
    if (!week?.start || now > week.end || now < week.start) {
      status(document.getElementById('lv-off')?.hidden === false ? '' : '這週沒有比賽。', 'warn');
      return clear();
    }
    status('讀取逐日陣容與 MLB 數據…');
    const res = await track({ now, week, rosterAt: r.rosterAt, past });
    status('');
    render(res, { now, week, oppName: r.oppName, weekNo: r.weekNo });
    scheduleAuto(res);
  } catch (e) {
    console.error(e);
    haptic('error');
    status(e instanceof Y.LoginNeeded ? '請先到「球季中」頁登入 Yahoo。' : (e.message || '讀取失敗'), 'error');
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
      ${`｜更新 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}${res.live ? '（比賽進行中，每 60 秒自動更新）' : ''}`}</div>
    <div class="score">
      <div><div class="n ${cls(n.win ?? 0, n.loss ?? 0)}">${n.win ?? 0}-${n.loss ?? 0}-${n.tie ?? 0}</div><div class="l">目前</div></div>
      <div><div class="n ${cls(p.win, p.loss)}">${p.win}-${p.loss}-${p.tie}</div><div class="l">預估週末</div></div>
    </div>`;

  $('#lv-cats').hidden = false;
  // 18 類別：每類一條「我 vs 對手」迷你長條（紫色＝我的占比），右邊是週末勝率
  $('#lv-cats').innerHTML = `<div class="lvc-head"><span>左：我</span><span>綠＝我贏、紅＝我輸</span><span>右：對手</span></div>
    ${res.cats.map((c) => {
      const sh = share(c.cat, c.me, c.opp);
      return `<div class="lvc ${c.now}">
      <span class="lvc-l">${esc(CAT_LABEL[c.cat])}</span>
      <span class="lvc-v me">${fmtVal(c.cat, c.me)}</span>
      <span class="lvc-bar" role="img" aria-label="${verdictTxt[c.now]}"><i style="width:${Math.round(sh * 100)}%"></i></span>
      <span class="lvc-v op">${fmtVal(c.cat, c.opp)}</span>
      <span class="tag ${probCls(c.prob)}">週末${probTxt(c.prob)} ${Math.round(c.prob * 100)}%</span>
      <span class="lvc-p">預估 ${fmtVal(c.cat, c.meProj)}／${fmtVal(c.cat, c.oppProj)}</span></div>`;
    }).join('')}
    <p class="muted small">長條是「到今天為止」：綠＝我贏、紅＝我輸、橘＝平手（ERA、WHIP 這種越低越好的已經幫你反過來算）。「預估」是把剩下的比賽也算進去，猜週末的結果。</p>`;

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
  if (!res.live) return;
  st.timer = setTimeout(() => { if (!$('#tab-live').hidden && document.visibilityState === 'visible') refresh(); else scheduleAuto(res); }, 60000);
}

function start() {
  clearTimeout(st.timer);
  refresh();
}

export function initLive({ getBoard }) {
  st.getBoard = getBoard;
  let loaded = false;
  const ensure = () => { if (loaded) return; loaded = true; start(); };
  return { onShow: ensure, refresh: () => refresh() };
}

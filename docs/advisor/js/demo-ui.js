// Demo 分頁：按一下虛擬跑完整個 2027，自動播放
import { runSeason, buildProfiles, TEAMS, ROUNDS } from './demo-sim.js';
import { CAT_LABEL } from './pickup.js';
import * as Y from './yahoo-source.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_PROFILES = 'demo.profiles';
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 略 */ } }

const st = { timer: null, paused: false, events: [], i: 0, names: [], mySlot: 0, profiles: lsGet(LS_PROFILES, null) };

function status(msg, kind = '') {
  const el = $('#demo-status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

const resCls = (w, l) => (w > l ? 'win' : w < l ? 'loss' : 'tie');
const resTxt = (w, l) => (w > l ? '勝' : w < l ? '負' : '和');
const nm = (i) => esc(st.names[i]);

function renderProfiles() {
  const p = st.profiles;
  if (!p?.list?.length) return;
  $('#demo-opp-desc').textContent = `用聯盟 ${p.list.length} 個對手的真實選秀習慣（${p.source}）。`;
  $('#demo-opp-list').innerHTML = p.list.map((x) => `<div class="opp-prof"><b>${esc(x.name)}</b>：${esc(x.summary)}</div>`).join('');
}

async function loadProfiles(getBoard) {
  const board = getBoard();
  if (!board?.length) return status('選秀表還沒載入完成，請稍等再按。', 'error');
  try {
    status('讀取聯盟選秀紀錄…');
    const leagues = await Y.leagues();
    const latest = Math.max(...leagues.map((l) => l.season));
    const lg = leagues.find((l) => l.season === latest);
    const picks = await Y.draftResults(lg);
    const list = buildProfiles(picks, board, lg.teamName);
    if (!list.length) throw new Error('讀不到選秀紀錄');
    st.profiles = { list: list.map(({ name, pref, reach, age, firstRP, favTeam, summary }) => ({ name, pref, reach, age, firstRP, favTeam, summary })), source: `${lg.season} 選秀` };
    lsSet(LS_PROFILES, st.profiles);
    status('');
    renderProfiles();
  } catch (e) {
    console.error(e);
    status(e instanceof Y.LoginNeeded ? '請先到「撿人」頁登入 Yahoo，再回來按。' : e.message, 'error');
  }
}

// ── 播放 ──

function renderDraft(ev) {
  const mine = ev.log.filter((x) => x.team === ev.mySlot);
  const byTeam = Array.from({ length: TEAMS }, (_, t) => ev.log.filter((x) => x.team === t).slice(0, 3));
  $('#demo-draft').hidden = false;
  $('#demo-draft-body').innerHTML = `
    <h3>你（第 ${ev.mySlot + 1} 順位）選到的 ${ROUNDS} 人</h3>
    ${mine.map((x) => `<div class="wk">第 ${x.round} 輪｜<b>${esc(x.player.name)}</b> <span class="pos">${esc(x.player.pos)}</span> <span class="muted small">選秀表第 ${x.player.rank}</span></div>`).join('')}
    <h3>各隊前 3 輪</h3>
    ${byTeam.map((list, t) => (t === ev.mySlot ? '' : `<div class="wk"><b>${nm(t)}</b>：${list.map((x) => esc(x.player.name)).join('、')}</div>`)).join('')}`;
}

function renderStandings(rows, final = false) {
  $('#demo-standings').hidden = false;
  $('#demo-standings').innerHTML = `<h3 class="first">${final ? '例行賽最終排名' : '目前排名'}（前 6 名進季後賽）</h3>
    <table class="tbl"><thead><tr><th>#</th><th>隊伍</th><th>類別勝-敗-和</th><th>對戰</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.team === st.mySlot ? 'me' : ''} ${i === 5 ? 'cut' : ''}"><td>${i + 1}</td><td>${nm(r.team)}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.mw}-${r.ml}</td></tr>`).join('')}
    </tbody></table>`;
}

function weekLine(ev) {
  const g = ev.myGame;
  const meA = g.a === st.mySlot;
  const w = meA ? g.w : g.l;
  const l = meA ? g.l : g.w;
  const opp = meA ? g.b : g.a;
  const mv = ev.pickup.move;
  return `<div class="wk">第 ${ev.week} 週 vs ${nm(opp)}：<span class="res ${resCls(w, l)}">${w}-${l}-${g.t} ${resTxt(w, l)}</span>
    ${mv ? `<div class="pickrow">撿 <b>${esc(mv.add.name)}</b>（${esc(mv.add.pos)}）丟 ${esc(mv.drop.name)}｜預估每週多贏 ${mv.gain.toFixed(2)} 類</div>` : ''}</div>`;
}

function renderNow(ev) {
  const g = ev.myGame;
  const meA = g.a === st.mySlot;
  const w = meA ? g.w : g.l;
  const l = meA ? g.l : g.w;
  const opp = meA ? g.b : g.a;
  const cats = Object.entries(g.cats).map(([c, r]) => {
    const mine = meA ? r : r === 'win' ? 'loss' : r === 'loss' ? 'win' : 'tie';
    return `<span class="tag ${mine === 'win' ? 'good' : mine === 'loss' ? 'bad' : 'warn'}">${esc(CAT_LABEL[c])}</span>`;
  }).join('');
  const pk = ev.pickup;
  const good = pk.top.filter((o) => o.gain > 0.005);
  $('#demo-now').hidden = false;
  $('#demo-now').innerHTML = `<h3 class="first">第 ${ev.week} 週</h3>
    <div class="sumline">對手 <b>${nm(opp)}</b>：<span class="res ${resCls(w, l)}" style="font-weight:800">${w}-${l}-${g.t}（${resTxt(w, l)}）</span></div>
    <div class="sumline">${cats}</div>
    <div class="sumline">這週弱項：${pk.weak.map((x) => `<span class="tag bad">${esc(x)}</span>`).join('')}</div>
    <div class="sumline">撿人建議：${good.length ? good.map((o) => `${esc(o.add.name)}（換 ${esc(o.drop.name)}，每週多贏 ${o.gain.toFixed(2)} 類）`).join('、') : '自由球員裡沒有能讓你變強的人'}</div>
    <div class="sumline muted small">${pk.move ? `已照建議撿 ${esc(pk.move.add.name)}` : '這週不換人（沒有明顯提升）'}</div>`;
}

function step() {
  const ev = st.events[st.i++];
  if (!ev) return stop();
  if (ev.type === 'draft') {
    renderDraft(ev);
    $('#demo-log').hidden = false;
    $('#demo-log').innerHTML = '<h3 class="first">每週戰報</h3>';
  } else if (ev.type === 'week') {
    renderNow(ev);
    renderStandings(ev.standings);
    $('#demo-log').insertAdjacentHTML('beforeend', weekLine(ev));
  } else if (ev.type === 'playoff') {
    const mine = ev.a === st.mySlot || ev.b === st.mySlot;
    $('#demo-log').insertAdjacentHTML('beforeend', `<div class="wk">第 ${ev.week} 週・${esc(ev.label)}：${nm(ev.a)} ${ev.w}-${ev.l}-${ev.t} ${nm(ev.b)} → <b>${nm(ev.winner)}</b> 晉級${mine ? (ev.winner === st.mySlot ? ' 🎉' : ' 😢') : ''}</div>`);
  } else if (ev.type === 'end') {
    renderStandings(ev.standings, true);
    const won = ev.champ === st.mySlot;
    const box = $('#demo-final');
    box.hidden = false;
    box.className = `card final ${won ? 'champ' : ''}`;
    box.innerHTML = won
      ? `<div class="big">🏆 你拿下 2027 冠軍！</div><div class="muted">例行賽第 ${ev.myRank} 名｜整季換人 ${ev.moves} 次</div>`
      : `<div class="big">冠軍：${nm(ev.champ)}</div><div class="muted">你例行賽第 ${ev.myRank} 名${ev.myRank <= 6 ? '，進了季後賽' : '，沒進季後賽'}｜整季換人 ${ev.moves} 次</div>`;
    box.insertAdjacentHTML('beforeend', '<button type="button" class="btn primary" id="demo-again" style="margin-top:10px">🔁 再跑一次</button>');
    return stop();
  }
  return true;
}

function play() {
  clearTimeout(st.timer);
  if (st.paused) return;
  if (step() === true) st.timer = setTimeout(play, Number($('#demo-speed').value));
}

function stop() {
  clearTimeout(st.timer);
  $('#demo-run').hidden = false;
  $('#demo-pause').hidden = true;
  $('#demo-skip').hidden = true;
  return false;
}

function start(getBoard) {
  const board = getBoard();
  if (!board?.length) return status('選秀表還沒載入完成，請稍等。', 'error');
  status('');
  const slotSel = $('#demo-slot').value;
  st.mySlot = slotSel === '' ? Math.floor(Math.random() * TEAMS) : Number(slotSel);
  const { events, names } = runSeason(board, { mySlot: st.mySlot, profiles: st.profiles?.list ?? null, seed: Date.now() & 0x7fffffff });
  st.events = events;
  st.names = names;
  st.i = 0;
  st.paused = false;
  for (const id of ['#demo-final', '#demo-now', '#demo-standings', '#demo-draft', '#demo-log']) $(id).hidden = true;
  $('#demo-run').hidden = true;
  $('#demo-pause').hidden = false;
  $('#demo-pause').textContent = '⏸ 暫停';
  $('#demo-skip').hidden = false;
  play();
}

export function initDemo({ getBoard }) {
  $('#demo-slot').insertAdjacentHTML('beforeend', Array.from({ length: TEAMS }, (_, i) => `<option value="${i}">第 ${i + 1} 順位</option>`).join(''));
  renderProfiles();
  $('#demo-run').addEventListener('click', () => start(getBoard));
  $('#demo-pause').addEventListener('click', () => {
    st.paused = !st.paused;
    $('#demo-pause').textContent = st.paused ? '▶ 繼續' : '⏸ 暫停';
    if (!st.paused) play();
  });
  $('#demo-skip').addEventListener('click', () => {
    clearTimeout(st.timer);
    while (step() === true) { /* 一路跑到結束 */ }
  });
  $('#demo-final').addEventListener('click', (e) => { if (e.target.id === 'demo-again') start(getBoard); });
  $('#demo-opp-load').addEventListener('click', () => loadProfiles(getBoard));
  if (!Y.hasBridge()) $('#demo-opp-load').disabled = true;
}

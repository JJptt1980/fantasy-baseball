// Demo「手動玩」畫面：選秀 → 每週（對手預估、撿人、排先發、開打）→ 季後賽 → 結算
import { createGame, restoreGame } from './demo-manual.js';
import { TEAMS, ROUNDS, assign } from './demo-sim.js';
import { seasonStats, toMaps } from './mlb.js';
import { buildPlayers, board as rankBoard, blendMaps } from './rank.js';
import { buildConfig } from './strategies.js';
import { CAT_LABEL } from './pickup.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_SAVE = 'demo.manual.save';
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* 略 */ } }

const st = { g: null, prep: null, getSelection: null, getSeason: null, getProfiles: null, q: '', pos: '', faQ: '', faSide: '', lastSeen: 0, compare: null };

function status(msg, kind = '') {
  const el = $('#mn-status');
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || '';
}

async function prepare() {
  const season = st.getSeason();
  if (st.prep?.season === season) return st.prep;
  status(`準備資料：${season - 1} 年成績（選秀用）＋ ${season} 年逐週成績（重播用）…`);
  const [prev, prev2] = await Promise.all([seasonStats(season - 1), seasonStats(season - 2)]);
  // 選秀用兩年資料加權（避免前一年受傷的球星沒人選）
  const base = buildPlayers(blendMaps(toMaps(prev), toMaps(prev2)), toMaps(prev2));
  let weekly = null;
  try { const r = await fetch(`data/weekly-${season}.json`); if (r.ok) weekly = await r.json(); } catch { /* 略 */ }
  st.prep = { season, base, weekly };
  status('');
  return st.prep;
}

const boardFor = (sel) => rankBoard(st.prep.base, buildConfig(new Set(sel.selected), new Set(sel.prefs)));

function save() {
  if (!st.g) return;
  lsSet(LS_SAVE, { ...st.g.serialize(), sel: st.sel, season: st.prep.season });
  updateContinue();
}

function updateContinue() {
  const s = lsGet(LS_SAVE, null);
  const btn = $('#mn-continue');
  if (!s || st.g) { btn.hidden = true; return; }
  const plays = s.actions.filter((a) => a[0] === 'play').length;
  const picks = s.actions.filter((a) => a[0] === 'pick').length;
  btn.hidden = false;
  btn.textContent = plays >= 26 ? '📋 看上一季的結算' : plays ? `⏯ 繼續上次（打到第 ${plays + 1} 週）` : picks >= 25 || s.actions.some((a) => a[0] !== 'pick') ? '⏯ 繼續上次（選秀完成，從第 1 週開始）' : `⏯ 繼續上次（選秀中，已選 ${picks} 人）`;
}

async function newGame() {
  try {
    await prepare();
    st.sel = st.getSelection();
    const slotSel = $('#mn-slot').value;
    const mySlot = slotSel === '' ? Math.floor(Math.random() * TEAMS) : Number(slotSel);
    st.g = createGame(boardFor(st.sel), { mySlot, profiles: st.getProfiles(), seed: Date.now() & 0x7fffffff, weekly: st.prep.weekly });
    st.lastSeen = 0;
    st.compare = null;
    save();
    render();
  } catch (e) { console.error(e); status(e.message || '開始失敗', 'error'); }
}

async function continueGame() {
  try {
    status('讀取存檔中…（重播你的每一步，大約幾秒）');
    $('#mn-continue').disabled = true;
    await new Promise((r) => setTimeout(r, 30));
    await prepare();
    const s = lsGet(LS_SAVE, null);
    st.sel = s.sel;
    status('讀取存檔…');
    await new Promise((r) => setTimeout(r, 30));
    st.g = restoreGame(boardFor(s.sel), s, { profiles: st.getProfiles(), weekly: st.prep.weekly });
    $('#mn-continue').disabled = false;
    st.lastSeen = st.g.draftLog.length;
    status('');
    render();
  } catch (e) { console.error(e); status(`讀檔失敗：${e.message}`, 'error'); }
}

function act(fn) {
  try { fn(); save(); render(); } catch (e) { console.error(e); status(e.message, 'error'); }
}

// ── 共用小元件 ──
const era = (l) => (l.IP ? ((l.ER * 9) / l.IP).toFixed(2) : '-');
const whip = (l) => (l.IP ? (l.WH / l.IP).toFixed(2) : '-');
const isSP = (p) => p.pos === 'SP';
// 兩年加權的數字會有小數 → 四捨五入
const n0 = (v) => Math.round(v ?? 0);
const pLine = (p) => (p.side === 'B'
  ? `R ${n0(p.R)}｜HR ${n0(p.HR)}｜RBI ${n0(p.RBI)}｜SB ${n0(p.SB)}｜AVG ${(p.AVG || 0).toFixed(3).replace(/^0/, '')}｜OPS ${(p.OPS || 0).toFixed(3).replace(/^0/, '')}`
  : isSP(p) ? `${n0(p.IP)} 局｜W ${n0(p.W)}｜K ${n0(p.K)}｜ERA ${era(p)}｜WHIP ${whip(p)}`
    : `${n0(p.IP)} 局｜SV ${n0(p.SV)}｜HLD ${n0(p.HLD)}｜K ${n0(p.K)}｜ERA ${era(p)}`);
const recentLine = (l, p) => (l.side === 'B'
  ? `每週 R ${l.R.toFixed(1)} HR ${l.HR.toFixed(1)} RBI ${l.RBI.toFixed(1)} SB ${l.SB.toFixed(1)} AVG ${(l.AVG || 0).toFixed(3).replace(/^0/, '')}`
  : p && isSP(p) ? `每週 ${l.IP.toFixed(1)} 局 K ${l.K.toFixed(1)} W ${l.W.toFixed(1)} ERA ${era(l)} WHIP ${whip(l)}`
    : `每週 ${l.IP.toFixed(1)} 局 SV ${l.SV.toFixed(1)} HLD ${l.HLD.toFixed(1)} K ${l.K.toFixed(1)} ERA ${era(l)}`);
// 近況：🔥熱／普通／🧊冷；連兩週沒上場 = 🩹傷
const formTag = (pv, p) => {
  if (pv.injuredIds.has(p.id)) return '<span class="tag bad">🩹 傷</span>';
  const f = pv.form(p);
  return f > 8 ? '<span class="tag good">🔥 熱</span>' : f < -3 ? '<span class="tag warn">🧊 冷</span>' : '<span class="tag">普通</span>';
};
const probCls = (p) => (p > 0.6 ? 'good' : p >= 0.4 ? 'warn' : 'bad');
const resCls = (w, l) => (w > l ? 'win' : w < l ? 'loss' : 'tie');
const resTxt = (w, l) => (w > l ? '勝' : w < l ? '負' : '和');

function myScore(game) {
  const meA = game.a === st.g.mySlot;
  return { w: meA ? game.w : game.l, l: meA ? game.l : game.w, t: game.t, opp: meA ? game.b : game.a, cats: Object.entries(game.cats).map(([c, r]) => [c, meA ? r : r === 'win' ? 'loss' : r === 'loss' ? 'win' : 'tie']) };
}

function rosterSummary(team) {
  const miss = [];
  const filled = { B: 0, P: 0 };
  for (const side of ['B', 'P']) {
    const a = assign(team, side);
    a.slots.forEach((sl, i) => { if (a.filled[i]) filled[side]++; else miss.push(sl); });
  }
  const cnt = miss.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const list = Object.entries(cnt).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('、');
  return `<div class="sumline">先發打者 ${filled.B}/12、投手 ${filled.P}/11｜${miss.length ? `還缺：<b>${esc(list)}</b>` : '先發格子都有人了，接下來補板凳'}</div>`;
}

// ── 選秀畫面 ──
function renderDraft() {
  const g = st.g;
  const tu = g.turn();
  const opt = g.draftOptions();
  const since = g.draftLog.slice(st.lastSeen).filter((x) => x.team !== g.mySlot);
  const stolen = since.filter((x) => st.lastRec?.includes(x.player.id));
  st.lastRec = opt.recommended.map((p) => p.id);
  const mine = g.teams[g.mySlot];
  const all = opt.all.filter((p) => (!st.q || p.name.toLowerCase().includes(st.q.toLowerCase())) && (!st.pos || st.pos === p.side || st.pos === p.pos)).slice(0, 60);
  const row = (p, primary = false) => `<div class="mn-row"><div><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span> <span class="muted small">選秀表第 ${p.rank}｜市 ${p.marketRank}</span>
      <div class="sub">${esc(pLine(p))}</div>${p.notes?.length ? `<div class="note">${esc(p.notes.join('、'))}</div>` : ''}</div>
      <button type="button" class="btn ${primary ? 'primary' : ''}" data-pick="${p.id}">選他</button></div>`;
  $('#mn-body').innerHTML = `
    <div class="card"><h3 class="first">選秀｜第 ${tu.round} 輪・總第 ${tu.overall} 位，輪到你（第 ${g.mySlot + 1} 順位）</h3>
      ${stolen.length ? `<div class="sumline">😣 你想要但被搶走：${stolen.map((x) => `<b>${esc(x.player.name)}</b>（${esc(g.names[x.team])}）`).join('、')}</div>` : ''}
      ${since.length ? `<details class="sub muted small"><summary>其他隊這段時間選了 ${since.length} 人</summary>${since.map((x) => `${esc(g.names[x.team])} 選 ${esc(x.player.name)}`).join('、')}</details>` : ''}
      <h3>你的陣容（${mine.length}/${ROUNDS}）</h3>${rosterSummary(mine)}
      ${mine.length ? `<div class="sub muted small" style="margin-top:6px">${mine.map((p) => esc(p.name)).join('、')}</div>` : ''}
    </div>
    <div class="card"><h3 class="first">App 推薦</h3>${opt.recommended.map((p, i) => row(p, i === 0)).join('')}
      <div class="mn-actions"><button type="button" class="btn primary" data-act="draft-auto1">照建議選第 1 推薦</button><button type="button" class="btn" data-act="draft-rest">剩下全照建議選完</button></div>
    </div>
    <div class="card"><h3 class="first">全部可選球員</h3>
      <div class="toolbar"><input id="mn-q" type="search" placeholder="搜尋球員" value="${esc(st.q)}">
        <select id="mn-pos">${['', 'B', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'].map((v) => `<option value="${v}" ${st.pos === v ? 'selected' : ''}>${v === '' ? '全部' : v === 'B' ? '打者' : v === 'P' ? '投手' : v}</option>`).join('')}</select></div>
      ${all.map((p) => row(p)).join('') || '<p class="muted">沒有符合的球員</p>'}
    </div>`;
}

// ── 每週畫面 ──
function renderWeek() {
  const g = st.g;
  const pv = g.preview();
  const last = g.events.at(-1);
  let lastHtml = '';
  if (last?.type === 'week') {
    const s = myScore(last.myGame);
    lastHtml = `<div class="card"><h3 class="first">第 ${last.week} 週結果 vs ${esc(g.names[s.opp])}：<span class="res ${resCls(s.w, s.l)}" style="font-weight:800">${s.w}-${s.l}-${s.t} ${resTxt(s.w, s.l)}</span></h3>
      <div class="mn-cats">${s.cats.map(([c, r]) => `<span class="tag ${r === 'win' ? 'good' : r === 'loss' ? 'bad' : 'warn'}">${esc(CAT_LABEL[c])}</span>`).join('')}</div>
      ${last.pred ? `<div class="muted small">賽前預估 ${last.pred.predWin} 類領先、${last.pred.predLoss} 類落後｜這週猜中 ${last.pred.hit}/${last.pred.n} 類</div>` : ''}</div>`;
  } else if (last?.type === 'playoff') {
    lastHtml = `<div class="card"><h3 class="first">第 ${last.week} 週季後賽結果</h3>${last.games.map((m) => `<div class="sumline">${esc(m.label)}：${esc(g.names[m.a])} ${m.res.w}-${m.res.l}-${m.res.t} ${esc(g.names[m.b])} → <b>${esc(g.names[m.winner])}</b> 晉級${m.winner === g.mySlot ? ' 🎉' : m.a === g.mySlot || m.b === g.mySlot ? ' 😢' : ''}</div>`).join('')}</div>`;
  }
  const stand = g.events.filter((e) => e.type === 'week').at(-1)?.standings;
  const rec = g.rec[g.mySlot];
  const isPO = g.phase === 'playoffs';
  const head = `<div class="card"><h3 class="first">${isPO ? '季後賽・' : ''}第 ${pv.week} 週${pv.dates ? `<span class="muted small">（重播 ${esc(pv.dates.start.slice(5))}～${esc(pv.dates.end.slice(5))}）</span>` : ''}</h3>
    <div class="sumline">戰績 ${rec.mw}-${rec.ml}｜排名第 ${g.myRank()}｜整季換人剩 ${g.budget} 次</div>
    <div class="sumline">${pv.opp != null ? `本週對手：<b>${esc(g.names[pv.opp])}</b>` : isPO ? (g.seeds.indexOf(g.mySlot) <= 1 && pv.week === 24 ? '你是前兩種子，這週輪空 😎' : '你已經被淘汰，接下來看別人打') : ''}</div>
    ${pv.cats ? `<div class="mn-cats" style="margin-top:6px">${pv.cats.map((c) => `<span class="tag ${probCls(c.prob)}">${esc(c.label)} ${Math.round(c.prob * 100)}%</span>`).join('')}</div>
      <div class="muted small">預估勝率：${pv.cats.filter((c) => c.prob > 0.5).length} 類領先、${pv.cats.filter((c) => c.prob < 0.5).length} 類落後｜你的弱項：${pv.weak.map(esc).join('、')}</div>` : ''}</div>`;

  pv.injuredIds = new Set(pv.injured.map((p) => p.id));
  const dropSel = (side, forId) => {
    const opts = g.teams[g.mySlot].filter((p) => p.side === side).sort((a, b) => pv.form(a) - pv.form(b))
      .map((p) => { const h = forId != null && pv.holesIf(forId, p.id) > 0; return `<option value="${p.id}">丟 ${esc(p.name)}${h ? '（會空出守位）' : ''}</option>`; }).join('');
    return (pv.room > 0 ? '<option value="">不丟（有空位）</option>' : '') + opts;
  };
  const ilCard = (pv.injured.length || pv.il.length || pv.room > 0) ? `<div class="card"><h3 class="first">🩹 傷兵與 IL（${2 - pv.ilFree}/2 格）</h3>
    ${pv.injured.map((p) => `<div class="mn-row"><div><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span> <span class="tag bad">連兩週沒上場</span></div>
      ${pv.ilFree > 0 ? `<button type="button" class="btn" data-il="${p.id}">移到 IL</button>` : '<span class="muted small">IL 已滿</span>'}</div>`).join('')}
    ${pv.il.map((x) => `<div class="mn-row"><div><span class="slot">IL</span> <b>${esc(x.p.name)}</b> ${x.healthy ? '<span class="tag good">已歸隊上場</span>' : '<span class="tag">還在養傷</span>'}
      ${x.healthy && pv.room <= 0 ? `<div><select class="mn-drop" data-unildrop="${x.p.id}">${dropSel(x.p.side, null)}</select></div>` : ''}</div>
      ${x.healthy ? `<button type="button" class="btn" data-unil="${x.p.id}">回到陣容</button>` : ''}</div>`).join('')}
    ${pv.room > 0 ? `<div class="sumline">陣容有 <b>${pv.room}</b> 個空位，可以直接撿人、不用丟人。</div>` : ''}</div>` : '';
  let bracketHtml = '';
  if (isPO) {
    const sd = g.seeds;
    const rows = g.bracket.map((m) => `<div class="sumline">第 ${m.week} 週・${esc(m.label)}：${esc(g.names[m.a])}（${sd.indexOf(m.a) + 1} 種）vs ${esc(g.names[m.b])}（${sd.indexOf(m.b) + 1} 種）${m.winner != null ? ` → <b>${esc(g.names[m.winner])}</b>` : ''}</div>`).join('');
    bracketHtml = `<div class="card"><h3 class="first">🏟 季後賽對戰表</h3><div class="sumline">你是第 <b>${sd.indexOf(g.mySlot) + 1}</b> 種子（1、2 種子第 24 週輪空）</div>
      <div class="muted small">種子：${sd.slice(0, 6).map((t, i) => `${i + 1}. ${esc(g.names[t])}`).join('　')}</div>${rows}</div>`;
  }
  const sugg = `<div class="card"><h3 class="first">撿人建議（整隊每週預估多贏幾類）</h3>
    ${pv.options.length ? pv.options.map((o) => `<div class="mn-row"><div>撿 <b>${esc(o.add.name)}</b> <span class="pos">${esc(o.add.pos)}</span>${o.add.rookie ? ' <span class="tag warn">新人</span>' : ''} ${o.drop ? `丟 ${esc(o.drop.name)}` : '（補空位，不用丟人）'}
        <div class="sub">${esc(recentLine(pv.recent(o.add), o.add))}</div><div class="note">每週多贏 ${o.gain.toFixed(2)} 類</div></div>
        <button type="button" class="btn" data-move="${o.add.id}:${o.drop?.id ?? ''}">撿</button></div>`).join('') : '<p class="muted small">自由球員裡目前沒有能讓你變強的人。</p>'}
    <div class="mn-actions"><button type="button" class="btn" data-act="auto-moves">照建議撿（最多 2 人）</button></div></div>`;

  const fa = g.searchFA(st.faQ, st.faSide);
  const manual = `<details class="card"><summary>自己找人撿</summary>
    <div class="toolbar" style="margin-top:8px"><input id="mn-faq" type="search" placeholder="搜尋自由球員" value="${esc(st.faQ)}">
      <select id="mn-faside"><option value="" ${st.faSide === '' ? 'selected' : ''}>全部</option><option value="B" ${st.faSide === 'B' ? 'selected' : ''}>打者</option><option value="P" ${st.faSide === 'P' ? 'selected' : ''}>投手</option></select></div>
    ${fa.slice(0, 20).map((p) => `<div class="mn-row"><div><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span>${p.rookie ? ' <span class="tag warn">新人</span>' : ''}<div class="sub">${esc(recentLine(pv.recent(p), p))}</div>
        <select class="mn-drop" data-dropfor="${p.id}">${dropSel(p.side, p.id)}</select></div>
        <button type="button" class="btn" data-manual="${p.id}">撿</button></div>`).join('')}</details>`;

  const starters = pv.lineup.filter((x) => x.p);
  const lu = `<details class="card" ${st.openLineup ? 'open' : ''} id="mn-lu-box"><summary>本週先發（預設照近況自動排）</summary>
    ${starters.map((x) => `<div class="mn-row mn-lu"><div><span class="slot">${esc(x.slot)}</span> <b>${esc(x.p.name)}</b> ${formTag(pv, x.p)}</div>
      <button type="button" class="btn" data-lu="${x.p.id}:bench">坐板凳</button></div>`).join('')}
    ${pv.bench.map((p) => `<div class="mn-row mn-lu bench"><div><span class="slot">板凳</span> <b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span> ${formTag(pv, p)}</div>
      <button type="button" class="btn" data-lu="${p.id}:start">上先發</button></div>`).join('')}
    <div class="mn-actions"><button type="button" class="btn" data-act="lu-reset">照近況自動排</button></div></details>`;

  const standHtml = stand ? `<details class="card"><summary>排名</summary><table class="tbl"><tbody>${stand.map((x, i) => `<tr class="${x.team === g.mySlot ? 'me' : ''} ${i === 5 ? 'cut' : ''}"><td>${i + 1}</td><td>${esc(g.names[x.team])}</td><td>${x.w}-${x.l}-${x.t}</td><td>${x.mw}-${x.ml}</td></tr>`).join('')}</tbody></table></details>` : '';

  const out = isPO && pv.opp == null && !(g.seeds.indexOf(g.mySlot) <= 1 && pv.week === 24);
  const bar = out
    ? `<button type="button" class="btn primary" data-act="play">▶ 看下一週</button><button type="button" class="btn" data-act="auto-rest">⏭ 看結果</button>`
    : `<button type="button" class="btn primary" data-act="play">▶ 開打</button>${pv.opp != null ? '<button type="button" class="btn" data-act="auto-play">照建議打</button>' : ''}<button type="button" class="btn" data-act="auto-rest">⏭ 全自動</button>`;
  $('#mn-body').innerHTML = lastHtml + bracketHtml + head + (pv.opp != null ? ilCard + sugg + manual + lu : '') + standHtml + `
    <div class="mn-sticky"><div class="mn-bar">${bar}</div></div>`;
}

// ── 結算 ──
function renderDone() {
  const g = st.g;
  const won = g.champ === g.mySlot;
  st.compare ??= g.compare();
  const c = st.compare;
  const last = g.events.at(-1);
  $('#mn-body').innerHTML = `<div class="card final ${won ? 'champ' : ''}">
      <div class="big">${won ? '🏆 你拿下 2027 冠軍！' : `冠軍：${esc(g.names[g.champ])}`}</div>
      <div class="muted">你例行賽第 ${g.myRank()} 名｜整季換人 ${150 - g.budget} 次｜對手共換人 ${g.aiTotal} 次</div>
      <div class="sumline" style="margin-top:8px">同一場選秀順位、同一個亂數，如果全照 App 建議：例行賽第 ${c.myRank} 名${c.champ ? '，而且拿冠軍' : `，冠軍是 ${esc(c.champName)}`}</div>
      <div class="mn-actions"><button type="button" class="btn primary" data-act="new">🔁 再玩一季</button></div></div>
    ${recapHtml(g)}
    ${last?.games ? `<div class="card"><h3 class="first">冠軍戰</h3>${last.games.map((m) => `<div class="sumline">${esc(g.names[m.a])} ${m.res.w}-${m.res.l}-${m.res.t} ${esc(g.names[m.b])}</div>`).join('')}</div>` : ''}`;
}

function recapHtml(g) {
  const r = g.recap();
  const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  const line = [];
  if (r.missed) line.push(`例行賽第 ${g.myRank()} 名，沒擠進前 6 名季後賽。`);
  else if (r.out) line.push(`以第 ${r.seed} 種子進季後賽，在<b>${esc(r.out.label)}</b>被 <b>${esc(g.names[r.out.by])}</b> 淘汰（${r.out.a === g.mySlot ? `${r.out.res.w}-${r.out.res.l}-${r.out.res.t}` : `${r.out.res.l}-${r.out.res.w}-${r.out.res.t}`}）。`);
  else if (g.champ === g.mySlot) line.push(`以第 ${r.seed} 種子一路打到冠軍 🏆`);
  return `<div class="card"><h3 class="first">📋 本季回顧</h3>
    ${line.map((x) => `<div class="sumline">${x}</div>`).join('')}
    ${r.steal ? `<div class="sumline">💎 選秀最賺：第 ${r.steal.round} 輪的 <b>${esc(r.steal.player.name)}</b>（整季表現在所有${r.steal.player.side === 'B' ? '打者' : '投手'}中前 ${r.steal.pct}%）</div>` : ''}
    ${r.bust ? `<div class="sumline">💥 選秀最虧：第 ${r.bust.round} 輪的 <b>${esc(r.bust.player.name)}</b>（整季表現只在所有${r.bust.player.side === 'B' ? '打者' : '投手'}中前 ${r.bust.pct}%）</div>` : ''}
    ${r.bestAdd ? `<div class="sumline">🎯 最佳撿人：第 ${r.bestAdd.week + 1} 週撿的 <b>${esc(r.bestAdd.add.name)}</b>（整季表現在所有${r.bestAdd.add.side === 'B' ? '打者' : '投手'}中前 ${r.bestAdd.pct}%）</div>` : ''}
    ${r.accuracy != null ? `<div class="sumline">🔮 賽前預估命中率：${Math.round(r.accuracy * 100)}%（每類預估勝負跟實際對得上的比例，50% 等於亂猜）</div>` : ''}</div>`;
}

function render() {
  status('');
  $('#mn-start').hidden = !!st.g;
  if (!st.g) { $('#mn-body').innerHTML = ''; updateContinue(); return; }
  if (st.g.phase === 'draft') renderDraft();
  else if (st.g.phase === 'done') renderDone();
  else renderWeek();
}

export function initManual({ getSelection, getSeason, getProfiles }) {
  Object.assign(st, { getSelection, getSeason, getProfiles });
  $('#mn-slot').insertAdjacentHTML('beforeend', Array.from({ length: TEAMS }, (_, i) => `<option value="${i}">第 ${i + 1} 順位</option>`).join(''));
  $('#mn-new').addEventListener('click', newGame);
  $('#mn-continue').addEventListener('click', continueGame);
  const body = $('#mn-body');
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const g = st.g;
    const top = () => window.scrollTo(0, 0);
    if (b.dataset.pick) return act(() => { st.lastSeen = g.draftLog.length + 1; g.draftPick(Number(b.dataset.pick)); st.q = ''; top(); });
    if (b.dataset.move) { const [a, d] = b.dataset.move.split(':'); return act(() => g.move(Number(a), d ? Number(d) : null)); }
    if (b.dataset.manual) { const d = body.querySelector(`[data-dropfor="${b.dataset.manual}"]`).value; return act(() => g.move(Number(b.dataset.manual), d ? Number(d) : null)); }
    if (b.dataset.il) return act(() => g.toIL(Number(b.dataset.il)));
    if (b.dataset.unil) { const sel = body.querySelector(`[data-unildrop="${b.dataset.unil}"]`); return act(() => g.fromIL(Number(b.dataset.unil), sel?.value ? Number(sel.value) : null)); }
    if (b.dataset.lu) {
      const [id, v] = b.dataset.lu.split(':');
      st.openLineup = true;
      act(() => g.setLineup(Number(id), v));
      const still = g.preview().lineup.some((x) => x.p?.id === Number(id));
      if (v === 'bench' && still) status('隊上沒有其他人能守這個位置，他只能繼續先發。先撿一個同守位的人再換。', 'warn');
      return;
    }
    const a = b.dataset.act;
    if (a === 'draft-auto1') return act(() => { st.lastSeen = g.draftLog.length + 1; g.draftPick(g.draftOptions().recommended[0].id); top(); });
    if (a === 'draft-rest') return act(() => { g.autoDraftRest(); top(); });
    if (a === 'auto-moves') return act(() => { const n = g.autoMoves(); if (!n) setTimeout(() => status('目前沒有值得換的人。'), 0); });
    if (a === 'lu-reset') return act(() => g.resetLineup());
    if (a === 'play') return act(() => { st.openLineup = false; g.playWeek(); window.scrollTo(0, 0); });
    if (a === 'auto-play') return act(() => { g.autoMoves(); g.playWeek(); window.scrollTo(0, 0); });
    if (a === 'auto-rest') {
      // 手機上要算十幾秒：先顯示提示、讓畫面更新，再開始算
      status('自動打完剩下的球季中…（手機上大約 10～20 秒）');
      body.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      return setTimeout(() => act(() => { g.autoRest(); top(); }), 50);
    }
    if (a === 'new') { lsSet(LS_SAVE, null); st.g = null; render(); }
  });
  body.addEventListener('input', (e) => {
    if (e.target.id === 'mn-q') { st.q = e.target.value; const pos = e.target.selectionStart; renderDraft(); const el = $('#mn-q'); el.focus(); el.setSelectionRange(pos, pos); }
    if (e.target.id === 'mn-faq') { st.faQ = e.target.value; const pos = e.target.selectionStart; renderWeek(); const box = e.target; const el = $('#mn-faq'); el.closest('details').open = true; el.focus(); el.setSelectionRange(pos, pos); }
  });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'mn-pos') { st.pos = e.target.value; renderDraft(); }
    if (e.target.id === 'mn-faside') { st.faSide = e.target.value; renderWeek(); $('#mn-faq').closest('details').open = true; }
  });
  updateContinue();
}

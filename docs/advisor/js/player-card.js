// 球員一句話理由＋底部詳情卡（選秀表、Demo 選秀共用）
import { esc, haptic, sheet, closeSheet, sparkline, zPct, icon, toast } from './ui-kit.js';
import { statusOf, setStatus } from './mylist.js';

export const NICE = {
  'B:R': '得分', 'B:H': '安打', 'B:HR': '全壘打', 'B:RBI': '打點', 'B:SB': '盜壘', 'B:BB': '保送', 'B:K': '少三振', 'B:AVG': '打擊率', 'B:OPS': 'OPS',
  'P:W': '勝投', 'P:L': '少敗投', 'P:SV': '救援', 'P:BB': '少保送', 'P:K': '三振', 'P:HLD': '中繼', 'P:ERA': 'ERA', 'P:WHIP': 'WHIP', 'P:QS': '優質先發',
};
export const topPct = (z) => Math.max(1, Math.round((1 - zPct(z)) * 100));

// 一句話理由：最強的 1~2 個類別＋加分／風險
export function reasonOf(p) {
  const top = Object.entries(p.z ?? {}).filter(([, z]) => z > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 2);
  let t = top.length ? top.map(([c, z]) => `${NICE[c]}前 ${topPct(z)}%`).join('、') : '各類別都在平均附近，沒有明顯強項';
  const notes = p.notes ?? [];
  const plus = notes.find((n) => /還在進步|進步很多|反彈|可能變好/.test(n));
  const risk = notes.find((n) => /傷兵名單|受傷|少選|偏大|保送|退步|可能變差/.test(n));
  if (plus) t += `，${plus}`;
  if (risk) t += `；注意：${risk}`;
  return t;
}

export function statLine(p) {
  const r3 = (v) => (v ?? 0).toFixed(3).replace(/^0/, '');
  const n0 = (v) => Math.round(v ?? 0);
  if (p.side === 'B') return `R ${n0(p.R)}｜HR ${n0(p.HR)}｜RBI ${n0(p.RBI)}｜SB ${n0(p.SB)}｜AVG ${r3(p.AVG)}｜OPS ${r3(p.OPS)}`;
  const era = p.IP ? ((p.ER * 9) / p.IP).toFixed(2) : '-';
  const whip = p.IP ? (p.WH / p.IP).toFixed(2) : '-';
  return `${n0(p.IP)} 局｜W ${n0(p.W)}｜SV ${n0(p.SV)}｜HLD ${n0(p.HLD)}｜K ${n0(p.K)}｜ERA ${era}｜WHIP ${whip}`;
}

// 逐週資料（每年一個檔，讀一次就快取）
const weeklyCache = new Map();
const weeklyData = (season) => {
  if (!weeklyCache.has(season)) weeklyCache.set(season, fetch(`data/weekly-${season}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return weeklyCache.get(season);
};
function trendOf(p, wk) {
  const rec = wk?.players?.[`${p.side}${p.id}`];
  if (!rec) return null;
  if (p.side === 'B') {
    const iO = wk.hitCols.indexOf('OPSx1000');
    const iP = wk.hitCols.indexOf('PA');
    return { label: '每週 OPS', vals: rec.w.map((w) => (Array.isArray(w) && w[iP] >= 8 ? w[iO] / 1000 : null)), fmt: (v) => v.toFixed(3).replace(/^0/, '') };
  }
  if (p.pos === 'SP') {
    const iK = wk.pitCols.indexOf('K');
    return { label: '每週三振', vals: rec.w.map((w) => (Array.isArray(w) ? w[iK] : null)), fmt: (v) => v.toFixed(1) };
  }
  const iS = wk.pitCols.indexOf('SV');
  const iH = wk.pitCols.indexOf('HLD');
  return { label: '每週 SV＋HLD', vals: rec.w.map((w) => (Array.isArray(w) ? w[iS] + w[iH] : null)), fmt: (v) => v.toFixed(1) };
}

// 詳情卡：season＝數據年份（長條、折線）；lead＝最上面那句話（預設用 reasonOf）；
// actions＝[{ label, primary, run }]，按了會先關卡片再執行
// 我的名單按鈕（⭐ 優先想要／🚫 不要）：再按一次就拿掉
export function listButtons(id) {
  const st = statusOf(id);
  return `<div class="ml-btns" data-ml-id="${esc(id)}">
    <button type="button" class="ml-b ${st === 'prio' ? 'on prio' : ''}" data-ml="prio" aria-pressed="${st === 'prio'}">${icon('star', { fill: st === 'prio' })}${st === 'prio' ? '在優先名單' : '加入優先'}</button>
    <button type="button" class="ml-b ${st === 'no' ? 'on no' : ''}" data-ml="no" aria-pressed="${st === 'no'}">${icon('ban')}${st === 'no' ? '在不要名單' : '加入不要'}</button></div>`;
}
export function bindListButtons(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ml]');
    if (!b) return;
    const wrap = b.closest('[data-ml-id]');
    const id = wrap.dataset.mlId;
    const kind = statusOf(id) === b.dataset.ml ? null : b.dataset.ml;
    setStatus(id, kind);
    haptic('mark');
    wrap.outerHTML = listButtons(id);
    toast(kind === 'prio' ? '已加入優先：推薦會往前排' : kind === 'no' ? '已加入不要：不會再推薦' : '已從名單拿掉', { ms: 2500 });
  });
}

// 列表上直接按的小按鈕（選秀表、模擬選秀每一列都有）：⭐ 優先、🚫 不要；再按一次拿掉
export function quickList(id, name = '') {
  const st = statusOf(id);
  return `<div class="ml-q" data-ml-id="${esc(id)}">
    <button type="button" class="mlq prio ${st === 'prio' ? 'on' : ''}" data-mlq="prio" aria-pressed="${st === 'prio'}" aria-label="${esc(name)} 加入優先">${icon('star', { fill: st === 'prio' })}</button>
    <button type="button" class="mlq no ${st === 'no' ? 'on' : ''}" data-mlq="no" aria-pressed="${st === 'no'}" aria-label="${esc(name)} 加入不要">${icon('ban')}</button></div>`;
}
// 點到小按鈕就處理並回傳 true（呼叫的地方就不要再當成點整列）
export function handleQuickList(e) {
  const b = e.target.closest('[data-mlq]');
  if (!b) return false;
  e.stopPropagation();
  const id = b.closest('[data-ml-id]').dataset.mlId;
  const kind = statusOf(id) === b.dataset.mlq ? null : b.dataset.mlq;
  haptic('mark');
  setStatus(id, kind);
  toast(kind === 'prio' ? '已加入優先：推薦會往前排' : kind === 'no' ? '已加入不要：不會再推薦' : '已從名單拿掉', { ms: 2000 });
  return true;
}

const SRC_TXT = { 預測: '明年預測 60%＋去年實際 40%', Marcel: 'Marcel 推估（官方沒有預測）' };
// 一頁看完：數字一行、長條兩欄、走勢小圖
function cardHtml(p, { season, lead, extra = '', actions = [], list = true, nav }) {
  const cells = Object.entries(p.z ?? {}).map(([c, z]) => {
    const pct = zPct(z);
    const cls = pct >= 0.8 ? 'good' : pct <= 0.3 ? 'bad' : '';
    return `<div class="pc-c"><div class="pc-cl"><span>${esc(NICE[c])}</span><b class="${cls}">前 ${topPct(z)}%</b></div><span class="mb-t"><i class="${cls}" style="width:${Math.round(Math.max(0.03, Math.min(1, pct)) * 100)}%"></i></span></div>`;
  }).join('');
  return `
    <div class="sh-head"><div><div class="sh-name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div><div class="muted small">${esc(p.team)}・${p.age} 歲${nav ? '｜左右滑：上一位／下一位' : ''}</div></div><button type="button" class="sh-x" data-close aria-label="關閉">✕</button></div>
    <div class="pc-k"><span>選秀表 <b>${p.rank}</b></span><span>建議第 <b>${p.round}</b> 輪</span><span>市場 <b>${p.marketRank}</b></span></div>
    ${list ? listButtons(p.id) : ''}
    <p class="pc-lead">${esc(lead ?? reasonOf(p))}</p>${extra}
    <div class="pc-h">各類別在聯盟的位置${season ? `（${season} 季）` : ''}</div><div class="pc-grid">${cells}</div>
    <div class="pc-h" id="sh-trend-t">${season ?? ''} 逐週走勢</div><div id="sh-trend" class="muted small">${season ? '讀取中…' : '沒有逐週資料'}</div>
    <div class="pc-stat">${esc(statLine(p))}${p.projSrc ? `｜${esc(SRC_TXT[p.projSrc] ?? '官方預測（去年沒在大聯盟）')}` : ''}</div>
    ${p.notes?.length ? `<div class="note">${esc(p.notes.join('、'))}</div>` : ''}
    ${actions.length ? `<div class="sh-acts">${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'primary' : ''}" data-sh="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
}

function loadTrend(p, season, isCur) {
  if (!season) return;
  weeklyData(season).then((wk) => {
    const el = document.getElementById('sh-trend');
    if (!el || !isCur()) return;
    const t = trendOf(p, wk);
    if (!t) { el.textContent = '沒有逐週資料'; return; }
    const got = t.vals.filter((v) => v != null);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    document.getElementById('sh-trend-t').textContent = `${season} ${t.label}｜全季 ${t.fmt(avg(got))}｜最後 4 週 ${t.fmt(avg(got.slice(-4)))}`;
    el.className = 'trend';
    el.innerHTML = sparkline(t.vals, { w: 300, h: 34, label: t.label });
  });
}

// nav(p, dir)：dir＝1 下一位、-1 上一位；回傳 { p, opts } 或 null（到頭了）
export function openPlayerCard(p, opts = {}) {
  haptic('tap');
  const box = sheet('<div class="pc"></div>');
  const host = box.querySelector('.pc');
  let cur = null;
  const fill = (c, dir = 0) => {
    cur = c;
    host.innerHTML = cardHtml(c.p, { ...c.opts, nav: opts.nav });
    if (dir) { host.classList.remove('in-l', 'in-r'); void host.offsetWidth; host.classList.add(dir > 0 ? 'in-r' : 'in-l'); }
    box.scrollTop = 0;
    const me = c;
    loadTrend(c.p, c.opts.season, () => cur === me);
  };
  fill({ p, opts });
  bindListButtons(box);
  box.addEventListener('click', (e) => {
    const i = e.target.closest('[data-sh]')?.dataset.sh;
    if (i != null) { closeSheet(); cur.opts.actions[Number(i)].run(); }
  });
  if (!opts.nav) return;
  // 左右滑：上一位／下一位（橫向移動要明顯大於上下，才不會跟往下拉關閉打架）
  let x0 = null, y0 = 0;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const dir = dx < 0 ? 1 : -1;
    const n = opts.nav(cur.p, dir);
    if (!n) { haptic('warn'); toast(dir > 0 ? '已經是最後一位' : '已經是第一位', { ms: 1500 }); return; }
    haptic('tap');
    fill(n, dir);
  });
}

// 球員一句話理由＋底部詳情卡（選秀表、Demo 選秀共用）
import { esc, haptic, sheet, closeSheet, sparkline, miniBars, zPct } from './ui-kit.js';

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
  const plus = notes.find((n) => /上升|進步/.test(n));
  const risk = notes.find((n) => /不足|避開|偏大|保送/.test(n));
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
export function openPlayerCard(p, { season, lead, extra = '', actions = [] } = {}) {
  haptic('tap');
  const bars = miniBars(Object.entries(p.z ?? {}).map(([c, z]) => {
    const pct = zPct(z);
    return { label: NICE[c], pct, text: `前 ${topPct(z)}%`, cls: pct >= 0.8 ? 'good' : pct <= 0.3 ? 'bad' : '' };
  }));
  const box = sheet(`
    <div class="sh-head"><div><div class="sh-name">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></div><div class="muted small">${esc(p.team)}・${p.age} 歲</div></div><button type="button" class="sh-x" data-close aria-label="關閉">✕</button></div>
    <div class="kpis"><div><b>${p.rank}</b><span>選秀表</span></div><div><b>${p.round}</b><span>建議輪次</span></div><div><b>${p.marketRank}</b><span>市場排名</span></div></div>
    <p class="why1 lead">${esc(lead ?? reasonOf(p))}</p>${extra}
    <h3>各類別在聯盟的位置${season ? `（${season} 季）` : ''}</h3>${bars}
    <h3 id="sh-trend-t">${season ?? ''} 逐週走勢</h3><div id="sh-trend" class="muted small">讀取中…</div>
    <div class="line small muted" style="margin-top:10px">${esc(statLine(p))}</div>
    ${p.notes?.length ? `<div class="note">${esc(p.notes.join('、'))}</div>` : ''}
    ${actions.length ? `<div class="sh-acts">${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'primary' : ''}" data-sh="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`);
  box.addEventListener('click', (e) => {
    const i = e.target.closest('[data-sh]')?.dataset.sh;
    if (i != null) { closeSheet(); actions[Number(i)].run(); }
  });
  if (!season) { document.getElementById('sh-trend').textContent = '沒有逐週資料'; return; }
  weeklyData(season).then((wk) => {
    const el = document.getElementById('sh-trend');
    if (!el) return;
    const t = trendOf(p, wk);
    if (!t) { el.textContent = '沒有逐週資料'; return; }
    const got = t.vals.filter((v) => v != null);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    document.getElementById('sh-trend-t').textContent = `${season} ${t.label}`;
    el.className = 'trend';
    el.innerHTML = `${sparkline(t.vals, { w: 240, h: 44, label: t.label })}<div class="muted small">全季平均 ${t.fmt(avg(got))}｜最後 4 週 ${t.fmt(avg(got.slice(-4)))}</div>`;
  });
}

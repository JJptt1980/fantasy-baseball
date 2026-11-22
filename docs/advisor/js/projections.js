// 球員評價的額外資料（全部是 MLB 官方 statsapi，僅個人非商業使用）：
//   預測（projectedRos／projected／ZiPS）、Statcast 預期數據、傷兵名單；官方沒預測的人用 Marcel 自己算
// 抓的頻率：開季前預測一週一次、傷兵一天一次、已結束球季的 Statcast 抓一次就永久存著
import { ipToFloat } from './mlb.js';

const API = 'https://statsapi.mlb.com/api/v1';
const VER = 'p1';
const DAY = 864e5;
const HIT_F = 'gamesPlayed,atBats,plateAppearances,runs,hits,homeRuns,rbi,stolenBases,baseOnBalls,strikeOuts,ops';
const PIT_F = 'gamesPlayed,gamesStarted,inningsPitched,wins,losses,saves,holds,baseOnBalls,strikeOuts,earnedRuns,hits,qualityStarts';

function cacheGet(key, maxAge) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && v.ver === VER && (maxAge == null || Date.now() - v.at < maxAge) ? v.data : null;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ver: VER, at: Date.now(), data })); } catch { /* 空間不夠就不存 */ }
}
async function getJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`MLB 資料讀取失敗（${r.status}）`);
  return r.json();
}
const statsUrl = (type, group, season, fields) =>
  `${API}/stats?stats=${type}&group=${group}&season=${season}&sportId=1&limit=6000&playerPool=ALL&fields=stats,splits,player,id,fullName,position,abbreviation,stat,${fields}`;

// ── 預測 ──
// 回傳 { hit: Map(id → {name,pos,stat}), pit: Map, sources: ['projectedRos', ...] }；多個預測系統取平均
const SYSTEMS = ['projectedRos', 'projected', 'projected_Zips'];
export const PRESEASON = ['projected', 'projected_Zips'];
// systems：Demo 重播只能用開季前的預測（projected、ZiPS），不能用季中會更新的 projectedRos
export async function projections(season, { maxAge = 7 * DAY, systems = SYSTEMS } = {}) {
  const key = `proj.${season}.${systems.join('+')}`;
  const c = cacheGet(key, maxAge);
  if (c) return revive(c);
  const out = { hit: {}, pit: {}, sources: [] };
  for (const sys of systems) {
    let got = 0;
    for (const [group, side, fields] of [['hitting', 'hit', HIT_F], ['pitching', 'pit', PIT_F]]) {
      let splits = [];
      try { splits = (await getJson(statsUrl(sys, group, season, fields))).stats?.[0]?.splits ?? []; } catch { splits = []; }
      for (const s of splits) {
        const st = { ...s.stat };
        if (side === 'pit') { st._ip = ipToFloat(st.inningsPitched); if (st._ip < 10) continue; } else if ((st.plateAppearances ?? 0) < 50) continue;
        const id = s.player?.id;
        if (!id) continue;
        (out[side][id] ??= { name: s.player.fullName ?? '', pos: s.position?.abbreviation ?? '', list: [] }).list.push(st);
        got++;
      }
    }
    if (got) out.sources.push(sys);
  }
  // 多個系統 → 數字欄位平均
  for (const side of ['hit', 'pit']) {
    for (const rec of Object.values(out[side])) {
      const avg = {};
      for (const st of rec.list) for (const [k, v] of Object.entries(st)) {
        const n = typeof v === 'number' ? v : k === 'ops' ? Number(v) : null;
        if (n != null && Number.isFinite(n)) avg[k] = (avg[k] ?? 0) + n / rec.list.length;
      }
      rec.stat = avg;
      delete rec.list;
    }
  }
  cacheSet(key, out);
  return revive(out);
}
const revive = (o) => ({ hit: new Map(Object.entries(o.hit).map(([k, v]) => [Number(k), v])), pit: new Map(Object.entries(o.pit).map(([k, v]) => [Number(k), v])), sources: o.sources });

// ── Statcast 預期數據（運氣成分） ──
// 打者：xwOBA vs 實際 wOBA；投手：xFIP vs 實際 ERA。回傳 Map('B'+id / 'P'+id → { diff, text })
export async function luck(season) {
  const key = `luck.${season}`;
  const finished = season < new Date().getFullYear() || new Date().getMonth() >= 10;
  const c = cacheGet(key, finished ? null : DAY);
  if (c) return new Map(c);
  const [xh, sh, sp] = await Promise.all([
    getJson(statsUrl('expectedStatistics', 'hitting', season, 'woba')),
    getJson(statsUrl('sabermetrics', 'hitting', season, 'woba')),
    getJson(statsUrl('sabermetrics', 'pitching', season, 'xfip')),
  ]);
  const actual = new Map((sh.stats?.[0]?.splits ?? []).map((s) => [s.player.id, s.stat.woba]));
  const out = [];
  for (const s of xh.stats?.[0]?.splits ?? []) {
    const a = actual.get(s.player.id);
    const x = Number(s.stat.woba);
    if (a == null || !Number.isFinite(x)) continue;
    out.push([`B${s.player.id}`, { diff: Math.round((a - x) * 1000) / 1000 }]);
  }
  for (const s of sp.stats?.[0]?.splits ?? []) if (Number.isFinite(s.stat.xfip)) out.push([`P${s.player.id}`, { xfip: Math.round(s.stat.xfip * 100) / 100 }]);
  cacheSet(key, out);
  return new Map(out);
}

// ── 傷兵名單（最近 12 個月的異動紀錄） ──
// 回傳 Map(id → { stints, days, last: '右手肘', on: true/false, since: 'YYYY-MM-DD' })
export async function injuries() {
  const c = cacheGet('inj', DAY);
  if (c) return new Map(c);
  const end = new Date();
  const start = new Date(end.getTime() - 365 * DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  const j = await getJson(`${API}/transactions?sportId=1&startDate=${iso(start)}&endDate=${iso(end)}&fields=transactions,person,id,date,description`);
  const by = new Map();
  for (const t of (j.transactions ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const d = (t.description ?? '').toLowerCase();
    if (!d.includes('injured list') || !t.person) continue;
    const r = by.get(t.person.id) ?? { stints: 0, days: 0, on: false, since: null, last: '' };
    if (/placed .* on the \d+-day injured list/.test(d)) {
      if (!r.on) { r.stints++; r.on = true; r.since = t.date; }
      const m = t.description.match(/injured list\.?\s*(.*)$/i);
      r.last = zhInjury((m?.[1] ?? '').replace(/retroactive to [^.]*\.\s*/i, '').replace(/\.$/, '')).slice(0, 40);
      r.long = r.long || /60-day/.test(d);
    } else if (/transferred .* to the 60-day injured list/.test(d)) {
      r.long = true;
    } else if (/activated|reinstated/.test(d) && r.on) {
      r.days += Math.round((new Date(t.date) - new Date(r.since)) / DAY);
      r.on = false;
    }
    by.set(t.person.id, r);
  }
  for (const r of by.values()) if (r.on && r.since) r.days += Math.round((end - new Date(r.since)) / DAY);
  const out = [...by.entries()];
  cacheSet('inj', out);
  return new Map(out);
}

// 傷病說明：常見部位與傷勢翻成中文（其他保留英文）
const ZH = [
  [/tommy john surgery/i, '韌帶重建手術'], [/ulnar collateral ligament|ucl/i, '手肘韌帶'], [/core muscle/i, '核心肌群'],
  [/hamstring/i, '大腿後側'], [/oblique/i, '腹斜肌'], [/rotator cuff/i, '旋轉肌'], [/lat(issimus)?\b/i, '背闊肌'],
  [/shoulder/i, '肩膀'], [/elbow/i, '手肘'], [/forearm/i, '前臂'], [/wrist/i, '手腕'], [/thumb/i, '拇指'], [/finger/i, '手指'], [/hand/i, '手'],
  [/knee/i, '膝蓋'], [/ankle/i, '腳踝'], [/foot/i, '腳'], [/calf/i, '小腿'], [/hip/i, '髖部'], [/groin/i, '鼠蹊部'], [/quad(riceps)?/i, '大腿前側'],
  [/lower back|low back/i, '下背'], [/back/i, '背部'], [/neck/i, '脖子'], [/ribs?/i, '肋骨'], [/concussion/i, '腦震盪'], [/biceps?/i, '二頭肌'], [/triceps?/i, '三頭肌'],
  [/strain(ed)?/i, '拉傷'], [/sprain(ed)?/i, '扭傷'], [/inflammation/i, '發炎'], [/fracture(d)?/i, '骨折'], [/tendinitis|tendonitis/i, '肌腱炎'],
  [/surgery/i, '手術'], [/injury/i, '受傷'], [/soreness/i, '痠痛'], [/tightness/i, '緊繃'], [/contusion/i, '挫傷'], [/torn|tear/i, '撕裂'], [/fatigue/i, '疲勞'], [/illness/i, '生病'],
  [/\bleft\b/i, '左'], [/\bright\b/i, '右'],
];
function zhInjury(s) {
  let t = s;
  for (const [re, zh] of ZH) t = t.replace(new RegExp(re.source, 'gi'), zh);
  return t.replace(/\s+/g, '').replace(/^(左|右)?(.*)$/, '$1$2');
}

// ── Marcel 預測（官方預測沒有的人）：近 3 季加權 5/4/3（投手 3/2/1）、往聯盟平均拉回、依年齡調整 ──
const HIT_C = ['runs', 'hits', 'homeRuns', 'rbi', 'stolenBases', 'baseOnBalls', 'strikeOuts', 'atBats'];
const PIT_C = ['wins', 'losses', 'saves', 'holds', 'baseOnBalls', 'strikeOuts', 'earnedRuns', 'hits', 'gamesStarted'];
export function marcel(years, id, side) {
  // years：[今年 maps, 去年, 前年]（toMaps 格式），回傳 stat 物件或 null
  const W = side === 'hit' ? [5, 4, 3] : [3, 2, 1];
  const vol = (st) => (side === 'hit' ? st.plateAppearances ?? st.atBats ?? 0 : st._ip ?? 0);
  const recs = years.map((y) => y?.[side].get(id)?.stat ?? null);
  if (!recs[0] && !recs[1]) return null;
  // 聯盟平均（用今年有一定量的人）
  const pool = [...(years[0]?.[side].values() ?? [])].map((x) => x.stat).filter((st) => vol(st) > (side === 'hit' ? 300 : 80));
  const lgVol = pool.reduce((a, st) => a + vol(st), 0) || 1;
  const cats = side === 'hit' ? HIT_C : PIT_C;
  const lg = Object.fromEntries(cats.map((c) => [c, pool.reduce((a, st) => a + (st[c] ?? 0), 0) / lgVol]));
  let wv = 0;
  const sum = Object.fromEntries(cats.map((c) => [c, 0]));
  recs.forEach((st, i) => { if (!st) return; wv += W[i] * vol(st); for (const c of cats) sum[c] += W[i] * (st[c] ?? 0); });
  const reg = side === 'hit' ? 1200 : 134 * 3;
  const age = recs[0]?.age ?? recs[1]?.age ?? 29;
  const ageAdj = age < 29 ? 1 + (29 - age) * 0.006 : 1 - (age - 29) * 0.003;
  const v1 = recs[0] ? vol(recs[0]) : 0;
  const v2 = recs[1] ? vol(recs[1]) : 0;
  const proj = side === 'hit' ? 0.5 * v1 + 0.1 * v2 + 200 : 0.5 * v1 + 0.1 * v2 + (((recs[0]?.gamesStarted ?? 0) > 5) ? 60 : 25);
  const st = { age };
  for (const c of cats) {
    let rate = (sum[c] + reg * lg[c]) / (wv + reg);
    if (['runs', 'hits', 'homeRuns', 'rbi', 'baseOnBalls'].includes(c) && side === 'hit') rate *= ageAdj;
    st[c] = rate * proj;
  }
  if (side === 'hit') {
    st.plateAppearances = proj;
    const ops = recs.map((r, i) => (r ? [Number(r.ops) || 0, W[i] * vol(r)] : null)).filter(Boolean);
    const w = ops.reduce((a, [, x]) => a + x, 0);
    st.ops = ((ops.reduce((a, [o, x]) => a + o * x, 0) + reg * 0.72) / (w + reg)) * ageAdj;
    st.gamesPlayed = Math.round(proj / 4.2);
  } else {
    st._ip = proj;
    st.inningsPitched = String(Math.round(proj));
  }
  return st;
}

// ── 混合：預測 w、實際（兩年加權）1-w；官方沒預測就用 Marcel ──
// actual：blendMaps 後的 maps；years：[今年, 去年, 前年] 原始 maps；回傳新 maps（buildPlayers 用）＋每人來源
export function withProjections(actual, proj, years, w = 0.6) {
  const out = { hit: new Map(), pit: new Map(), src: new Map() };
  for (const side of ['hit', 'pit']) {
    const ids = new Set([...actual[side].keys(), ...(proj?.[side].keys() ?? [])]);
    for (const id of ids) {
      const a = actual[side].get(id);
      const p = proj?.[side].get(id);
      let pst = p?.stat ?? null;
      let src = pst ? '預測' : null;
      if (!pst && a) { pst = marcel(years, id, side); src = pst ? 'Marcel' : null; }
      if (!a && !pst) continue;
      if (!a) {
        // 只有預測（例：新人）：照預測，守位用預測的；沒名字的跳過
        if (!p?.name) continue;
        const st = { ...pst };
        if (side === 'pit') st._ip = st._ip ?? ipToFloat(st.inningsPitched);
        out[side].set(id, { id, name: p.name, pos: p.pos === 'P' ? 'P' : p.pos, team: '', stat: st });
        out.src.set(`${side}${id}`, '預測（新人）');
        continue;
      }
      if (!pst) { out[side].set(id, a); continue; }
      // 每打席／每局的「效率」照 w 混合，出賽量用預測的（受傷那年出賽少，不重複扣分）
      const st = { ...a.stat };
      const pVol = side === 'hit' ? pst.plateAppearances ?? 0 : pst._ip ?? ipToFloat(pst.inningsPitched);
      const aVol = side === 'hit' ? a.stat.plateAppearances ?? a.stat.atBats ?? 0 : a.stat._ip ?? 0;
      const counts = side === 'hit' ? HIT_C : PIT_C;
      // 實際成績的可信度：樣本小（打席／局數少）就少算一點，其餘交給預測
      const full = side === 'hit' ? 400 : (pst.gamesStarted ?? 0) > 5 ? 100 : 50;
      const wa = (1 - w) * Math.min(1, aVol / full);
      for (const k of counts) {
        const pr = pVol ? (pst[k] ?? 0) / pVol : 0;
        const ar = aVol ? (a.stat[k] ?? 0) / aVol : pr;
        st[k] = ((1 - wa) * pr + wa * ar) * pVol;
      }
      if (side === 'hit') {
        st.plateAppearances = pVol;
        st.gamesPlayed = pst.gamesPlayed ?? st.gamesPlayed;
        const po = Number(pst.ops);
        const ao = Number(a.stat.ops);
        if (Number.isFinite(po) && Number.isFinite(ao)) st.ops = (1 - wa) * po + wa * ao;
      } else {
        st._ip = pVol;
        st.inningsPitched = String(pVol);
        st.gamesStarted = pst.gamesStarted ?? st.gamesStarted;
      }
      out[side].set(id, { ...a, stat: st });
      out.src.set(`${side}${id}`, src);
    }
  }
  return out;
}

// ── 加到球員身上的備註（選秀表、詳情卡用） ──
export function annotate(players, { luck: lk, inj, src } = {}) {
  for (const p of players) {
    const extra = [];
    const s = src?.get(`${p.side === 'B' ? 'hit' : 'pit'}${p.id}`);
    if (s) p.projSrc = s;
    const l = lk?.get(`${p.side}${p.id}`);
    if (l && p.side === 'B' && Math.abs(l.diff) >= 0.03) extra.push(l.diff > 0 ? `運氣偏好（wOBA 比預期高 ${l.diff.toFixed(3).replace(/^0/, '')}），可能退步` : `運氣偏差（wOBA 比預期低 ${(-l.diff).toFixed(3).replace(/^0/, '')}），可能反彈`);
    if (l && p.side === 'P' && p.IP >= 40 && Number.isFinite(l.xfip)) {
      const era = (p.ER * 9) / p.IP;
      const d = era - l.xfip;
      if (Math.abs(d) >= 0.6) extra.push(d < 0 ? `ERA 比實力好（xFIP ${l.xfip}），可能變差` : `ERA 比實力差（xFIP ${l.xfip}），可能變好`);
    }
    const i = inj?.get(p.id);
    if (i?.on) extra.push(`目前在${i.long ? ' 60 天' : ''}傷兵名單${i.last ? `（${i.last}）` : ''}`);
    else if (i && (i.stints >= 2 || i.days >= 45)) extra.push(`近一年進傷兵名單 ${i.stints} 次、共 ${i.days} 天${i.last ? `（最近：${i.last}）` : ''}`);
    p.extraNotes = extra;
  }
  return players;
}

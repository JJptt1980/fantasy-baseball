// 各家選秀順位（ADP）：Yahoo 全站、你們聯盟近兩年真實順位、ESPN；一天最多抓一次
// Yahoo 兩項要在 App 裡（用你的 Yahoo 登入讀網頁，僅自用）；ESPN 是公開 JSON（沒有公開文件，僅自用）
import * as Y from './yahoo-source.js';
import { matchPlayer } from './draft-sync.js';

const VER = 'a1';
const DAY = 864e5;
function cacheGet(key, maxAge) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && v.ver === VER && Date.now() - v.at < maxAge ? v.data : null; } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ver: VER, at: Date.now(), data })); } catch { /* 略 */ }
}

// ESPN：專家排名（ROTO）＋ ADP（休賽季 ADP 都是預設值 260，視為沒有）
export async function espn(season) {
  const key = `adp.espn.${season}`;
  const c = cacheGet(key, DAY);
  if (c) return c;
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`;
  const filter = { players: { limit: 600, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'ROTO' } } };
  const r = await fetch(url, { headers: { 'X-Fantasy-Filter': JSON.stringify(filter) } });
  if (r.status === 404) { cacheSet(key, null); return null; } // 這一季 ESPN 還沒開
  if (!r.ok) throw new Error(`ESPN 讀取失敗（${r.status}）`);
  const j = await r.json();
  const rows = (j.players ?? []).map((x) => x.player).filter(Boolean).map((p) => ({
    name: p.fullName,
    pitcher: [1, 11].includes(p.defaultPositionId),
    rank: p.draftRanksByRankType?.ROTO?.rank ?? p.draftRanksByRankType?.STANDARD?.rank ?? null,
    adp: p.ownership?.averageDraftPosition ?? null,
  }));
  const realAdp = new Set(rows.map((x) => x.adp)).size > 20; // 全部一樣（例如都是 260）＝還沒有真的 ADP
  const out = rows.map((x) => ({ ...x, adp: realAdp ? x.adp : null }));
  cacheSet(key, out);
  return out;
}

// FantasyPros 官方 API（使用者自己的金鑰，只存在手機；個人非商業使用；免費版每天 50 次、回傳可能截短）
// 每天抓一次：專家共識排名（DRAFT）＋綜合 ADP（ADP），共 2 次呼叫
const FP = 'https://api.fantasypros.com/public/v2/json';
export const fpKey = {
  get: () => { try { return localStorage.getItem('fp.key') || ''; } catch { return ''; } },
  set: (k) => { try { k ? localStorage.setItem('fp.key', k.trim()) : localStorage.removeItem('fp.key'); localStorage.removeItem('adp.fp'); } catch { /* 略 */ } },
};
async function fpGet(path, key) {
  const r = await fetch(`${FP}${path}`, { headers: { 'x-api-key': key } });
  if (r.status === 403) throw new Error('FantasyPros 金鑰無效或還沒啟用');
  if (r.status === 429) throw new Error('FantasyPros 今天的次數用完了');
  if (!r.ok) throw new Error(`FantasyPros 讀取失敗（${r.status}）`);
  return r.json();
}
export async function fantasypros(season, { force = false } = {}) {
  const key = fpKey.get();
  if (!key) return null;
  const c = force ? null : cacheGet('adp.fp', DAY);
  if (c) return c;
  const rows = (j) => (j.players ?? []).map((p) => ({ name: p.player_name, pos: p.player_positions ?? '', rank: Number(p.rank_ecr) || null, owned: p.player_owned_yahoo ?? null }));
  const [draft, adp] = await Promise.all([
    fpGet(`/mlb/${season}/consensus-rankings?type=DRAFT&position=ALL`, key),
    fpGet(`/mlb/${season}/consensus-rankings?type=ADP&position=ALL`, key).catch(() => ({ players: [] })),
  ]);
  const out = { season, ecr: rows(draft), adp: rows(adp) };
  cacheSet('adp.fp', out);
  return out;
}

// Yahoo 全站 ADP
export async function yahoo() {
  const c = cacheGet('adp.yahoo', DAY);
  if (c) return c;
  const rows = await Y.draftAnalysis();
  const out = rows.length ? rows : null;
  cacheSet('adp.yahoo', out);
  return out;
}

// 你們聯盟最近兩季的真實選秀順位（近的一季權重 2、前一季 1）
export async function league() {
  const c = cacheGet('adp.league', 7 * DAY);
  if (c) return c;
  const ls = await Y.leagues();
  const latest = Math.max(...ls.map((l) => l.season));
  const lg = ls.find((l) => l.season === latest);
  const hist = await Y.leagueHistory(lg, 2);
  const acc = new Map();
  hist.forEach((h, i) => {
    const w = i === 0 ? 2 : 1;
    for (const pk of h.picks) {
      const a = acc.get(pk.name) ?? { name: pk.name, sum: 0, w: 0, last: null, lastSeason: null };
      a.sum += pk.overall * w; a.w += w;
      if (i === 0) { a.last = pk.overall; a.lastSeason = h.season; }
      acc.set(pk.name, a);
    }
  });
  const out = { seasons: hist.map((h) => h.season), rows: [...acc.values()].map((a) => ({ name: a.name, adp: a.sum / a.w, last: a.last, lastSeason: a.lastSeason })) };
  cacheSet('adp.league', out);
  return out;
}

// 對到選秀表球員：回傳 Map(`${side}${id}` → { Y, E, Ead, L, Llast })
export function attach(players, { yahoo: ya, espn: es, league: lg, fp } = {}) {
  const m = new Map();
  const put = (p, k, v) => { if (!p) return; const key = `${p.side}${p.id}`; m.set(key, { ...(m.get(key) ?? {}), [k]: v }); };
  for (const r of ya ?? []) put(matchPlayer(r.name, players), 'Y', r.adp);
  for (const r of es ?? []) {
    const p = matchPlayer(`${r.name}${r.pitcher ? ' (Pitcher)' : ' (Batter)'}`, players) ?? matchPlayer(r.name, players);
    if (r.rank) put(p, 'E', r.rank);
    if (r.adp) put(p, 'Ead', r.adp);
  }
  const fpSide = (r) => (/\b(SP|RP|P)\b/.test(r.pos) && !/\b(C|1B|2B|3B|SS|OF|DH|LF|CF|RF)\b/.test(r.pos) ? ' (Pitcher)' : '');
  for (const r of fp?.ecr ?? []) if (r.rank) put(matchPlayer(`${r.name}${fpSide(r)}`, players) ?? matchPlayer(r.name, players), 'X', r.rank);
  for (const r of fp?.adp ?? []) if (r.rank) put(matchPlayer(`${r.name}${fpSide(r)}`, players) ?? matchPlayer(r.name, players), 'F', r.rank);
  for (const r of lg?.rows ?? []) { const p = matchPlayer(r.name, players); put(p, 'L', r.adp); if (r.last) put(p, 'Llast', r.last); }
  return m;
}

// 市場排名用哪一家：Yahoo ADP（你們在 Yahoo 打）→ ESPN ADP → ESPN 專家排名；至少要對到 120 人才採用
export function marketSource(adp) {
  const n = (k) => [...adp.values()].filter((v) => v[k] != null).length;
  for (const [k, label] of [['Y', 'Yahoo ADP'], ['F', 'FantasyPros 綜合 ADP'], ['Ead', 'ESPN ADP'], ['X', 'FantasyPros 專家共識'], ['E', 'ESPN 排名']]) if (n(k) >= 120) return { key: k, label };
  return null;
}

// 給選秀表一行用的文字：Y 45｜E 50｜聯 38
export function adpLine(v) {
  if (!v) return '';
  const r = (x) => Math.round(x);
  return [v.Y != null && `Yahoo ${r(v.Y)}`, v.F != null && `FP ADP ${r(v.F)}`, v.Ead != null ? `ESPN ${r(v.Ead)}` : v.E != null && `ESPN 排名 ${v.E}`, v.X != null && `專家 ${r(v.X)}`, v.Llast != null && `聯盟去年第 ${v.Llast}`].filter(Boolean).join('｜');
}

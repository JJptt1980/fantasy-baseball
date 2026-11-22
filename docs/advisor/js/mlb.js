// MLB 官方公開數據（statsapi.mlb.com，允許跨網域、免登入）
const BASE = 'https://statsapi.mlb.com/api/v1/stats';
const HIT_FIELDS = 'age,gamesPlayed,atBats,plateAppearances,runs,hits,homeRuns,rbi,stolenBases,baseOnBalls,strikeOuts,ops';
const PIT_FIELDS = 'age,gamesPlayed,gamesStarted,inningsPitched,wins,losses,saves,holds,baseOnBalls,strikeOuts,earnedRuns,hits';
const CACHE_VER = 'v1';

function url(group, extra) {
  const fields = `stats,splits,player,id,fullName,position,abbreviation,team,name,stat,${group === 'hitting' ? HIT_FIELDS : PIT_FIELDS}`;
  return `${BASE}?sportId=1&limit=3000&playerPool=ALL&group=${group}&${extra}&fields=${fields}`;
}

export function ipToFloat(s) {
  const [whole, frac] = String(s ?? '0').split('.');
  return Number(whole || 0) + (frac ? Number(frac) / 3 : 0);
}

// 季中轉隊會有多筆 → 合併
function merge(splits) {
  const out = new Map();
  for (const s of splits ?? []) {
    const id = s.player.id;
    const st = { ...s.stat };
    if ('inningsPitched' in st) st._ip = ipToFloat(st.inningsPitched);
    const prev = out.get(id);
    if (prev) {
      for (const [k, v] of Object.entries(st)) {
        if (typeof v === 'number' && k !== 'age') prev.stat[k] = (prev.stat[k] ?? 0) + v;
      }
      continue;
    }
    out.set(id, { id, name: s.player.fullName, pos: s.position?.abbreviation ?? '', team: s.team?.name ?? '', stat: st });
  }
  return out;
}

function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && v.ver === CACHE_VER ? v : null;
  } catch {
    return null;
  }
}
function cacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ver: CACHE_VER, at: Date.now(), data }));
  } catch { /* 空間不足就不快取 */ }
}

async function getJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`MLB 數據讀取失敗（${r.status}）`);
  return r.json();
}

// 抓的頻率：一天最多一次（同一天內一律用手機裡存好的，不重抓）
const sameDay = (t) => t && new Date(t).toDateString() === new Date().toDateString();

// 最近一次真的去 MLB 抓整季數據的時間（給畫面顯示用）
export function lastFetched(season) {
  return cacheGet(`mlb.season.${season}`)?.at ?? null;
}

// 整季數據：已結束的球季抓一次就永久存著；進行中的球季一天最多抓一次
export async function seasonStats(season) {
  const key = `mlb.season.${season}`;
  const c = cacheGet(key);
  const finished = season < new Date().getFullYear() || new Date().getMonth() >= 10;
  if (c && (finished || sameDay(c.at))) return c.data;
  const [h, p] = await Promise.all([
    getJson(url('hitting', `stats=season&season=${season}`)),
    getJson(url('pitching', `stats=season&season=${season}`)),
  ]);
  const data = { hit: h.stats?.[0]?.splits ?? [], pit: p.stats?.[0]?.splits ?? [] };
  cacheSet(key, data);
  return data;
}

// 一段日期內的數據（近況用），YYYY-MM-DD
export async function rangeStats(start, end) {
  const key = `mlb.range.${start}.${end}`;
  const c = cacheGet(key);
  if (c && sameDay(c.at)) return c.data;
  const extra = `stats=byDateRange&startDate=${start}&endDate=${end}&season=${start.slice(0, 4)}`;
  const [h, p] = await Promise.all([getJson(url('hitting', extra)), getJson(url('pitching', extra))]);
  const data = { hit: h.stats?.[0]?.splits ?? [], pit: p.stats?.[0]?.splits ?? [] };
  cacheSet(key, data);
  return data;
}

export function toMaps(data) {
  return { hit: merge(data.hit), pit: merge(data.pit) };
}

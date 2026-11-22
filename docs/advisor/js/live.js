// StatTracker：本週對戰即時追蹤（即時模式 = 今天；重播模式 = 2026 某一天，同一套計算）
// 本週至今（MLB 逐日數據，只算先發格子的球員）＋今天比賽（即時比分、boxscore）＋週末預估（剩餘場數 × 最近 14 天）
import { CATS, normName, teamLine } from './pickup.js';
import { ipToFloat } from './mlb.js';

const API = 'https://statsapi.mlb.com/api/v1';
const DAY = 86400e3;
export const addDays = (s, n) => new Date(Date.parse(`${s}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const LOWER = new Set(['B:K', 'P:L', 'P:BB', 'P:ERA', 'P:WHIP']);
// 一週大約的「一個單位」，用來換算勝率
const UNIT = { 'B:R': 6, 'B:H': 9, 'B:HR': 2.5, 'B:RBI': 6, 'B:SB': 1.5, 'B:BB': 4, 'B:K': 8, 'B:AVG': 0.015, 'B:OPS': 0.04,
  'P:W': 1, 'P:L': 1, 'P:SV': 1, 'P:BB': 3, 'P:K': 8, 'P:HLD': 1, 'P:ERA': 0.9, 'P:WHIP': 0.13, 'P:QS': 1 };

const cache = new Map();
async function getJson(url, ttlMs = 0) {
  const c = cache.get(url);
  if (c && (ttlMs === Infinity || Date.now() - c.at < ttlMs)) return c.data;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MLB 數據讀取失敗（${r.status}）`);
  const data = await r.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

// ── MLB 資料 ──

const HIT = 'gamesPlayed,atBats,plateAppearances,hits,runs,homeRuns,rbi,stolenBases,baseOnBalls,strikeOuts,ops';
const PIT = 'gamesPlayed,gamesStarted,inningsPitched,wins,losses,saves,holds,baseOnBalls,strikeOuts,earnedRuns,hits';
async function range(start, end, past) {
  if (daysBetween(start, end) < 0) return { hit: new Map(), pit: new Map() };
  const q = (g, f) => `${API}/stats?stats=byDateRange&group=${g}&startDate=${start}&endDate=${end}&season=${start.slice(0, 4)}&sportId=1&limit=3000&playerPool=ALL&fields=stats,splits,player,id,stat,${f}`;
  const ttl = past ? Infinity : 5 * 60e3;
  const [h, p] = await Promise.all([getJson(q('hitting', HIT), ttl), getJson(q('pitching', PIT), ttl)]);
  const toMap = (j) => {
    const m = new Map();
    for (const s of j.stats?.[0]?.splits ?? []) {
      const prev = m.get(s.player.id);
      if (!prev) { m.set(s.player.id, { ...s.stat }); continue; }
      for (const [k, v] of Object.entries(s.stat)) if (typeof v === 'number') prev[k] = (prev[k] ?? 0) + v;
    }
    return m;
  };
  return { hit: toMap(h), pit: toMap(p) };
}

async function scheduleRange(start, end, past) {
  if (daysBetween(start, end) < 0) return [];
  const j = await getJson(`${API}/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=linescore`, past ? Infinity : 60e3);
  return (j.dates ?? []).flatMap((d) => d.games.map((g) => ({ ...g, day: d.date })));
}

const statToLine = (side, st) => {
  if (!st) return null;
  if (side === 'B') {
    const AB = st.atBats ?? 0;
    const PA = st.plateAppearances ?? AB;
    let OPS = Number(st.ops) || 0;
    if (!st.ops && PA) {
      const obpDen = AB + (st.baseOnBalls ?? 0) + (st.hitByPitch ?? 0) + (st.sacFlies ?? 0);
      const obp = obpDen ? ((st.hits ?? 0) + (st.baseOnBalls ?? 0) + (st.hitByPitch ?? 0)) / obpDen : 0;
      OPS = obp + (AB ? (st.totalBases ?? 0) / AB : 0);
    }
    return { side, AB, PA, H: st.hits ?? 0, R: st.runs ?? 0, HR: st.homeRuns ?? 0, RBI: st.rbi ?? 0, SB: st.stolenBases ?? 0, BB: st.baseOnBalls ?? 0, K: st.strikeOuts ?? 0, OPS };
  }
  const IP = ipToFloat(st.inningsPitched);
  const ER = st.earnedRuns ?? 0;
  const GS = st.gamesStarted ?? 0;
  // 單場先發：6 局以上且自責 ≤3 = QS；多場合計：估計
  const QS = GS === 1 && (st.gamesPlayed ?? 1) === 1 ? (IP >= 6 && ER <= 3 ? 1 : 0)
    : GS ? GS * Math.min(1, Math.max(0, (IP / GS - 4.3) / 1.9)) * Math.min(1, Math.max(0.15, (5.4 - (IP ? (ER * 9) / IP : 9)) / 2.6)) : 0;
  return { side, IP, W: st.wins ?? 0, L: st.losses ?? 0, SV: st.saves ?? 0, HLD: st.holds ?? 0, BB: st.baseOnBalls ?? 0, K: st.strikeOuts ?? 0, ER, WH: (st.baseOnBalls ?? 0) + (st.hits ?? 0), QS };
};

const scaleLine = (l, k) => {
  const o = { side: l.side };
  for (const [key, v] of Object.entries(l)) if (typeof v === 'number' && key !== 'OPS') o[key] = v * k;
  if (l.side === 'B') o.OPS = l.OPS;
  return o;
};

// ── 陣容對應到 MLB 球員 ──
// roster：[{ name, side, slot }]；seasonMaps：toMaps(seasonStats(年))
// 同名球員（例如兩個 Max Muncy）：看他的球隊有沒有出現在 Yahoo 當天的比賽連結；都沒有就選出賽多的
export function resolveRoster(roster, seasonMaps) {
  const idx = new Map();
  const add = (key, v) => { if (!idx.has(key)) idx.set(key, []); idx.get(key).push(v); };
  for (const h of seasonMaps.hit.values()) if (h.pos !== 'P') add(`B:${normName(h.name)}`, { id: h.id, team: h.team, n: h.stat.plateAppearances ?? 0 });
  for (const p of seasonMaps.pit.values()) add(`P:${normName(p.name)}`, { id: p.id, team: p.team, n: p.stat._ip ?? 0 });
  const slug = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  return roster.map((r) => {
    const cands = idx.get(`${r.side}:${normName(r.name)}`) ?? [];
    const m = cands.length > 1
      ? (r.game && cands.find((c) => c.team && r.game.includes(slug(c.team)))) || [...cands].sort((a, b) => b.n - a.n)[0]
      : cands[0];
    return { ...r, id: m?.id ?? null, team: m?.team ?? null, active: !['BN', 'IL', 'IL+', 'NA'].includes(r.slot) };
  });
}

// ── 主計算 ──
// now：YYYY-MM-DD（今天或重播日）；week：{ start, end }
// rosterAt(date) → { me, opp }（resolveRoster 結果）：Yahoo 逐日計分，每天只算當天在先發格子的球員
export async function track({ now, week, rosterAt, past = false }) {
  const yesterday = addDays(now, -1);
  const recentStart = addDays(now, -14);
  const { me, opp } = await rosterAt(now);
  // 本週至今：逐日（當天陣容 × 當天成績）
  const days = [];
  for (let d = week.start; d < now; d = addDays(d, 1)) days.push(d);
  const daily = await Promise.all(days.map(async (d) => {
    const [stats, r] = await Promise.all([range(d, d, true), rosterAt(d)]);
    const lines = (roster) => roster.filter((p) => p.active && p.id).map((p) => statToLine(p.side, stats[p.side === 'B' ? 'hit' : 'pit'].get(p.id))).filter(Boolean);
    return { me: lines(r.me), opp: lines(r.opp) };
  }));
  const wtdLines = { me: daily.flatMap((x) => x.me), opp: daily.flatMap((x) => x.opp) };
  const [recent, today, rest, recentGames] = await Promise.all([
    range(recentStart, yesterday, true),
    scheduleRange(now, now, past),
    scheduleRange(addDays(now, 1), week.end, past || true),
    scheduleRange(recentStart, yesterday, true),
  ]);

  // 各隊比賽數（近 14 天、本週剩餘）
  const count = (games) => {
    const m = new Map();
    for (const g of games) {
      if (g.status?.detailedState === 'Postponed') continue;
      for (const side of ['home', 'away']) m.set(g.teams[side].team.name, (m.get(g.teams[side].team.name) ?? 0) + 1);
    }
    return m;
  };
  const recentCount = count(recentGames);
  const restCount = count(rest);

  // 今天：每個 MLB 隊伍的比賽 → boxscore（只抓有我方或對手球員的場次）
  const teamsNeeded = new Set([...me, ...opp].filter((p) => p.active && p.team).map((p) => p.team));
  const gameByTeam = new Map();
  for (const g of today) for (const side of ['home', 'away']) gameByTeam.set(g.teams[side].team.name, g);
  const boxes = new Map();
  await Promise.all([...new Set([...teamsNeeded].map((t) => gameByTeam.get(t)).filter(Boolean))].map(async (g) => {
    const state = g.status?.abstractGameState;
    if (state === 'Preview') return;
    const ttl = state === 'Final' ? Infinity : 30e3;
    boxes.set(g.gamePk, await getJson(`${API}/game/${g.gamePk}/boxscore`, ttl));
  }));

  const playerToday = (p) => {
    const g = gameByTeam.get(p.team);
    if (!g) return { game: null };
    const box = boxes.get(g.gamePk);
    let st = null;
    if (box) {
      for (const side of ['home', 'away']) {
        const pl = box.teams[side].players[`ID${p.id}`];
        if (pl) st = p.side === 'B' ? pl.stats?.batting : pl.stats?.pitching;
      }
    }
    const played = st && Object.keys(st).length && (p.side === 'B' ? (st.plateAppearances ?? 0) > 0 : ipToFloat(st.inningsPitched) > 0 || (st.battersFaced ?? 0) > 0);
    return { game: g, line: played ? statToLine(p.side, st) : null, summary: played ? st.summary : null };
  };

  const build = (roster, wtdList) => {
    const players = roster.map((p) => {
      if (!p.id) return { ...p, today: { game: null }, rem: null };
      const m = p.side === 'B' ? 'hit' : 'pit';
      const td = playerToday(p);
      // 剩餘：最近 14 天「每場球隊比賽」的平均 × 本週剩餘場數（今天還沒打完的場次算半場）
      const rec = statToLine(p.side, recent[m].get(p.id));
      const tg = recentCount.get(p.team) || 13;
      const left = (restCount.get(p.team) ?? 0) + (td.game && td.game.status?.abstractGameState !== 'Final' && !td.line ? 1 : 0);
      const rem = rec && left ? scaleLine(rec, left / tg) : null;
      return { ...p, today: td, rem, left };
    });
    const active = players.filter((p) => p.active);
    const todayLines = active.map((p) => p.today.line).filter(Boolean);
    const cur = teamLine([...wtdList, ...todayLines]);
    const proj = teamLine([...wtdList, ...todayLines, ...active.map((p) => p.rem).filter(Boolean)]);
    for (const t of [cur, proj]) if (!t.IP) { t['P:ERA'] = NaN; t['P:WHIP'] = NaN; }
    return { players, cur, proj };
  };

  const A = build(me, wtdLines.me);
  const B = build(opp, wtdLines.opp);
  const allDone = today.every((g) => ['Final'].includes(g.status?.abstractGameState) || g.status?.detailedState === 'Postponed');
  // 週末最後一天且比賽都打完 → 勝負已定
  const daysLeft = Math.max(0, daysBetween(now, week.end)) + (now >= week.end && allDone ? 0.002 : 0.5);
  const frac = Math.min(1, daysLeft / 7);

  const cats = CATS.map((c) => {
    const verdict = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 'na';
      if (Math.abs(x - y) < 1e-9) return 'tie';
      return (x > y) !== LOWER.has(c) ? 'win' : 'loss';
    };
    const m = A.proj[c] - B.proj[c];
    const signed = LOWER.has(c) ? -m : m;
    const prob = Number.isFinite(signed) ? 1 / (1 + Math.exp(-1.7 * signed / (UNIT[c] * Math.sqrt(frac) + 1e-6))) : 0.5;
    return { cat: c, me: A.cur[c], opp: B.cur[c], now: verdict(A.cur[c], B.cur[c]), meProj: A.proj[c], oppProj: B.proj[c], prob };
  });
  const tally = (key) => cats.reduce((a, x) => { a[x[key]] = (a[x[key]] ?? 0) + 1; return a; }, {});
  const projTally = cats.reduce((a, x) => { a[x.prob > 0.5 ? 'win' : x.prob < 0.5 ? 'loss' : 'tie']++; return a; }, { win: 0, loss: 0, tie: 0 });
  return { cats, nowTally: tally('now'), projTally, me: A.players, opp: B.players, daysLeft: Math.round(daysLeft - 0.5), live: today.some((g) => g.status?.abstractGameState === 'Live') };
}

// 比賽狀態文字
export function gameStatus(g, now) {
  if (!g) return '今天沒比賽';
  const s = g.status ?? {};
  if (s.detailedState === 'Postponed') return '延賽';
  if (s.abstractGameState === 'Final') return '比賽結束';
  if (s.abstractGameState === 'Live') {
    const ls = g.linescore ?? {};
    return `${ls.isTopInning ? '上' : '下'}${ls.currentInning ?? ''}局`;
  }
  const t = new Date(g.gameDate);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 開打`;
}

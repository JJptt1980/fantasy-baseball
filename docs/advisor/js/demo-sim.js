// Demo：虛擬跑一次 2027（移植自 sim/sim.py）
// 12 隊蛇形選秀 25 輪 → 23 週 H2H 18 類別（每週撿人）→ 6 隊季後賽（第 24–26 週）
import { CATS, CAT_LABEL, teamLine, scale, margin } from './pickup.js';
import { normName } from './pickup.js';
import { contributions } from './rank.js';

const LOWER = new Set(['B:K', 'P:L', 'P:BB', 'P:ERA', 'P:WHIP']);
const BAT_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'OF', 'OF', 'OF', 'OF', 'Util'];
const PIT_SLOTS = ['SP', 'SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'P', 'P'];
const SLOT_ORDER = { C: 0, SS: 1, '2B': 2, '3B': 3, '1B': 4, SP: 0, RP: 1, OF: 5, IF: 6, Util: 7, P: 8 };
export const TEAMS = 12;
export const ROUNDS = 25;
const REG_WEEKS = 23;
const WEEKS = 26;

// ── 亂數（可重現） ──
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.gauss = (m, s) => m + s * Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  r.lognorm = (s) => Math.exp(r.gauss(0, s));
  r.poisson = (lam) => {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(r.gauss(lam, Math.sqrt(lam))));
    const L = Math.exp(-lam);
    let k = 0;
    let p = 1;
    for (;;) { p *= r(); if (p <= L) return k; k++; }
  };
  r.binom = (n, p) => {
    if (n < 60) { let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; }
    return Math.max(0, Math.round(r.gauss(n * p, Math.sqrt(n * p * (1 - p)))));
  };
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return r;
}

// ── 守位 ──
const posGroup = (p) => (p.side === 'P' ? p.pos : p.pos === 'C' ? 'C' : ['1B', '2B', '3B', 'SS'].includes(p.pos) ? 'IF' : p.pos === 'DH' ? 'DH' : 'OF');
function fits(p, slot) {
  if (slot === 'Util') return p.side === 'B';
  if (slot === 'P') return p.side === 'P';
  if (slot === 'IF') return ['1B', '2B', '3B', 'SS'].includes(p.pos);
  if (slot === 'OF') return p.pos === 'OF';
  return p.pos === slot;
}
function assign(team, side) {
  const slots = side === 'B' ? BAT_SLOTS : PIT_SLOTS;
  const order = slots.map((_, i) => i).sort((a, b) => SLOT_ORDER[slots[a]] - SLOT_ORDER[slots[b]]);
  const filled = new Array(slots.length).fill(null);
  const used = new Set();
  const roster = team.filter((p) => p.side === side).sort((a, b) => b.value - a.value);
  for (const i of order) {
    const p = roster.find((x) => !used.has(x.id) && fits(x, slots[i]));
    if (p) { filled[i] = p; used.add(p.id); }
  }
  return { slots, filled };
}
export const lineup = (team) => [...assign(team, 'B').filled, ...assign(team, 'P').filled].filter(Boolean);

// ── 對手選秀習慣（從真實選秀結果） ──
const BUCKETS = [[1, 5], [6, 12], [13, 25]];
const bucketOf = (round) => BUCKETS.findIndex(([a, b]) => round >= a && round <= b);

// history：leagueHistory() 結果 [{ season, picks, teams }]；players：選秀表（board）；myManagerId：自己
// 依「經理人」跨年累積（隊名每年會換），越近的年份權重越高（每往前一年 ×0.85）
export function buildProfiles(history, players, myManagerId) {
  if (!history?.length) return [];
  const latest = Math.max(...history.map((h) => h.season));
  const byName = new Map(players.map((p) => [normName(p.name), p]));
  const mgrs = new Map();
  const get = (id) => {
    if (!mgrs.has(id)) mgrs.set(id, { id, n: 0, share: BUCKETS.map(() => ({})), counts: BUCKETS.map(() => 0), reach: [], ages: [], rp: {}, moves: [], seasons: new Set(), mlbTeams: {} });
    return mgrs.get(id);
  };
  const league = BUCKETS.map(() => ({}));
  const lgTot = BUCKETS.map(() => 0);
  for (const h of history) {
    const wt = 0.85 ** (latest - h.season);
    const teamToMgr = new Map(h.teams.map((t) => [t.team, t.managerId]));
    for (const t of h.teams) { const m = get(t.managerId); m.moves.push(t.moves); m.seasons.add(h.season); }
    for (const pk of h.picks) {
      const id = teamToMgr.get(pk.team);
      const p = byName.get(normName(pk.name));
      if (!id || !p) continue;
      const m = get(id);
      const g = posGroup(p);
      const b = bucketOf(pk.round);
      m.n++;
      m.share[b][g] = (m.share[b][g] ?? 0) + wt;
      m.counts[b] += wt;
      league[b][g] = (league[b][g] ?? 0) + wt;
      lgTot[b] += wt;
      if (p.age) m.ages.push(p.age - (latest - h.season));
      if (p.pos === 'RP') m.rp[h.season] = Math.min(m.rp[h.season] ?? 99, pk.round);
      if (h.season === latest) { m.reach.push(p.marketRank - pk.overall); m.mlbTeams[p.team] = (m.mlbTeams[p.team] ?? 0) + 1; }
    }
  }
  const allReach = [...mgrs.values()].flatMap((m) => m.reach);
  const lgReach = allReach.reduce((a, b) => a + b, 0) / Math.max(1, allReach.length);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const cur = history.find((h) => h.season === latest);
  const profiles = [];
  for (const t of cur?.teams ?? []) {
    if (t.managerId === myManagerId) continue;
    const m = mgrs.get(t.managerId);
    if (!m || m.n < 8) continue;
    const pref = m.share.map((sh, b) => {
      const o = {};
      for (const g of ['C', 'IF', 'OF', 'DH', 'SP', 'RP']) {
        const lg = ((league[b][g] ?? 0) + 0.5) / (lgTot[b] + 3);
        const mine = ((sh[g] ?? 0) + 10 * lg) / (m.counts[b] + 10);
        o[g] = Math.min(2.5, Math.max(0.4, mine / lg));
      }
      return o;
    });
    const reach = avg(m.reach) - lgReach;
    const firstRP = median(Object.values(m.rp));
    const fav = Object.entries(m.mlbTeams).sort((a, b) => b[1] - a[1])[0];
    const favTeam = fav && fav[1] >= 4 ? fav[0] : null;
    const movesPerSeason = avg(m.moves);
    profiles.push({
      name: t.team, managerId: t.managerId, years: m.seasons.size, pref, reach, age: avg(m.ages), firstRP, favTeam,
      movesPerWeek: movesPerSeason / 26,
      summary: `${m.seasons.size} 年資料｜` + describe(pref, reach, avg(m.ages), firstRP, favTeam) + `｜每季換人約 ${Math.round(movesPerSeason)} 次`,
    });
  }
  return profiles;
}

function describe(pref, reach, age, firstRP, favTeam) {
  const g = { SP: '先發', RP: '後援', C: '捕手', IF: '內野', OF: '外野', DH: 'DH' };
  const out = [];
  const early = Object.entries(pref[0]).sort((a, b) => b[1] - a[1])[0];
  if (early[1] >= 1.5) out.push(`前 5 輪偏好${g[early[0]]}`);
  const mid = Object.entries(pref[1]).sort((a, b) => b[1] - a[1])[0];
  if (mid[1] >= 1.5) out.push(`6～12 輪偏好${g[mid[0]]}`);
  if (firstRP && firstRP <= 8) out.push(`通常第 ${firstRP} 輪就拿後援`);
  if (reach > 8) out.push('比別人更愛提早搶人');
  else if (reach < -8) out.push('撿便宜型');
  if (age && age <= 26.5) out.push('偏好年輕');
  else if (age >= 30) out.push('偏好老將');
  if (favTeam) out.push(`愛選 ${favTeam}`);
  return out.join('、') || '照市場排名選';
}

// ── 選秀 ──
export function draft(players, { mySlot, profiles, r }) {
  const avail = new Map(players.map((p) => [p.id, p]));
  const teams = Array.from({ length: TEAMS }, () => []);
  const ai = [];
  const pool = r.shuffle([...(profiles ?? [])]);
  for (let t = 0; t < TEAMS; t++) if (t !== mySlot) ai[t] = pool.pop() ?? null;
  const log = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const order = round % 2 ? [...Array(TEAMS).keys()] : [...Array(TEAMS).keys()].reverse();
    for (const t of order) {
      const team = teams[t];
      const open = ['B', 'P'].flatMap((s) => { const a = assign(team, s); return a.slots.filter((_, i) => !a.filled[i]); });
      const left = ROUNDS - team.length;
      let cands = [...avail.values()];
      if (left <= open.length) cands = cands.filter((p) => open.some((sl) => fits(p, sl)));
      if (!cands.length) cands = [...avail.values()];
      let pick;
      if (t === mySlot) {
        pick = cands.reduce((a, b) => (b.rank < a.rank ? b : a));
      } else {
        const prof = ai[t];
        const b = bucketOf(round);
        const score = (p) => {
          let s = p.marketRank * r.lognorm(0.25);
          if (prof) {
            s /= prof.pref[b][posGroup(p)];
            if (prof.favTeam && p.team === prof.favTeam) s /= 1.3;
            if (prof.age && p.age) s *= 1 + (p.age - prof.age) * 0.01;
          }
          return s;
        };
        let best = Infinity;
        for (const c of cands) {
          const v = score(c);
          if (v < best) { best = v; pick = c; }
        }
      }
      team.push(pick);
      avail.delete(pick.id);
      log.push({ round, team: t, player: pick });
    }
  }
  return { teams, ai, log, freeAgents: avail };
}

// ── 一週數據 ──
const FRAC = 1 / WEEKS;
function weekStats(lu, r) {
  const t = {};
  for (const c of CATS) t[c] = 0;
  let ab = 0; let h = 0; let opsW = 0; let pa = 0; let ip = 0; let er = 0; let wh = 0;
  for (const p of lu) {
    if (p.side === 'B') {
      for (const k of ['R', 'HR', 'RBI', 'SB', 'BB', 'K']) t[`B:${k}`] += r.poisson(p[k] * FRAC);
      const a = Math.max(0, Math.round(r.gauss(p.AB * FRAC, Math.sqrt(p.AB * FRAC) * 0.5)));
      const hits = r.binom(a, p.AB ? p.H / p.AB : 0);
      ab += a; h += hits;
      const w = a + p.BB * FRAC;
      pa += w;
      opsW += Math.max(0, r.gauss(p.OPS, 0.9 / Math.sqrt(Math.max(w, 1)))) * w;
    } else {
      const i = Math.max(0, r.gauss(p.IP * FRAC, Math.sqrt(p.IP * FRAC) * 0.6));
      const ratio = p.IP ? i / (p.IP * FRAC) : 0;
      ip += i;
      er += r.poisson(p.ER * FRAC * ratio);
      wh += r.poisson(p.WH * FRAC * ratio);
      for (const k of ['W', 'L', 'SV', 'BB', 'K', 'HLD', 'QS']) {
        t[`P:${k}`] += r.poisson(p[k] * FRAC * (['BB', 'K', 'QS', 'W', 'L'].includes(k) ? ratio : 1));
      }
    }
  }
  t['B:H'] = h;
  t['B:AVG'] = ab ? h / ab : 0;
  t['B:OPS'] = pa ? opsW / pa : 0;
  t['P:ERA'] = ip ? (er * 9) / ip : 99;
  t['P:WHIP'] = ip ? wh / ip : 99;
  return t;
}

function match(a, b) {
  let w = 0; let l = 0; let t = 0;
  const cats = {};
  for (const c of CATS) {
    if (Math.abs(a[c] - b[c]) < 1e-9) { t++; cats[c] = 'tie'; } else if ((a[c] > b[c]) !== LOWER.has(c)) { w++; cats[c] = 'win'; } else { l++; cats[c] = 'loss'; }
  }
  return { w, l, t, cats };
}

function schedule(r) {
  let ids = r.shuffle([...Array(TEAMS).keys()]);
  const rounds = [];
  for (let k = 0; k < TEAMS - 1; k++) {
    rounds.push(Array.from({ length: TEAMS / 2 }, (_, i) => [ids[i], ids[TEAMS - 1 - i]]));
    ids = [ids[0], ids[TEAMS - 1], ...ids.slice(1, -1)];
  }
  return [...rounds, ...rounds, ...rounds].slice(0, REG_WEEKS);
}

// ── 真實逐週資料（scripts/build-weekly.mjs 產生） ──
// weekly.players[`B${id}`].w[週] = [AB, PA, H, R, HR, RBI, SB, BB, K, OPS×1000] 或 0
// weekly.players[`P${id}`].w[週] = [outs, W, L, SV, HLD, BB, K, ER, H, GS] 或 0
function rowToLine(side, row) {
  if (side === 'B') {
    const [AB, PA, H, R, HR, RBI, SB, BB, K, ops] = row || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return { side, AB, PA, H, R, HR, RBI, SB, BB, K, OPS: ops / 1000, AVG: AB ? H / AB : 0 };
  }
  const [outs, W, L, SV, HLD, BB, K, ER, Hh, GS] = row || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const IP = outs / 3;
  const era = IP ? (ER * 9) / IP : 9;
  const QS = GS ? GS * Math.min(1, Math.max(0, (IP / GS - 4.3) / 1.9)) * Math.min(1, Math.max(0.15, (5.4 - era) / 2.6)) : 0;
  return { side, IP, W, L, SV, HLD, BB, K, ER, WH: BB + Hh, QS };
}

function avgLines(side, lines) {
  const n = lines.length || 1;
  const keys = side === 'B' ? ['AB', 'PA', 'H', 'R', 'HR', 'RBI', 'SB', 'BB', 'K'] : ['IP', 'W', 'L', 'SV', 'HLD', 'BB', 'K', 'ER', 'WH', 'QS'];
  const o = { side };
  for (const k of keys) o[k] = lines.reduce((a, l) => a + (l[k] ?? 0), 0) / n;
  if (side === 'B') {
    const pa = lines.reduce((a, l) => a + l.PA, 0);
    o.OPS = pa ? lines.reduce((a, l) => a + l.OPS * l.PA, 0) / pa : 0;
    o.AVG = o.AB ? o.H / o.AB : 0;
  }
  return o;
}

function weighted(side, parts) {
  const tot = parts.reduce((a, [, k]) => a + k, 0);
  const keys = side === 'B' ? ['AB', 'PA', 'H', 'R', 'HR', 'RBI', 'SB', 'BB', 'K'] : ['IP', 'W', 'L', 'SV', 'HLD', 'BB', 'K', 'ER', 'WH', 'QS'];
  const o = { side };
  for (const key of keys) o[key] = parts.reduce((a, [l, k]) => a + (l[key] ?? 0) * k, 0) / tot;
  if (side === 'B') {
    const pa = parts.reduce((a, [l, k]) => a + (l.PA ?? 0) * k, 0);
    o.OPS = pa ? parts.reduce((a, [l, k]) => a + (l.OPS ?? 0) * (l.PA ?? 0) * k, 0) / pa : 0;
    o.AVG = o.AB ? o.H / o.AB : 0;
  }
  return o;
}

const seasonWeekly = (p) => {
  const q = { ...p };
  for (const k of ['AB', 'PA', 'R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K', 'IP', 'W', 'L', 'SV', 'HLD', 'ER', 'WH', 'QS']) if (k in q) q[k] = (q[k] ?? 0) * FRAC;
  return q;
};

// 「近況」：最近 2 週與本季至今各半；開季第 1 週用季前預期（整季平均）
function makeWorld(players, weekly) {
  const rows = (p) => weekly?.players?.[`${p.side}${p.id}`]?.w;
  const actual = (p, w) => rowToLine(p.side, rows(p)?.[w]);
  const formCache = new Map();
  const form = (p, w) => {
    const key = `${p.side}${p.id}:${w}`;
    if (formCache.has(key)) return formCache.get(key);
    let line;
    if (!weekly || w === 0) line = seasonWeekly(p);
    else {
      const recent = avgLines(p.side, [Math.max(0, w - 2), w - 1].filter((x, i, a) => a.indexOf(x) === i).map((x) => actual(p, x)));
      const toDate = avgLines(p.side, Array.from({ length: w }, (_, x) => actual(p, x)));
      // 季前評價的份量：開季時很重，越到季中越輕（球星短暫低潮或小傷不會馬上被丟）
      const prior = seasonWeekly(p);
      const k = Math.max(0.5, 2.5 - w / 6);
      line = weighted(p.side, [[recent, 1], [toDate, 1], [prior, k]]);
    }
    formCache.set(key, line);
    return line;
  };
  // 每週表現的 z 分數基準（用整季平均的前段球員）
  const stat = {};
  for (const side of ['B', 'P']) {
    const pool = players.filter((p) => p.side === side).slice(0, side === 'B' ? 220 : 200).map((p) => contributions(seasonWeekly(p)));
    for (const cat of Object.keys(pool[0] ?? {})) {
      const v = pool.map((c) => c[cat]);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      stat[cat] = [m, Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1];
    }
  }
  const scoreCache = new Map();
  const score = (p, w) => {
    const key = `${p.side}${p.id}:${w}`;
    if (!scoreCache.has(key)) {
      const c = contributions(form(p, w));
      scoreCache.set(key, Object.entries(c).reduce((a, [cat, v]) => a + (v - stat[cat][0]) / stat[cat][1], 0));
    }
    return scoreCache.get(key);
  };
  return { actual, form, score, real: !!weekly };
}

// 依近況排先發
function lineupW(team, world, w) {
  for (const p of team) p._s = world.score(p, w);
  const pick = (side) => {
    const slots = side === 'B' ? BAT_SLOTS : PIT_SLOTS;
    const order = slots.map((_, i) => i).sort((a, b) => SLOT_ORDER[slots[a]] - SLOT_ORDER[slots[b]]);
    const used = new Set();
    const roster = team.filter((p) => p.side === side).sort((a, b) => b._s - a._s);
    const out = [];
    for (const i of order) {
      const p = roster.find((x) => !used.has(x.id) && fits(x, slots[i]));
      if (p) { out.push(p); used.add(p.id); }
    }
    return out;
  };
  return [...pick('B'), ...pick('P')];
}

function weekStatsReal(lu, world, w) {
  const t = teamLine(lu.map((p) => world.actual(p, w)));
  if (!t.IP) { t['P:ERA'] = 99; t['P:WHIP'] = 99; }
  return t;
}

// 預估每週能贏幾類：每類用「領先一般球隊幾個單位」換成勝率再加總
function expectedWins(team, typical, world, w) {
  const line = teamLine(lineupW(team, world, w).map((p) => world.form(p, w)));
  return CATS.reduce((a, c) => a + 1 / (1 + Math.exp(-1.7 * margin(c, line, typical) / scale(c, typical))), 0);
}

function swap(team, freeAgents, drop, add) {
  team.splice(team.indexOf(drop), 1, add);
  freeAgents.delete(add.id);
  freeAgents.set(drop.id, drop);
}

// 我方：試算「換人前後整隊每週預估多贏幾類」，有提升才換（每週最多 2 次）
function pickupStep(teams, freeAgents, budget, mySlot, world, w) {
  const myTeam = teams[mySlot];
  const others = teams.filter((_, i) => i !== mySlot).map((t) => teamLine(lineupW(t, world, w).map((p) => world.form(p, w))));
  const typical = {};
  for (const c of CATS) typical[c] = others.reduce((a, l) => a + l[c], 0) / others.length;
  const mine = teamLine(lineupW(myTeam, world, w).map((p) => world.form(p, w)));
  const weak = CATS.map((c) => [c, margin(c, mine, typical) / scale(c, typical)]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([c]) => CAT_LABEL[c]);
  const moves = [];
  let top = [];
  for (let k = 0; k < 2 && budget - moves.length > 0; k++) {
    const base = expectedWins(myTeam, typical, world, w);
    const cands = [...freeAgents.values()].sort((a, b) => world.score(b, w) - world.score(a, w)).slice(0, 12);
    const options = [];
    for (const add of cands) {
      let best = null;
      for (const drop of myTeam) {
        if (drop.side !== add.side) continue;
        const gain = expectedWins(myTeam.map((p) => (p === drop ? add : p)), typical, world, w) - base;
        if (!best || gain > best.gain) best = { add, drop, gain };
      }
      if (best) options.push(best);
    }
    options.sort((a, b) => b.gain - a.gain);
    if (k === 0) top = options.slice(0, 3);
    if (!options[0] || options[0].gain <= 0.05) break;
    swap(myTeam, freeAgents, options[0].drop, options[0].add);
    moves.push(options[0]);
  }
  return { weak, top, moves, move: moves[0] ?? null };
}

// 對手：照各自每季換人次數，每週把近況最差的人換成近況最好的自由球員
function aiMoves(teams, freeAgents, ai, mySlot, world, w, r) {
  let n = 0;
  teams.forEach((team, t) => {
    if (t === mySlot) return;
    const k = Math.min(4, r.poisson(ai[t]?.movesPerWeek ?? 1.5));
    for (let i = 0; i < k; i++) {
      const worst = [...team].sort((a, b) => world.score(a, w) - world.score(b, w))[0];
      let best = null;
      for (const p of freeAgents.values()) if (p.side === worst.side && (!best || world.score(p, w) > world.score(best, w))) best = p;
      if (best && world.score(best, w) > world.score(worst, w) + 0.5) { swap(team, freeAgents, worst, best); n++; }
    }
  });
  return n;
}

function newcomers(players, weekly) {
  if (!weekly) return [];
  const known = new Set(players.map((p) => `${p.side}${p.id}`));
  const out = [];
  for (const [key, v] of Object.entries(weekly.players)) {
    if (known.has(key)) continue;
    const side = key[0];
    const id = Number(key.slice(1));
    const gs = side === 'P' ? v.w.reduce((a, r) => a + (r ? r[9] : 0), 0) : 0;
    const pos = side === 'P' ? (gs >= 5 ? 'SP' : 'RP') : ['LF', 'CF', 'RF'].includes(v.pos) ? 'OF' : v.pos || 'DH';
    out.push({ id, name: v.n, side, pos, team: '', age: null, value: -99, rank: 9999, marketRank: 9999, rookie: true,
      AB: 0, PA: 0, H: 0, R: 0, HR: 0, RBI: 0, SB: 0, BB: 0, K: 0, OPS: 0, AVG: 0, IP: 0, W: 0, L: 0, SV: 0, HLD: 0, ER: 0, WH: 0, QS: 0, z: {} });
  }
  return out;
}

// ── 跑完整一季 → 事件清單（給畫面逐步播放） ──
// weekly：2026 真實逐週資料（有就「重播」，沒有就用整季平均＋隨機）
export function runSeason(players, { mySlot, profiles, seed, teamNames, weekly = null }) {
  const r = rng(seed);
  const d = draft(players, { mySlot, profiles, r });
  const world = makeWorld(players, weekly);
  // 選秀時還不存在（或沒被列入）的球員，例如 2026 新人 → 放進自由球員
  for (const p of newcomers(players, weekly)) d.freeAgents.set(p.id, p);
  const names = d.teams.map((_, i) => (i === mySlot ? '你' : d.ai[i]?.name ?? teamNames?.[i] ?? `電腦 ${i + 1}`));
  const events = [{ type: 'draft', log: d.log, names, ai: d.ai, mySlot, real: world.real, weeks: weekly?.weeks ?? null }];
  const rec = d.teams.map(() => ({ w: 0, l: 0, t: 0, mw: 0, ml: 0 }));
  let budget = globalThis.__DEMO_BUDGET ?? 150;
  let aiTotal = 0;
  const stats = (team, w) => (world.real ? weekStatsReal(lineupW(team, world, w), world, w) : weekStats(lineupW(team, world, w), r));
  for (const [i, wk] of schedule(r).entries()) {
    const week = i + 1;
    const pk = pickupStep(d.teams, d.freeAgents, budget, mySlot, world, i);
    budget -= pk.moves.length;
    aiTotal += aiMoves(d.teams, d.freeAgents, d.ai, mySlot, world, i, r);
    const games = [];
    for (const [a, b] of wk) {
      const m = match(stats(d.teams[a], i), stats(d.teams[b], i));
      rec[a].w += m.w; rec[a].l += m.l; rec[a].t += m.t;
      rec[b].w += m.l; rec[b].l += m.w; rec[b].t += m.t;
      if (m.w > m.l) { rec[a].mw++; rec[b].ml++; } else if (m.l > m.w) { rec[b].mw++; rec[a].ml++; }
      games.push({ a, b, ...m });
    }
    const myGame = games.find((g) => g.a === mySlot || g.b === mySlot);
    const hot = lineupW(d.teams[mySlot], world, i).filter((p) => world.real && world.score(p, i) > 4).slice(0, 3).map((p) => p.name);
    events.push({ type: 'week', week, dates: weekly?.weeks?.[i] ?? null, games, myGame, pickup: pk, hot, standings: standings(rec) });
  }
  // 季後賽（第 24–26 週，也照真實逐週）
  const seeds = standings(rec).map((s) => s.team);
  const play = (a, b, week, label) => {
    const m = match(stats(d.teams[a], week - 1), stats(d.teams[b], week - 1));
    const winner = m.w > m.l || (m.w === m.l && seeds.indexOf(a) < seeds.indexOf(b)) ? a : b;
    events.push({ type: 'playoff', week, label, a, b, ...m, winner });
    return winner;
  };
  const s = seeds;
  const q1 = play(s[2], s[5], 24, '八強');
  const q2 = play(s[3], s[4], 24, '八強');
  const f1 = play(s[0], q2, 25, '四強');
  const f2 = play(s[1], q1, 25, '四強');
  const champ = play(f1, f2, 26, '冠軍戰');
  events.push({ type: 'end', champ, seeds, myRank: seeds.indexOf(mySlot) + 1, names, standings: standings(rec), moves: (globalThis.__DEMO_BUDGET ?? 150) - budget, aiMoves: aiTotal, real: world.real });
  return { events, names, myTeam: d.teams[mySlot] };
}

function standings(rec) {
  const pct = (x) => (x.w + 0.5 * x.t) / Math.max(1, x.w + x.l + x.t);
  return rec.map((x, team) => ({ team, ...x, pct: pct(x) })).sort((a, b) => b.pct - a.pct);
}

// Demo：虛擬跑一次 2027（移植自 sim/sim.py）
// 12 隊蛇形選秀 25 輪 → 23 週 H2H 18 類別（每週撿人）→ 6 隊季後賽（第 24–26 週）
import { CATS, CAT_LABEL, teamLine, scale, margin } from './pickup.js';
import { normName } from './pickup.js';

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

// picks：parseDraftResults 結果（可多個球季合併）；players：選秀表（board）的球員
export function buildProfiles(picks, players, myTeamName) {
  const byName = new Map(players.map((p) => [`${normName(p.name)}`, p]));
  const teams = new Map();
  const league = BUCKETS.map(() => ({}));
  for (const pk of picks) {
    const p = byName.get(normName(pk.name));
    if (!p) continue;
    const g = posGroup(p);
    const b = bucketOf(pk.round);
    const t = teams.get(pk.team) ?? { name: pk.team, n: 0, share: BUCKETS.map(() => ({})), counts: BUCKETS.map(() => 0), reach: [], ages: [], firstRP: null, mlbTeams: {} };
    t.n++;
    t.share[b][g] = (t.share[b][g] ?? 0) + 1;
    t.counts[b]++;
    league[b][g] = (league[b][g] ?? 0) + 1;
    t.reach.push(p.marketRank - pk.overall);
    if (p.age) t.ages.push(p.age);
    if (p.pos === 'RP' && (t.firstRP == null || pk.round < t.firstRP)) t.firstRP = pk.round;
    t.mlbTeams[p.team] = (t.mlbTeams[p.team] ?? 0) + 1;
    teams.set(pk.team, t);
  }
  const lgTot = league.map((b) => Object.values(b).reduce((a, x) => a + x, 0) || 1);
  // 「搶人」程度跟聯盟平均比（用事後成績看，每隊都像搶早了）
  const allReach = [...teams.values()].flatMap((t) => t.reach);
  const lgReach = allReach.reduce((a, b) => a + b, 0) / Math.max(1, allReach.length);
  const profiles = [];
  for (const t of teams.values()) {
    if (t.name === myTeamName || t.n < 8) continue;
    // 偏好倍率 = 這隊在該輪段選某守位的比例 ÷ 全聯盟比例
    const pref = t.share.map((s, b) => {
      const o = {};
      for (const g of ['C', 'IF', 'OF', 'DH', 'SP', 'RP']) {
        // 向聯盟平均收斂（相當於先假設 10 個「平均選擇」），避免幾個選擇就被放大成偏好
        const lg = ((league[b][g] ?? 0) + 0.5) / (lgTot[b] + 3);
        const mine = ((s[g] ?? 0) + 10 * lg) / (t.counts[b] + 10);
        o[g] = Math.min(2.5, Math.max(0.4, mine / lg));
      }
      return o;
    });
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const fav = Object.entries(t.mlbTeams).sort((a, b) => b[1] - a[1])[0];
    profiles.push({
      name: t.name, pref,
      reach: avg(t.reach) - lgReach, age: avg(t.ages), firstRP: t.firstRP,
      favTeam: fav && fav[1] >= 4 ? fav[0] : null,
      summary: describe(pref, avg(t.reach) - lgReach, avg(t.ages), t.firstRP, fav && fav[1] >= 4 ? fav[0] : null),
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
  if (firstRP && firstRP <= 8) out.push(`第 ${firstRP} 輪就拿後援`);
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

// ── 每週撿人（只有我方；電腦對手不換人） ──
const seasonWeekly = (p) => {
  const q = { ...p };
  for (const k of ['AB', 'PA', 'R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K', 'IP', 'W', 'L', 'SV', 'HLD', 'ER', 'WH', 'QS']) if (k in q) q[k] = (q[k] ?? 0) * FRAC;
  return q;
};

// 預估每週能贏幾類：每類用「領先一般球隊幾個單位」換成勝率再加總
function expectedWins(team, typical) {
  const line = teamLine(lineup(team).map(seasonWeekly));
  return CATS.reduce((a, c) => a + 1 / (1 + Math.exp(-1.7 * margin(c, line, typical) / scale(c, typical))), 0);
}

function pickupStep(myTeam, teams, freeAgents, budget, mySlot) {
  const others = teams.filter((_, i) => i !== mySlot).map((t) => teamLine(lineup(t).map(seasonWeekly)));
  const typical = {};
  for (const c of CATS) typical[c] = others.reduce((a, l) => a + l[c], 0) / others.length;
  const mine = teamLine(lineup(myTeam).map(seasonWeekly));
  const weak = CATS.map((c) => [c, margin(c, mine, typical) / scale(c, typical)]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([c]) => CAT_LABEL[c]);
  const base = expectedWins(myTeam, typical);
  const zsum = (p) => Object.values(p.z).reduce((a, b) => a + b, 0);
  const cands = [...freeAgents.values()].sort((a, b) => zsum(b) - zsum(a)).slice(0, 10);
  const options = [];
  for (const add of cands) {
    let best = null;
    for (const drop of myTeam) {
      if (drop.side !== add.side) continue;
      const trial = myTeam.map((p) => (p === drop ? add : p));
      const gain = expectedWins(trial, typical) - base;
      if (!best || gain > best.gain) best = { add, drop, gain };
    }
    if (best) options.push(best);
  }
  options.sort((a, b) => b.gain - a.gain);
  let move = null;
  const top = options[0];
  if (budget > 0 && top && top.gain > 0.05) {
    myTeam.splice(myTeam.indexOf(top.drop), 1, top.add);
    freeAgents.delete(top.add.id);
    freeAgents.set(top.drop.id, top.drop);
    move = { add: top.add, drop: top.drop, gain: top.gain };
  }
  return { weak, top: options.slice(0, 3).map((o) => ({ add: o.add, drop: o.drop, gain: o.gain })), move, expected: base };
}

// ── 跑完整一季 → 事件清單（給畫面逐步播放） ──
export function runSeason(players, { mySlot, profiles, seed, teamNames }) {
  const r = rng(seed);
  const d = draft(players, { mySlot, profiles, r });
  const names = d.teams.map((_, i) => (i === mySlot ? '你' : d.ai[i]?.name ?? teamNames?.[i] ?? `電腦 ${i + 1}`));
  const events = [{ type: 'draft', log: d.log, names, ai: d.ai, mySlot }];
  const rec = d.teams.map(() => ({ w: 0, l: 0, t: 0, mw: 0, ml: 0 }));
  let budget = globalThis.__DEMO_BUDGET ?? 150;
  for (const [i, wk] of schedule(r).entries()) {
    const week = i + 1;
    const pk = pickupStep(d.teams[mySlot], d.teams, d.freeAgents, budget, mySlot);
    if (pk.move) budget--;
    const lus = d.teams.map(lineup);
    const games = [];
    for (const [a, b] of wk) {
      const m = match(weekStats(lus[a], r), weekStats(lus[b], r));
      rec[a].w += m.w; rec[a].l += m.l; rec[a].t += m.t;
      rec[b].w += m.l; rec[b].l += m.w; rec[b].t += m.t;
      if (m.w > m.l) { rec[a].mw++; rec[b].ml++; } else if (m.l > m.w) { rec[b].mw++; rec[a].ml++; }
      games.push({ a, b, ...m });
    }
    const myGame = games.find((g) => g.a === mySlot || g.b === mySlot);
    events.push({ type: 'week', week, games, myGame, pickup: pk, standings: standings(rec) });
  }
  // 季後賽
  const seeds = standings(rec).map((s) => s.team);
  const lus = d.teams.map(lineup);
  const play = (a, b, week, label) => {
    const m = match(weekStats(lus[a], r), weekStats(lus[b], r));
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
  events.push({ type: 'end', champ, seeds, myRank: seeds.indexOf(mySlot) + 1, names, standings: standings(rec), moves: 150 - budget });
  return { events, names, myTeam: d.teams[mySlot] };
}

function standings(rec) {
  const pct = (x) => (x.w + 0.5 * x.t) / Math.max(1, x.w + x.l + x.t);
  return rec.map((x, team) => ({ team, ...x, pct: pct(x) })).sort((a, b) => b.pct - a.pct);
}

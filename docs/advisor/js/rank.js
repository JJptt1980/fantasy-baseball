// 選秀排名（移植自 sim/rank.py，兩邊邏輯要一致）
// West Bay Star：12 隊、H2H 18 類別
import { ipToFloat } from './mlb.js';

const OF = new Set(['LF', 'CF', 'RF', 'OF']);

export const DEFAULT_CONFIG = {
  weights: {},          // 'B:HR' → 倍率；沒寫的類別 = 1
  youngAge: 26,
  youngBonus: 0.08,
  oldAge: 99,
  oldPenalty: 0,
  injuryPenalty: 0.12,
  catcherPenalty: 0.5,
  avoidKPenalty: 4.0,   // 三振率 > 28% 且打擊率 < .240
  maxReach: 15,
  keyTransform: null,   // (p, key, spRank) => key
};

function estQs(st) {
  const gs = st.gamesStarted ?? 0;
  if (!gs) return 0;
  const ipPer = st._ip / gs;
  const depth = Math.min(1, Math.max(0, (ipPer - 4.3) / 1.9));
  const era = st._ip ? ((st.earnedRuns ?? 0) * 9) / st._ip : 9;
  const quality = Math.min(1, Math.max(0.15, (5.4 - era) / 2.6));
  return gs * depth * quality;
}

// maps：{ hit, pit }（本季）；prev：{ hit, pit }（上一季，判斷傷病與進步）
export function buildPlayers(maps, prev) {
  const players = [];
  for (const [id, h] of maps.hit) {
    const st = h.stat;
    if ((st.atBats ?? 0) < 150 || h.pos === 'P') continue;
    const p25 = prev?.hit.get(id)?.stat ?? {};
    players.push({
      id, name: h.name, team: h.team, side: 'B', pos: OF.has(h.pos) ? 'OF' : h.pos, age: st.age,
      G: st.gamesPlayed ?? 0, G25: p25.gamesPlayed ?? 0,
      AB: st.atBats, PA: st.plateAppearances ?? st.atBats,
      R: st.runs, H: st.hits, HR: st.homeRuns, RBI: st.rbi, SB: st.stolenBases,
      BB: st.baseOnBalls, K: st.strikeOuts, AVG: st.hits / st.atBats, OPS: Number(st.ops) || 0,
      OPS25: (p25.atBats ?? 0) >= 150 ? Number(p25.ops) || 0 : null,
    });
  }
  for (const [id, p] of maps.pit) {
    const st = p.stat;
    const ip = st._ip ?? ipToFloat(st.inningsPitched);
    if (ip < 30) continue;
    const gs = st.gamesStarted ?? 0;
    const p25 = prev?.pit.get(id)?.stat ?? {};
    players.push({
      id, name: p.name, team: p.team, side: 'P', pos: gs >= 8 ? 'SP' : 'RP', age: st.age,
      IP: ip, IP25: p25._ip ?? 0, GS: gs,
      W: st.wins ?? 0, L: st.losses ?? 0, SV: st.saves ?? 0, HLD: st.holds ?? 0,
      BB: st.baseOnBalls ?? 0, K: st.strikeOuts ?? 0, ER: st.earnedRuns ?? 0,
      WH: (st.baseOnBalls ?? 0) + (st.hits ?? 0), QS: estQs({ ...st, _ip: ip }),
    });
  }
  return players;
}

// 每類別對球隊的貢獻（越小越好的類別已反轉）
export function contributions(p) {
  if (p.side === 'B') {
    return {
      'B:R': p.R, 'B:H': p.H, 'B:HR': p.HR, 'B:RBI': p.RBI, 'B:SB': p.SB, 'B:BB': p.BB,
      'B:K': -p.K, 'B:AVG': p.H - 0.25 * p.AB, 'B:OPS': (p.OPS - 0.74) * p.PA,
    };
  }
  return {
    'P:W': p.W, 'P:SV': p.SV, 'P:K': p.K, 'P:HLD': p.HLD, 'P:QS': p.QS,
    'P:L': -p.L, 'P:BB': -p.BB, 'P:ERA': (3.9 * p.IP) / 9 - p.ER, 'P:WHIP': 1.24 * p.IP - p.WH,
  };
}

function zScore(players, weights) {
  for (const [side, top] of [['B', 220], ['P', 200]]) {
    const pool = players.filter((p) => p.side === side);
    const size = (p) => (side === 'B' ? p.PA * (p.OPS || 0) : p.IP + 3 * p.SV + 2 * p.HLD);
    pool.sort((a, b) => size(b) - size(a));
    const cs = pool.slice(0, top).map(contributions);
    const stat = {};
    for (const cat of Object.keys(cs[0] ?? {})) {
      const vals = cs.map((c) => c[cat]);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / vals.length) || 1;
      stat[cat] = [m, sd];
    }
    for (const p of pool) {
      const c = contributions(p);
      p.z = {};
      p.raw = 0;
      for (const [cat, v] of Object.entries(c)) {
        p.z[cat] = (v - stat[cat][0]) / stat[cat][1];
        p.raw += p.z[cat] * (weights[cat] ?? 1);
      }
    }
  }
}

function adjust(p, cfg) {
  let v = p.raw;
  const notes = [];
  if (p.age && p.age <= cfg.youngAge && v > 0) {
    v *= 1 + cfg.youngBonus;
    notes.push('年輕、還在進步');
  }
  if (p.side === 'B' && p.OPS25 && p.OPS - p.OPS25 > 0.06 && p.age <= 28) {
    notes.push(`打擊比前一年進步很多（OPS +${(p.OPS - p.OPS25).toFixed(3)}）`);
  }
  if (p.age && p.age >= cfg.oldAge && v > 0) {
    v *= 1 - cfg.oldPenalty;
    notes.push('年紀偏大');
  }
  const hurt =
    (p.side === 'B' && Math.min(p.G, p.G25 || p.G) < 110) ||
    (p.side === 'P' && p.pos === 'SP' && Math.min(p.IP, p.IP25 || p.IP) < 110);
  if (hurt && v > 0) {
    v *= 1 - cfg.injuryPenalty;
    notes.push('這兩年常常受傷沒上場');
  }
  if (p.pos === 'C' && v > 0) {
    v *= 1 - cfg.catcherPenalty;
    notes.push('捕手可以晚點選');
  }
  if (p.side === 'B' && p.K / p.PA > 0.28 && p.AVG < 0.24) {
    v -= cfg.avoidKPenalty;
    if (cfg.avoidKPenalty) notes.push('常被三振、打擊率又低，少選');
  }
  if (p.side === 'P' && p.IP && (p.BB * 9) / p.IP > 3.6) notes.push(`保送給太多（每 9 局 ${((p.BB * 9) / p.IP).toFixed(1)} 次）`);
  // 預測／Statcast／傷兵的備註（projections.js annotate 加的；Python 版沒有這些資料）
  if (p.extraNotes?.length) notes.push(...p.extraNotes);
  p.value = v;
  p.notes = notes;
}

// 回傳選秀順序（每人含 rank、round、marketRank、value、notes）
export function board(basePlayers, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, weights: { ...(config.weights ?? {}) } };
  // 市場排名：不帶偏好的均衡原始分數
  const market = basePlayers.map((p) => ({ ...p }));
  zScore(market, {});
  // 二刀流（例：Ohtani）打者、投手同一個 MLB 編號 → 用「打/投＋編號」當 key
  let mrank = new Map([...market].sort((a, b) => b.raw - a.raw).map((p, i) => [`${p.side}${p.id}`, i + 1]));
  // 有真實 ADP（Yahoo／ESPN）就用它當市場排名；ADP 名單外的人排在後面、照估計排序（Python 版沒有這段）
  if (cfg.market?.size) {
    const v = (k) => cfg.market.get(k) ?? 1000 + mrank.get(k);
    mrank = new Map([...mrank.keys()].sort((a, b) => v(a) - v(b)).map((k, i) => [k, i + 1]));
  }

  const mine = basePlayers.map((p) => ({ ...p }));
  zScore(mine, cfg.weights);
  mine.forEach((p) => adjust(p, cfg));
  mine.sort((a, b) => b.value - a.value);
  mine.forEach((p, i) => {
    p.myRank = i + 1;
    p.marketRank = mrank.get(`${p.side}${p.id}`);
    p.key = Math.max(i + 1, p.marketRank - cfg.maxReach);
  });
  if (cfg.keyTransform) {
    const sps = mine.filter((p) => p.pos === 'SP').sort((a, b) => b.value - a.value);
    const spRank = new Map(sps.map((p, i) => [p.id, i + 1]));
    for (const p of mine) p.key = cfg.keyTransform(p, p.key, spRank.get(p.id));
  }
  mine.sort((a, b) => a.key - b.key || b.value - a.value);
  mine.forEach((p, i) => {
    p.rank = i + 1;
    p.round = Math.ceil((i + 1) / 12);
  });
  return mine;
}

// 兩年資料加權（Demo 選秀用）：最近一季 65%、前一季 35%；
// 最近一季出賽不到前一季的 6 成（多半是受傷）就改成 40%／60%；整季沒出賽的只用前一季打 5 折
export function blendMaps(cur, prev) {
  const out = { hit: new Map(), pit: new Map() };
  for (const side of ['hit', 'pit']) {
    const vol = (st) => (side === 'hit' ? st.plateAppearances ?? st.atBats ?? 0 : st._ip ?? ipToFloat(st.inningsPitched));
    const ids = new Set([...cur[side].keys(), ...prev[side].keys()]);
    for (const id of ids) {
      const c = cur[side].get(id);
      const p = prev[side].get(id);
      if (!p) { out[side].set(id, c); continue; }
      const k = c ? (vol(c.stat) < 0.6 * vol(p.stat) ? 0.4 : 0.65) : 0;
      const base = c ?? p;
      const st = {};
      const cs = c?.stat ?? {};
      const ps = p.stat;
      for (const key of new Set([...Object.keys(cs), ...Object.keys(ps)])) {
        const a = cs[key];
        const b = ps[key];
        if (key === 'age') st.age = cs.age ?? (ps.age != null ? ps.age + 1 : null);
        else if (key === 'ops') st.ops = String(k * (Number(a) || 0) + (1 - k) * (Number(b) || 0) * (c ? 1 : 1));
        else if (typeof (a ?? b) === 'number') st[key] = c ? k * (a ?? 0) + (1 - k) * (b ?? 0) : 0.5 * (b ?? 0);
      }
      const ip = c ? k * vol(cs) + (1 - k) * vol(ps) : 0.5 * vol(ps);
      if (side === 'pit') { st._ip = ip; st.inningsPitched = String(Math.floor(ip)); }
      if (!c && side === 'hit') st.ops = String(Number(ps.ops) || 0);
      out[side].set(id, { ...base, stat: st });
    }
  }
  return out;
}

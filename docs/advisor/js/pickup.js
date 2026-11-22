// 季中撿人推薦：自由球員近況 × 我的隊形 × 當週對手近況
// 全部用 MLB 官方「最近 N 天」數據換算成「一週」的量來比較
import { ipToFloat } from './mlb.js';
import { contributions } from './rank.js';

export const CATS = ['B:R', 'B:H', 'B:HR', 'B:RBI', 'B:SB', 'B:BB', 'B:K', 'B:AVG', 'B:OPS',
  'P:W', 'P:L', 'P:SV', 'P:BB', 'P:K', 'P:HLD', 'P:ERA', 'P:WHIP', 'P:QS'];
export const CAT_LABEL = {
  'B:R': 'R', 'B:H': 'H', 'B:HR': 'HR', 'B:RBI': 'RBI', 'B:SB': 'SB', 'B:BB': 'BB', 'B:K': '打者K', 'B:AVG': 'AVG', 'B:OPS': 'OPS',
  'P:W': 'W', 'P:L': 'L', 'P:SV': 'SV', 'P:BB': '投手BB', 'P:K': '投手K', 'P:HLD': 'HLD', 'P:ERA': 'ERA', 'P:WHIP': 'WHIP', 'P:QS': 'QS',
};
const LOWER = new Set(['B:K', 'P:L', 'P:BB', 'P:ERA', 'P:WHIP']);

// 打字說需求 → 類別加重
const KEYWORDS = [
  [/救援|終結|closer|\bsv\b|save/i, ['P:SV']],
  [/中繼|hold|hld/i, ['P:HLD']],
  [/盜壘|速度|\bsb\b|steal/i, ['B:SB']],
  [/全壘打|火力|長打|\bhr\b|power/i, ['B:HR', 'B:RBI', 'B:OPS']],
  [/打擊率|安打|\bavg\b|\bh\b/i, ['B:AVG', 'B:H']],
  [/得分|\br\b|run/i, ['B:R']],
  [/打點|rbi/i, ['B:RBI']],
  [/上壘|保送選|ops/i, ['B:OPS', 'B:BB']],
  [/局數|先發|投球局|\bip\b|\bqs\b|勝投|\bw\b/i, ['P:W', 'P:QS', 'P:K']],
  [/三振|strikeout/i, ['P:K']],
  [/防禦率|era|比率|ratio/i, ['P:ERA', 'P:WHIP']],
  [/whip|控球|保送/i, ['P:WHIP', 'P:BB']],
];

export function parseWants(text) {
  const boost = {};
  for (const [re, cats] of KEYWORDS) if (re.test(text || '')) for (const c of cats) boost[c] = 3;
  return boost;
}

export function normName(s) {
  return String(s ?? '')
    .replace(/\(.*?\)/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
}

// 近況期間：球季中 = 到昨天為止；休賽季 = 上一季最後 N 天
export async function recentWindow(days = 14, now = new Date()) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const y = now.getFullYear();
  let end = new Date(now.getTime() - 86400e3);
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/seasons/${y}?sportId=1`);
    const s = (await r.json()).seasons?.[0];
    const start = s && new Date(s.regularSeasonStartDate);
    const last = s && new Date(s.regularSeasonEndDate);
    if (s && now < start) {
      const r2 = await fetch(`https://statsapi.mlb.com/api/v1/seasons/${y - 1}?sportId=1`);
      end = new Date((await r2.json()).seasons[0].regularSeasonEndDate);
    } else if (s && now > last) {
      end = last;
    }
  } catch { /* 用昨天 */ }
  const start = new Date(end.getTime() - (days - 1) * 86400e3);
  return { start: fmt(start), end: fmt(end), days };
}

// MLB 近況（rangeStats → toMaps）→ 依名字索引的「每週」數據
export function weeklyIndex(maps, days) {
  const f = 7 / days;
  const idx = new Map();
  for (const h of maps.hit.values()) {
    const s = h.stat;
    if (h.pos === 'P') continue;
    const p = {
      id: h.id, name: h.name, team: h.team, pos: h.pos, side: 'B', games: s.gamesPlayed ?? 0,
      AB: (s.atBats ?? 0) * f, PA: (s.plateAppearances ?? s.atBats ?? 0) * f,
      R: (s.runs ?? 0) * f, H: (s.hits ?? 0) * f, HR: (s.homeRuns ?? 0) * f, RBI: (s.rbi ?? 0) * f,
      SB: (s.stolenBases ?? 0) * f, BB: (s.baseOnBalls ?? 0) * f, K: (s.strikeOuts ?? 0) * f,
      OPS: Number(s.ops) || 0,
    };
    p.AVG = p.AB ? p.H / p.AB : 0;
    idx.set(`B:${normName(h.name)}`, p);
  }
  for (const h of maps.pit.values()) {
    const s = h.stat;
    const ip = s._ip ?? ipToFloat(s.inningsPitched);
    const gs = s.gamesStarted ?? 0;
    const era = ip ? ((s.earnedRuns ?? 0) * 9) / ip : 9;
    const qs = gs ? gs * Math.min(1, Math.max(0, (ip / gs - 4.3) / 1.9)) * Math.min(1, Math.max(0.15, (5.4 - era) / 2.6)) : 0;
    const p = {
      id: h.id, name: h.name, team: h.team, pos: gs >= 2 ? 'SP' : 'RP', side: 'P', games: s.gamesPlayed ?? 0,
      IP: ip * f, W: (s.wins ?? 0) * f, L: (s.losses ?? 0) * f, SV: (s.saves ?? 0) * f, HLD: (s.holds ?? 0) * f,
      BB: (s.baseOnBalls ?? 0) * f, K: (s.strikeOuts ?? 0) * f, ER: (s.earnedRuns ?? 0) * f,
      WH: ((s.baseOnBalls ?? 0) + (s.hits ?? 0)) * f, QS: qs * f,
    };
    idx.set(`P:${normName(h.name)}`, p);
  }
  return idx;
}

// 一隊一週的類別數字
export function teamLine(players) {
  const t = { AB: 0, PA: 0, OPSw: 0, IP: 0, ER: 0, WH: 0 };
  const sum = (k, v) => { t[k] = (t[k] ?? 0) + (v || 0); };
  for (const p of players) {
    if (p.side === 'B') {
      for (const k of ['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K']) sum(`B:${k}`, p[k]);
      t.AB += p.AB; t.PA += p.PA; t.OPSw += p.OPS * p.PA;
    } else {
      for (const k of ['W', 'L', 'SV', 'BB', 'K', 'HLD', 'QS']) sum(`P:${k}`, p[k]);
      t.IP += p.IP; t.ER += p.ER; t.WH += p.WH;
    }
  }
  t['B:AVG'] = t.AB ? (t['B:H'] ?? 0) / t.AB : 0;
  t['B:OPS'] = t.PA ? t.OPSw / t.PA : 0;
  t['P:ERA'] = t.IP ? (t.ER * 9) / t.IP : 0;
  t['P:WHIP'] = t.IP ? t.WH / t.IP : 0;
  for (const c of CATS) t[c] ??= 0;
  return t;
}

// 「一般球隊」一週：近況裡出賽最多的前段球員，平分給 12 隊
export function typicalLine(idx) {
  const all = [...idx.values()];
  const bats = all.filter((p) => p.side === 'B').sort((a, b) => b.PA - a.PA).slice(0, 12 * 13);
  const arms = all.filter((p) => p.side === 'P').sort((a, b) => (b.IP + 3 * b.SV + 2 * b.HLD) - (a.IP + 3 * a.SV + 2 * a.HLD)).slice(0, 12 * 11);
  const t = teamLine([...bats, ...arms]);
  for (const c of CATS) if (!['B:AVG', 'B:OPS', 'P:ERA', 'P:WHIP'].includes(c)) t[c] /= 12;
  return t;
}

// 類別差距的「一個單位」：計數類別用一般球隊一週的 20%，比率類別用固定值
export function scale(cat, typical) {
  return { 'B:AVG': 0.015, 'B:OPS': 0.04, 'P:ERA': 0.9, 'P:WHIP': 0.13 }[cat] ?? Math.max(0.5, typical[cat] * 0.2);
}
// 我方贏多少（正 = 我贏）
export function margin(cat, mine, other) {
  const d = mine[cat] - other[cat];
  return LOWER.has(cat) ? -d : d;
}

// 自由球員每類別的 z 分數（和整個近況母體比）
function zIndex(idx) {
  const out = new Map();
  for (const side of ['B', 'P']) {
    const pool = [...idx.values()].filter((p) => p.side === side && (side === 'B' ? p.PA >= 6 : p.IP >= 1.5 || p.SV + p.HLD > 0));
    const cs = pool.map((p) => contributions(p));
    const stat = {};
    for (const cat of Object.keys(cs[0] ?? {})) {
      const vals = cs.map((c) => c[cat]);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / vals.length) || 1;
      stat[cat] = [m, sd];
    }
    for (const p of idx.values()) {
      if (p.side !== side) continue;
      const c = contributions(p);
      const z = {};
      for (const [cat, v] of Object.entries(c)) z[cat] = (v - stat[cat][0]) / stat[cat][1];
      out.set(p, z);
    }
  }
  return out;
}

// 主函式 → { lists: { recent, fit, opp }, myLine, oppLine, typical, weights, missing }
export function recommend({ idx, myRoster, oppRoster, freeAgents, wants = '', top = 8 }) {
  const find = (r) => idx.get(`${r.side}:${normName(r.name)}`);
  const active = (r) => !['IL', 'IL+', 'NA', 'BN'].includes(r.slot);
  const missing = [];
  const lineOf = (roster) => teamLine((roster ?? []).filter(active).map((r) => find(r) ?? (missing.push(r.name), null)).filter(Boolean));

  const typical = typicalLine(idx);
  const myLine = lineOf(myRoster);
  const oppLine = oppRoster?.length ? lineOf(oppRoster) : null;
  const boost = parseWants(wants);

  const wRecent = {};
  const wFit = {};
  const wOpp = {};
  for (const c of CATS) {
    const b = boost[c] ?? 1;
    wRecent[c] = b;
    // 落後一般球隊越多越需要補
    wFit[c] = b * Math.min(3, Math.max(0.25, 1 - margin(c, myLine, typical) / scale(c, typical)));
    // 跟對手越接近越值得拚（大勝或大敗的類別少管）
    if (oppLine) {
      const m = margin(c, myLine, oppLine) / scale(c, typical);
      wOpp[c] = b * (0.25 + 1.75 * Math.exp(-m * m));
    }
  }

  const zs = zIndex(idx);
  const candidates = [];
  const seen = new Set();
  for (const r of freeAgents) {
    const p = find(r);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (p.side === 'B' ? p.PA < 6 : p.IP < 1.5 && p.SV + p.HLD === 0) continue; // 最近幾乎沒上場
    candidates.push({ p, z: zs.get(p), yahoo: r });
  }

  const rank = (w) => candidates
    .map((c) => {
      const parts = Object.entries(c.z).map(([cat, z]) => [cat, z * (w[cat] ?? 1)]);
      const score = parts.reduce((a, [, v]) => a + v, 0);
      const why = parts.filter(([, v]) => v > 0.3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat]) => CAT_LABEL[cat]);
      return { ...c, score, why };
    })
    .sort((a, b) => b.score - a.score);
  // 打者、投手分開列（打者類別多，混在一起投手永遠排不上來）
  const split = (list) => ({ B: list.filter((x) => x.p.side === 'B').slice(0, top), P: list.filter((x) => x.p.side === 'P').slice(0, top) });

  return {
    lists: { recent: split(rank(wRecent)), fit: split(rank(wFit)), opp: oppLine ? split(rank(wOpp)) : null },
    myLine, oppLine, typical, weights: { fit: wFit, opp: wOpp }, missing,
    swing: oppLine ? CATS.map((c) => [c, margin(c, myLine, oppLine) / scale(c, typical)]) : [],
    gaps: CATS.map((c) => [c, margin(c, myLine, typical) / scale(c, typical)]),
  };
}

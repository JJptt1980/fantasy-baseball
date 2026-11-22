// 選秀即時同步：把 Yahoo 的選秀結果對應到選秀表、算還差幾順位、推薦前 3 名、預測下一輪還剩誰
// 純計算，不碰畫面與網路；資料來源在 draft-source.js（可替換）
import { normName } from './pickup.js';
import { assign, fits } from './demo-sim.js';

export const TEAMS = 12;
export const ROUNDS = 25;

// 第 overall 順位（1 起算）是第幾輪、輪到第幾順位的隊伍（蛇形）
export function slotOf(overall, teams = TEAMS) {
  const round = Math.ceil(overall / teams);
  const k = (overall - 1) % teams;
  return { round, slot: round % 2 ? k + 1 : teams - k };
}

// 某順位（1~12）在 overall 之後（含）的下一個選秀位置
export function nextPickOf(slot, fromOverall, teams = TEAMS, rounds = ROUNDS) {
  for (let o = fromOverall; o <= teams * rounds; o++) if (slotOf(o, teams).slot === slot) return o;
  return null;
}

// Yahoo 名字 → 選秀表球員。「Shohei Ohtani (Batter)」看括號分打者／投手；同名同類選市場排名前面的
export function matchPlayer(name, board) {
  const side = /\(Pitcher\)/i.test(name) ? 'P' : /\(Batter\)/i.test(name) ? 'B' : null;
  const key = normName(name);
  const cands = board.filter((p) => normName(p.name) === key && (!side || p.side === side));
  return cands.sort((a, b) => (a.marketRank ?? 9999) - (b.marketRank ?? 9999))[0] ?? null;
}

// picks：[{ overall, round, pick, name, team }]；myTeam：Yahoo 隊名
export function draftState({ picks, board, myTeam, mySlot = null, teams = TEAMS, rounds = ROUNDS }) {
  const made = [...picks].sort((a, b) => a.overall - b.overall).map((pk) => ({ ...pk, player: matchPlayer(pk.name, board) }));
  const takenIds = new Set();
  const mine = [];
  for (const m of made) {
    if (!m.player) continue;
    takenIds.add(m.player.id);
    if (m.team === myTeam) mine.push(m.player);
  }
  // 我的順位：第 1 輪我選過就自動知道，否則用使用者設定的
  const myFirst = made.find((m) => m.team === myTeam && m.round === 1);
  const slot = myFirst ? myFirst.pick : mySlot;
  const nextOverall = made.length ? made.at(-1).overall + 1 : 1;
  const done = nextOverall > teams * rounds;
  const myNext = slot && !done ? nextPickOf(slot, nextOverall, teams, rounds) : null;
  const myAfter = myNext ? nextPickOf(slot, myNext + 1, teams, rounds) : null;
  return {
    made, takenIds, mine, slot, nextOverall, done,
    myNext, myAfter,
    picksUntil: myNext != null ? myNext - nextOverall : null, // 0 = 輪到你
    myPicksLeft: slot ? rounds - mine.length : null,
    unmatched: made.filter((m) => !m.player).map((m) => m.name),
  };
}

// 守位缺口（先發格子還缺哪些）
export function openSlots(myPlayers) {
  const out = [];
  for (const side of ['B', 'P']) {
    const a = assign(myPlayers, side);
    a.slots.forEach((sl, i) => { if (!a.filled[i]) out.push(sl); });
  }
  return out;
}

const CAT_LABEL = {
  'B:R': 'R', 'B:H': 'H', 'B:HR': 'HR', 'B:RBI': 'RBI', 'B:SB': 'SB', 'B:BB': 'BB', 'B:K': '打者K', 'B:AVG': 'AVG', 'B:OPS': 'OPS',
  'P:W': 'W', 'P:L': 'L', 'P:SV': 'SV', 'P:BB': '投手BB', 'P:K': '投手K', 'P:HLD': 'HLD', 'P:ERA': 'ERA', 'P:WHIP': 'WHIP', 'P:QS': 'QS',
};

// 類別需求：我已選的人每類 z 加總，跟「同樣人數的平均前段球員」比，落後越多權重越高
export function categoryNeeds(myPlayers, board) {
  const need = {};
  for (const side of ['B', 'P']) {
    const pool = board.filter((p) => p.side === side && p.z).slice(0, side === 'B' ? 160 : 140);
    const mineSide = myPlayers.filter((p) => p.side === side && p.z);
    const cats = Object.keys(pool[0]?.z ?? {});
    for (const c of cats) {
      const avg = pool.reduce((a, p) => a + p.z[c], 0) / pool.length;
      const have = mineSide.reduce((a, p) => a + p.z[c], 0);
      const expect = avg * mineSide.length;
      need[c] = Math.min(2, Math.max(0.5, 1 + (expect - have) / 3));
    }
  }
  return need;
}

// 前 n 推薦（附理由）：選秀表順序為底，加上守位缺口與類別平衡
export function recommend({ board, takenIds, myPlayers, picksUntil = 0, myPicksLeft = ROUNDS, n = 3 }) {
  const avail = board.filter((p) => !takenIds.has(p.id));
  const open = openSlots(myPlayers);
  const need = categoryNeeds(myPlayers, board);
  // 剩下的選擇數 ≤ 先發空格數 → 只能選補得上空格的人
  const mustFill = myPicksLeft != null && myPicksLeft <= open.length;
  // 急迫度：剩下的選擇越接近空格數，補空格越重要（避免最後幾輪被迫撿剩的）
  const urgency = myPicksLeft ? Math.max(0, open.length / myPicksLeft - 0.35) : 0;
  // 每種格子還缺幾個 vs 選秀池裡還剩幾個像樣的人 → 越稀缺越先補
  const scarce = {};
  for (const sl of new Set(open)) {
    const needN = open.filter((x) => x === sl).length;
    const supply = avail.slice(0, 150).filter((p) => fits(p, sl)).length;
    scarce[sl] = Math.min(2, (needN * 12) / Math.max(6, supply));
  }
  const scored = avail.slice(0, 120).map((p) => {
    const fills = open.filter((sl) => fits(p, sl));
    const fillSlot = fills.sort((a, b) => (scarce[b] ?? 0) - (scarce[a] ?? 0))[0];
    const catBonus = Object.entries(p.z ?? {}).reduce((a, [c, z]) => a + Math.max(0, z) * (need[c] - 1), 0);
    const fillBonus = fillSlot ? 1.2 + 4 * urgency + (scarce[fillSlot] ?? 0) * (0.5 + 2 * urgency) : -1.5 - 4 * urgency;
    const score = (p.value ?? 0) + 0.8 * catBonus + fillBonus;
    return { p, fillSlot, catBonus, score };
  }).filter((x) => !mustFill || x.fillSlot);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => {
    const reasons = [];
    if (x.fillSlot) reasons.push(`補先發空缺 ${x.fillSlot}`);
    else reasons.push('先發格子已滿，當板凳深度');
    const helps = Object.entries(x.p.z ?? {}).filter(([c, z]) => z > 0.3 && need[c] > 1.15).sort((a, b) => b[1] * need[b[0]] - a[1] * need[a[0]]).slice(0, 2).map(([c]) => CAT_LABEL[c]);
    if (helps.length) reasons.push(`補你偏弱的 ${helps.join('、')}`);
    reasons.push(`選秀表第 ${x.p.rank}（市場第 ${x.p.marketRank}）`);
    if (x.p.notes?.length) reasons.push(x.p.notes[0]);
    return { ...x, reasons };
  });
}

// 預測：再過 k 個順位（別人選）之後還剩誰。別人照市場排名選（可帶入對手習慣：之後再接）
export function predictAvailable({ board, takenIds, k }) {
  const avail = board.filter((p) => !takenIds.has(p.id));
  const byMarket = [...avail].sort((a, b) => (a.marketRank ?? 9999) - (b.marketRank ?? 9999));
  const gone = new Set(byMarket.slice(0, Math.max(0, k)).map((p) => p.id));
  const stay = avail.filter((p) => !gone.has(p.id));
  const goneList = avail.filter((p) => gone.has(p.id));
  return { stay, gone: goneList };
}

export { CAT_LABEL };

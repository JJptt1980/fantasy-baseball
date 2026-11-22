// 換人額度：整季上限先扣掉季後賽保留，剩下平均分到例行賽每一週
// 依據：本聯盟 10 年資料，冠軍在季後賽 3 週平均換 23 次；上限 100 次的年份，常有人例行賽就用完
export const PLAYOFF_RESERVE = 25;

// cap：整季上限；used：已用；week：目前週次；playoffWeeks：[24,25,26]；weekCap：每週上限（沒有就 null）
export function moveBudget({ cap, used, week, playoffWeeks, weekCap = null }) {
  if (!cap || !week) return null;
  const firstPO = playoffWeeks?.[0] ?? 24;
  const lastPO = playoffWeeks?.at(-1) ?? firstPO + 2;
  const regWeeks = firstPO - 1;
  const reserve = Math.min(PLAYOFF_RESERVE, Math.round(cap * 0.25));
  const left = Math.max(0, cap - used);
  const wcap = weekCap ?? Infinity;

  if (week >= firstPO) {
    const weeksLeft = Math.max(1, lastPO - week + 1);
    return {
      phase: 'playoff', cap, used, left, reserve, weeksLeft,
      thisWeek: Math.min(wcap, Math.ceil(left / weeksLeft)),
      level: left >= 8 ? 'ok' : left > 0 ? 'warn' : 'bad',
    };
  }
  const regLeft = Math.max(0, cap - reserve - used);
  const weeksLeft = Math.max(1, regWeeks - week + 1);
  const pace = Math.round(((cap - reserve) * (week - 1)) / regWeeks);
  const level = left < reserve ? 'bad' : used > pace + 8 ? 'warn' : 'ok';
  return {
    phase: 'regular', cap, used, left, reserve, regLeft, weeksLeft, pace, level,
    thisWeek: Math.min(wcap, Math.floor(regLeft / weeksLeft)),
  };
}

export function budgetMessage(b) {
  if (!b) return '';
  if (b.phase === 'playoff') {
    if (b.left === 0) return '整季額度已經用完，季後賽不能再換人。';
    return `季後賽：還剩 ${b.left} 次，平均每週可用 ${b.thisWeek} 次，盡量用在當週先發兩場的投手和拉鋸類別。`;
  }
  if (b.level === 'bad') return `已經動用到季後賽保留的額度：只剩 ${b.left} 次，進季後賽時不夠用（建議至少留 ${b.reserve} 次）。接下來只換傷兵。`;
  if (b.level === 'warn') return `用得比進度快：照進度現在應該用了約 ${b.pace} 次，你已經用了 ${b.used} 次。接下來幾週每週少換一點。`;
  return `照進度：例行賽還能用 ${b.regLeft} 次、還有 ${b.weeksLeft} 週，這週最多換 ${b.thisWeek} 次。`;
}

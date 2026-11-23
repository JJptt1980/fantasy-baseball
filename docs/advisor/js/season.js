// 開季日與休賽季判斷：開季日問 MLB 官方（一年問一次，存手機），問不到就用 3 月 25 日
const KEY = 'mlb.opening';
export function openingGuess(year) { return `${year}-03-25`; }
export function openingDay(year = new Date().getFullYear()) {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v?.year === year && v.date) return v.date; } catch { /* 略 */ }
  return openingGuess(year);
}
// 背景更新：有新的開季日就存起來
export async function refreshOpening(year = new Date().getFullYear()) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/seasons/${year}?sportId=1`);
    const d = (await r.json()).seasons?.[0]?.regularSeasonStartDate;
    if (d) localStorage.setItem(KEY, JSON.stringify({ year, date: d }));
    return d ?? null;
  } catch { return null; }
}
// 下一個開季日（今年已開季就看明年）
export function nextOpening(now = new Date()) {
  const y = now.getFullYear();
  const today = now.toISOString().slice(0, 10);
  const d = openingDay(y);
  return today < d ? d : (now.getMonth() >= 9 ? openingDay(y + 1) : null);
}
// 休賽季：10 月～隔年開季前
export function isOffseason(now = new Date()) { return nextOpening(now) != null; }
export function daysUntil(dateStr, now = new Date()) {
  const t = new Date(`${dateStr}T00:00:00`);
  return Math.max(0, Math.ceil((t - now) / 86400000));
}

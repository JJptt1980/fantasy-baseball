// 下載 MLB 官方 2026 逐週數據，整理成 Demo 用的精簡檔 docs/advisor/data/weekly-<年>.json
// 週次切法比照 Yahoo：第 1 週從開幕日到下下個週日之前的週日，之後每週一到週日
// 用法：node scripts/build-weekly.mjs [年份]
import { writeFileSync, mkdirSync } from 'node:fs';

const YEAR = Number(process.argv[2] ?? 2026);
const WEEKS = 26;
const API = 'https://statsapi.mlb.com/api/v1';
const HIT = 'atBats,plateAppearances,hits,runs,homeRuns,rbi,stolenBases,baseOnBalls,strikeOuts,ops';
const PIT = 'inningsPitched,wins,losses,saves,holds,baseOnBalls,strikeOuts,earnedRuns,hits,gamesStarted';

const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400e3);

async function json(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`讀取失敗 ${url}`);
}

const season = (await json(`${API}/seasons/${YEAR}?sportId=1`)).seasons[0];
const opening = new Date(season.regularSeasonStartDate);
// 第 1 週結束：開幕後第一個週日；開幕那週不滿一整週就併到下一週（Yahoo 的長第一週）
let end1 = addDays(opening, (7 - opening.getUTCDay()) % 7);
if ((end1 - opening) / 86400e3 < 6) end1 = addDays(end1, 7);
const weeks = [];
for (let w = 0; w < WEEKS; w++) {
  const start = w === 0 ? opening : addDays(end1, 1 + 7 * (w - 1));
  const end = w === 0 ? end1 : addDays(start, 6);
  weeks.push({ start: fmt(start), end: fmt(end) });
}

const ipOuts = (s) => { const [a, b] = String(s ?? '0').split('.'); return Number(a) * 3 + Number(b || 0); };
const players = {};

for (const [w, wk] of weeks.entries()) {
  for (const group of ['hitting', 'pitching']) {
    const fields = `stats,splits,player,id,fullName,position,abbreviation,stat,${group === 'hitting' ? HIT : PIT}`;
    const url = `${API}/stats?stats=byDateRange&group=${group}&startDate=${wk.start}&endDate=${wk.end}&season=${YEAR}&sportId=1&limit=3000&playerPool=ALL&fields=${fields}`;
    const splits = (await json(url)).stats?.[0]?.splits ?? [];
    for (const s of splits) {
      const st = s.stat;
      const side = group === 'hitting' ? 'B' : 'P';
      if (side === 'B' && s.position?.abbreviation === 'P') continue;
      const key = `${side}${s.player.id}`;
      const p = (players[key] ??= { n: s.player.fullName, pos: s.position?.abbreviation ?? '', w: Array(WEEKS).fill(0) });
      const row = side === 'B'
        ? [st.atBats, st.plateAppearances, st.hits, st.runs, st.homeRuns, st.rbi, st.stolenBases, st.baseOnBalls, st.strikeOuts, Math.round((Number(st.ops) || 0) * 1000)]
        : [ipOuts(st.inningsPitched), st.wins, st.losses, st.saves, st.holds, st.baseOnBalls, st.strikeOuts, st.earnedRuns, st.hits, st.gamesStarted];
      // 同一週轉隊會有兩筆 → 相加（OPS 用打席加權）
      const prev = p.w[w];
      if (prev && side === 'B') {
        const pa = prev[1] + row[1];
        const ops = pa ? Math.round((prev[9] * prev[1] + row[9] * row[1]) / pa) : 0;
        p.w[w] = prev.map((v, i) => (i === 9 ? ops : v + (row[i] ?? 0)));
      } else if (prev) {
        p.w[w] = prev.map((v, i) => v + (row[i] ?? 0));
      } else {
        p.w[w] = row.map((v) => v ?? 0);
      }
    }
  }
  process.stdout.write(`第 ${w + 1} 週 ${wk.start}～${wk.end} 完成\n`);
}

mkdirSync(new URL('../docs/advisor/data/', import.meta.url), { recursive: true });
const out = {
  year: YEAR,
  weeks,
  hitCols: ['AB', 'PA', 'H', 'R', 'HR', 'RBI', 'SB', 'BB', 'K', 'OPSx1000'],
  pitCols: ['outs', 'W', 'L', 'SV', 'HLD', 'BB', 'K', 'ER', 'H', 'GS'],
  players,
};
const file = new URL(`../docs/advisor/data/weekly-${YEAR}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(`已輸出 ${file.pathname}，球員 ${Object.keys(players).length} 人`);

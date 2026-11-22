// 解析 Yahoo Fantasy Baseball 網頁（Android App 帶使用者的 Yahoo 登入抓頁面時使用）
// 輸入都是 Document（呼叫端用 DOMParser 轉好），輸出格式和 yahoo-parse.js（API 版）一致。

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const NAV_TEXT = new Set(['', 'Overview', 'League', 'My Team']);

export function isLoginPage(url) {
  return /(^|\/\/)login\.yahoo\.com/.test(url || '');
}

// 首頁「My Teams and Leagues」→ 聯盟清單（含我的隊伍編號）
export function parseHome(doc) {
  const byKey = new Map();
  for (const a of doc.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(/^(?:https:\/\/baseball\.fantasysports\.yahoo\.com)?\/(\d{4})\/b1\/(\d+)(?:\/(\d+))?\/?$/);
    if (!m) continue;
    const [, season, id, teamId] = m;
    const key = `${season}/b1/${id}`;
    const l = byKey.get(key) ?? { key, season: Number(season), id, name: null, teamId: null, teamName: null };
    const t = text(a);
    if (teamId) {
      l.teamId ??= teamId;
      if (!NAV_TEXT.has(t)) l.teamName ??= t;
    } else if (!NAV_TEXT.has(t)) {
      l.name ??= t;
    }
    byKey.set(key, l);
  }
  const finished = /Final results|season is over/i.test(text(doc.body));
  return [...byKey.values()].map((l) => ({ ...l, name: l.name ?? `聯盟 ${l.id}`, isFinished: finished }));
}

// 打擊/投手分界：看到這些類別之後就算投手類別（BB、K 兩邊都有，要分開）
const PITCHING_START = /^(Innings Pitched|Wins|Earned Run Average|Saves|Quality Starts)$/;
// 無法從勝負推得方向時的備援（只影響「↓ 越低越好」的小箭頭）
const LOWER_BETTER = /^(Losses|Earned Run Average|\(Walks \+ Hits\)\/ ?Innings Pitched|Blown Saves|Caught Stealing|Grounded Into Double Plays|Errors)$/;

function num(s) {
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

function findStatTable(doc) {
  return [...doc.querySelectorAll('table')].find(
    (t) => t.tHead?.querySelector('th[title]') && t.tBodies[0]?.rows.length === 2,
  );
}

function parseTeamRow(tr, cols) {
  const cells = [...tr.cells];
  const a = [...(cells[0]?.querySelectorAll('a') ?? [])].find((x) => text(x));
  if (!a) return null; // 輪空：對手那列沒有隊伍
  const stats = {};
  const won = new Set();
  for (const c of cols) {
    const td = cells[c.index];
    stats[c.id] = text(td) || '-';
    if (td?.classList.contains('Bg-selected')) won.add(c.id);
  }
  return {
    key: (a.getAttribute('href').match(/\/b1\/\d+\/(\d+)/) || [])[1] ?? text(a),
    name: text(a),
    isMine: false,
    logo: cells[0].querySelector('img')?.getAttribute('src') ?? null,
    manager: null,
    stats,
    won,
    points: text(cells[cells.length - 1]),
  };
}

// 對戰頁 /YYYY/b1/<league>/matchup?week=N → { week, weeks, categories, matchup | null（輪空） }
export function parseMatchupPage(doc) {
  // 週次下拉選單
  const weekSelect = [...doc.querySelectorAll('select')].find((s) => [...s.options].some((o) => /week=\d+/.test(o.value)));
  const weeks = weekSelect ? [...weekSelect.options].map((o) => Number(o.value.match(/week=(\d+)/)?.[1])).filter(Boolean) : [];
  const selected = weekSelect?.options[weekSelect.selectedIndex];
  const week = Number(selected?.value.match(/week=(\d+)/)?.[1]) || null;

  // 該週日期（每日分頁連結上的 date=YYYY-MM-DD）
  const dates = [...doc.querySelectorAll('a[href*="date=20"]')]
    .map((a) => a.getAttribute('href').match(/date=(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean)
    .sort();

  const table = findStatTable(doc);
  if (!table) throw new Error('讀不到對戰表格（可能 Yahoo 改版了）');

  const cols = [];
  let pitching = false;
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    const raw = text(th);
    const title = th.getAttribute('title') || '';
    if (i === 0 || (!raw && !title)) return; // 第 0 欄隊名、最後空白欄是比數
    if (PITCHING_START.test(title)) pitching = true;
    const abbr = raw.replace(/\*$/, '');
    cols.push({
      index: i,
      id: `${pitching ? 'P' : 'B'}:${abbr}`,
      abbr,
      name: title || abbr,
      displayOnly: raw.endsWith('*'),
      positionType: pitching ? 'P' : 'B',
      higherBetter: !LOWER_BETTER.test(title),
    });
  });

  const [me, opp] = [...table.tBodies[0].rows].map((tr) => parseTeamRow(tr, cols));
  const categories = cols.map(({ index, ...c }) => c);
  const base = { week, weeks, weekStart: dates[0] ?? null, weekEnd: dates[dates.length - 1] ?? null, categories };
  if (!me || !opp) return { ...base, matchup: null };

  me.isMine = true;
  const statWinners = {};
  for (const c of categories) {
    if (c.displayOnly) continue;
    const w = me.won.has(c.id) ? me : opp.won.has(c.id) ? opp : null;
    statWinners[c.id] = w ? w.key : 'tie';
    // 用 Yahoo 標出的贏家反推「越大越好」還是「越小越好」
    const x = num(me.stats[c.id]);
    const y = num(opp.stats[c.id]);
    if (w && x !== null && y !== null && x !== y) c.higherBetter = (w === me) === x > y;
  }
  for (const t of [me, opp]) delete t.won;

  return {
    ...base,
    matchup: {
      week,
      weekStart: base.weekStart,
      weekEnd: base.weekEnd,
      status: null, // 由呼叫端依目前週次決定
      isPlayoffs: false,
      isConsolation: false,
      statWinners,
      teams: [me, opp],
    },
  };
}

// 球隊陣容頁 /YYYY/b1/<league>/<team> → [{ name, yahooId, slot, status, side }]
export function parseRoster(doc) {
  const out = [];
  for (const t of doc.querySelectorAll('table')) {
    const head = text(t.tHead);
    if (!/Pos/.test(head) || !/Batters|Pitchers/.test(head)) continue;
    const side = /Pitchers/.test(head) ? 'P' : 'B';
    for (const tr of t.tBodies[0]?.rows ?? []) {
      const a = tr.querySelector('a.name');
      if (!a) continue;
      out.push({
        name: text(a),
        yahooId: a.getAttribute('href')?.match(/players\/(\d+)/)?.[1] ?? null,
        slot: tr.querySelector('[data-pos]')?.getAttribute('data-pos') ?? text(tr.cells[0]),
        status: text(tr.querySelector('.player-status')),
        side,
      });
    }
  }
  return out;
}

// 球員清單頁 /b1/<league>/players?status=A… → 可撿的球員 [{ name, yahooId, status, side }]
export function parsePlayerList(doc) {
  const t = [...doc.querySelectorAll('table')].find((x) => /Batters|Pitchers/.test(text(x.tHead)) && x.tBodies[0]?.rows.length);
  if (!t) return [];
  const side = /Pitchers/.test(text(t.tHead)) ? 'P' : 'B';
  return [...t.tBodies[0].rows]
    .map((tr) => {
      const a = tr.querySelector('a.name');
      return a && {
        name: text(a),
        yahooId: a.getAttribute('href')?.match(/players\/(\d+)/)?.[1] ?? null,
        status: text(tr.querySelector('.player-status')),
        side,
      };
    })
    .filter(Boolean);
}

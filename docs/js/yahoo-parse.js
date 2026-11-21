// 把 Yahoo Fantasy API 的怪 JSON 轉成好用的物件
// Yahoo 慣例：
//   集合 → { "0": {...}, "1": {...}, "count": 2 }
//   資源 → [ [ {欄位}, {欄位}, [] ... ], { 子資源 } ]

// 取出集合裡的元素（依數字 key 排序）
export function items(coll) {
  if (!coll) return [];
  if (Array.isArray(coll)) return coll;
  return Object.keys(coll)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => a - b)
    .map((k) => coll[k]);
}

// 把 [ {a}, [ {b}, {c} ], {d} ] 攤平合併成 { a, b, c, d }
export function merge(x) {
  if (!Array.isArray(x)) return x && typeof x === 'object' ? x : {};
  const out = {};
  for (const el of x) {
    if (Array.isArray(el)) Object.assign(out, merge(el));
    else if (el && typeof el === 'object') Object.assign(out, el);
  }
  return out;
}

const fc = (json) => json?.fantasy_content ?? {};
const bool = (v) => v === 1 || v === '1' || v === true;
const int = (v) => (v == null || v === '' ? null : Number(v));

// games;game_codes=mlb;seasons=2026 → game_key（例如 "469"）
export function parseGameKey(json) {
  const first = items(fc(json).games)[0];
  const key = merge(first?.game).game_key;
  if (!key) throw new Error('找不到這個球季的 MLB game_key');
  return String(key);
}

function leagueMeta(m) {
  return {
    key: m.league_key,
    id: m.league_id,
    name: m.name,
    season: m.season,
    scoringType: m.scoring_type,
    numTeams: int(m.num_teams),
    currentWeek: int(m.current_week),
    startWeek: int(m.start_week),
    endWeek: int(m.end_week),
    isFinished: bool(m.is_finished),
    logo: m.logo_url || null,
    url: m.url || null,
  };
}

// users;use_login=1/games;game_keys=XXX/leagues → 聯盟清單
export function parseLeagues(json) {
  const out = [];
  for (const u of items(fc(json).users)) {
    const user = merge(u.user);
    for (const g of items(user.games)) {
      const game = merge(g.game);
      for (const l of items(game.leagues)) out.push(leagueMeta(merge(l.league)));
    }
  }
  return out;
}

// league/<key>/settings → 聯盟資訊 + 計分類別
export function parseSettings(json) {
  const league = merge(fc(json).league);
  const settings = merge(league.settings);
  const stats = settings.stat_categories?.stats ?? [];
  const categories = stats
    .map((s) => s.stat)
    .filter((s) => s && s.enabled !== '0' && s.enabled !== 0)
    .map((s) => ({
      id: String(s.stat_id),
      name: s.name,
      abbr: s.display_name || s.abbr || s.name,
      // sort_order "1" = 越大越好；"0" = 越小越好（ERA、WHIP…）
      higherBetter: String(s.sort_order) !== '0',
      displayOnly: bool(s.is_only_display_stat),
      positionType: s.position_type || null,
    }));
  return { ...leagueMeta(league), categories };
}

function parseTeam(teamArr) {
  const t = merge(teamArr);
  const stats = {};
  for (const s of t.team_stats?.stats ?? []) {
    if (s?.stat) stats[String(s.stat.stat_id)] = s.stat.value;
  }
  const mgr = items(t.managers)[0]?.manager ?? {};
  return {
    key: t.team_key,
    name: t.name,
    isMine: bool(t.is_owned_by_current_login),
    logo: items(t.team_logos)[0]?.team_logo?.url ?? null,
    manager: mgr.nickname ?? null,
    stats,
    points: t.team_points?.total ?? null,
  };
}

// league/<key>/scoreboard;week=N → 該週所有對戰
export function parseScoreboard(json) {
  const league = merge(fc(json).league);
  const sb = league.scoreboard ?? {};
  const coll = sb['0']?.matchups ?? sb.matchups;
  return items(coll).map(({ matchup: m }) => {
    const statWinners = {};
    for (const w of m.stat_winners ?? []) {
      const sw = w.stat_winner;
      if (sw) statWinners[String(sw.stat_id)] = bool(sw.is_tied) ? 'tie' : sw.winner_team_key;
    }
    const teamsColl = m['0']?.teams ?? m.teams;
    return {
      week: int(m.week),
      weekStart: m.week_start ?? null,
      weekEnd: m.week_end ?? null,
      status: m.status ?? null, // preevent / midevent / postevent
      isPlayoffs: bool(m.is_playoffs),
      isConsolation: bool(m.is_consolation),
      isTied: bool(m.is_tied),
      winnerTeamKey: m.winner_team_key ?? null,
      statWinners,
      teams: items(teamsColl).map((t) => parseTeam(t.team)),
    };
  });
}

// 找出我的對戰，並把我方排在 teams[0]
export function findMyMatchup(matchups) {
  const m = matchups.find((x) => x.teams.some((t) => t.isMine));
  if (!m) return null;
  const teams = [...m.teams].sort((a, b) => Number(b.isMine) - Number(a.isMine));
  return { ...m, teams };
}

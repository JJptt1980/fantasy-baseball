// 依 Yahoo Fantasy API（format=json）實際結構仿造的測試資料

export const gamesJson = {
  fantasy_content: {
    games: { 0: { game: [{ game_key: '469', game_id: '469', code: 'mlb', season: '2026' }] }, count: 1 },
  },
};

export const leaguesJson = {
  fantasy_content: {
    users: {
      0: {
        user: [
          { guid: 'ABC' },
          {
            games: {
              0: {
                game: [
                  { game_key: '469', code: 'mlb', season: '2026' },
                  {
                    leagues: {
                      0: { league: [{ league_key: '469.l.1111', league_id: '1111', name: '台灣好棒', scoring_type: 'head', num_teams: 12, current_week: 26, start_week: '1', end_week: '26', is_finished: 1, season: '2026' }] },
                      1: { league: [{ league_key: '469.l.2222', league_id: '2222', name: '積分聯盟', scoring_type: 'headpoint', num_teams: 10, current_week: 26, start_week: '1', end_week: '26', is_finished: 1, season: '2026' }] },
                      count: 2,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

const stat = (id, abbr, sort, extra = {}) => ({
  stat: { stat_id: id, enabled: '1', name: abbr, display_name: abbr, sort_order: sort, position_type: 'B', ...extra },
});

export const settingsJson = {
  fantasy_content: {
    league: [
      { league_key: '469.l.1111', name: '台灣好棒', scoring_type: 'head', current_week: 26, start_week: '1', end_week: '26', is_finished: 1 },
      {
        settings: [
          {
            stat_categories: {
              stats: [
                stat(60, 'H/AB', '1', { is_only_display_stat: '1' }),
                stat(7, 'R', '1'),
                stat(12, 'HR', '1'),
                stat(16, 'SB', '1'),
                stat(3, 'AVG', '1'),
                stat(28, 'W', '1', { position_type: 'P' }),
                stat(26, 'ERA', '0', { position_type: 'P' }),
                stat(27, 'WHIP', '0', { position_type: 'P' }),
                stat(99, 'OFF', '1', { enabled: '0' }),
              ],
            },
          },
        ],
      },
    ],
  },
};

const team = (key, name, mine, stats) => ({
  team: [
    [{ team_key: key }, { team_id: key.split('.').pop() }, { name }, [], mine ? { is_owned_by_current_login: 1 } : [], { managers: [{ manager: { nickname: `${name}主` } }] }],
    { team_stats: { coverage_type: 'week', stats: Object.entries(stats).map(([id, value]) => ({ stat: { stat_id: id, value } })) } },
  ],
});

export const scoreboardJson = {
  fantasy_content: {
    league: [
      { league_key: '469.l.1111' },
      {
        scoreboard: {
          0: {
            matchups: {
              0: {
                matchup: {
                  week: '5', week_start: '2026-04-27', week_end: '2026-05-03', status: 'postevent', is_playoffs: '0', is_consolation: '0',
                  stat_winners: [{ stat_winner: { stat_id: '26', is_tied: 1 } }],
                  0: { teams: { 0: team('469.l.1111.t.3', '別人', false, {}), 1: team('469.l.1111.t.4', '別人2', false, {}), count: 2 } },
                },
              },
              1: {
                matchup: {
                  week: '5', week_start: '2026-04-27', week_end: '2026-05-03', status: 'postevent', is_playoffs: '0', is_consolation: '0',
                  stat_winners: [{ stat_winner: { stat_id: '26', winner_team_key: '469.l.1111.t.1' } }],
                  0: {
                    teams: {
                      0: team('469.l.1111.t.2', '對手隊', false, { 60: '50/180', 7: '30', 12: '8', 16: '3', 3: '.278', 28: '4', 26: '-', 27: '1.20' }),
                      1: team('469.l.1111.t.1', '我的隊', true, { 60: '55/200', 7: '35', 12: '8', 16: '1', 3: '.275', 28: '5', 26: '-', 27: '1.10' }),
                      count: 2,
                    },
                  },
                },
              },
              count: 2,
            },
          },
          week: '5',
        },
      },
    ],
  },
};

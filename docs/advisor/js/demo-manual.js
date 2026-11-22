// 手動玩 2027：選秀、每週撿人、排先發都由使用者決定，App 給建議
// 存檔 = 亂數種子＋動作清單；讀檔時照順序重播一次（AI 的亂數順序完全一樣）
import { CATS, CAT_LABEL, teamLine, margin, scale } from './pickup.js';
import {
  rng, TEAMS, ROUNDS, REG_WEEKS, assign, fits, posGroup, bucketOf, makeWorld, lineupSlots, lineupW,
  weekStats, weekStatsReal, match, schedule, swap, aiMoves, newcomers, standings, pickupOptions, runSeason,
} from './demo-sim.js';

const BUDGET = 150;

export function createGame(players, { mySlot, profiles, seed, weekly }) {
  const r = rng(seed);
  const g = {
    seed, mySlot, phase: 'draft', actions: [],
    avail: new Map(players.map((p) => [p.id, p])),
    teams: Array.from({ length: TEAMS }, () => []),
    ai: [], pickIndex: 0, draftLog: [],
    world: null, freeAgents: null, sched: null, rec: null, week: 0, budget: BUDGET,
    overrides: new Map(), events: [], seeds: null, bracket: [], champ: null, aiTotal: 0,
  };
  const pool = r.shuffle([...(profiles ?? [])]);
  for (let t = 0; t < TEAMS; t++) if (t !== mySlot) g.ai[t] = pool.pop() ?? null;
  g.names = g.teams.map((_, i) => (i === mySlot ? '你' : g.ai[i]?.name ?? `電腦 ${i + 1}`));

  // ── 選秀 ──
  const turn = (i) => {
    const round = Math.floor(i / TEAMS) + 1;
    const k = i % TEAMS;
    return { round, pick: k + 1, team: round % 2 ? k : TEAMS - 1 - k, overall: i + 1 };
  };
  const cands = (t) => {
    const team = g.teams[t];
    const open = ['B', 'P'].flatMap((s) => { const a = assign(team, s); return a.slots.filter((_, i) => !a.filled[i]); });
    let c = [...g.avail.values()];
    if (ROUNDS - team.length <= open.length) c = c.filter((p) => open.some((sl) => fits(p, sl)));
    return { list: c.length ? c : [...g.avail.values()], open };
  };
  const take = (t, p) => {
    const tu = turn(g.pickIndex);
    g.teams[t].push(p);
    g.avail.delete(p.id);
    g.draftLog.push({ ...tu, team: t, player: p });
    g.pickIndex++;
  };
  const aiPick = (t, round) => {
    const prof = g.ai[t];
    const b = bucketOf(round);
    let best = Infinity;
    let pick = null;
    for (const c of cands(t).list) {
      let s = c.marketRank * r.lognorm(0.25);
      if (prof) {
        s /= prof.pref[b][posGroup(c)];
        if (prof.favTeam && c.team === prof.favTeam) s /= 1.3;
        if (prof.age && c.age) s *= 1 + (c.age - prof.age) * 0.01;
      }
      if (s < best) { best = s; pick = c; }
    }
    take(t, pick);
  };
  const runAI = () => {
    while (g.pickIndex < TEAMS * ROUNDS && turn(g.pickIndex).team !== mySlot) aiPick(turn(g.pickIndex).team, turn(g.pickIndex).round);
    if (g.pickIndex >= TEAMS * ROUNDS) startSeason();
  };
  g.turn = () => turn(g.pickIndex);
  g.draftOptions = () => {
    const { list, open } = cands(mySlot);
    const sorted = [...list].sort((a, b) => a.rank - b.rank);
    return { recommended: sorted.slice(0, 5), all: sorted, open };
  };
  g.draftPick = (id) => {
    if (g.phase !== 'draft') throw new Error('不在選秀階段');
    const p = g.draftOptions().all.find((x) => x.id === id);
    if (!p) throw new Error('這位球員不能選（已被選走或守位已滿）');
    g.actions.push(['pick', id]);
    take(mySlot, p);
    runAI();
  };
  g.autoDraftRest = () => { while (g.phase === 'draft') g.draftPick(g.draftOptions().recommended[0].id); };

  // ── 例行賽 ──
  function startSeason() {
    g.phase = 'season';
    g.world = makeWorld(players, weekly);
    g.freeAgents = g.avail;
    for (const p of newcomers(players, weekly)) g.freeAgents.set(p.id, p);
    g.sched = schedule(r);
    g.rec = g.teams.map(() => ({ w: 0, l: 0, t: 0, mw: 0, ml: 0 }));
  }
  const stats = (t, w) => {
    const lu = lineupW(g.teams[t], g.world, w, t === mySlot ? g.overrides : null);
    return g.world.real ? weekStatsReal(lu, g.world, w) : weekStats(lu, r);
  };
  const oppOf = (w) => {
    if (g.phase === 'season') {
      const pair = g.sched[w].find(([a, b]) => a === mySlot || b === mySlot);
      return pair[0] === mySlot ? pair[1] : pair[0];
    }
    const m = g.bracket.find((x) => x.week === w + 1 && (x.a === mySlot || x.b === mySlot) && x.winner == null);
    return m ? (m.a === mySlot ? m.b : m.a) : null;
  };
  g.opponent = () => oppOf(g.week);

  // 本週預覽：對手、各類預估勝率、撿人建議、我的先發
  g.preview = () => {
    const w = g.week;
    const opp = oppOf(w);
    const pk = pickupOptions(g.teams, g.freeAgents, mySlot, g.world, w);
    let cats = null;
    if (opp != null) {
      const me = teamLine(lineupW(g.teams[mySlot], g.world, w, g.overrides).map((p) => g.world.form(p, w)));
      const op = teamLine(lineupW(g.teams[opp], g.world, w).map((p) => g.world.form(p, w)));
      cats = CATS.map((c) => {
        const m = margin(c, me, op) / scale(c, pk.typical);
        return { cat: c, label: CAT_LABEL[c], me: me[c], opp: op[c], prob: 1 / (1 + Math.exp(-1.7 * m)) };
      });
    }
    return {
      week: w + 1, dates: weekly?.weeks?.[w] ?? null, opp, cats, weak: pk.weak,
      options: pk.options.filter((o) => o.gain > 0.005).slice(0, 8),
      lineup: lineupSlots(g.teams[mySlot], g.world, w, g.overrides),
      bench: g.teams[mySlot].filter((p) => !lineupW(g.teams[mySlot], g.world, w, g.overrides).includes(p)),
      form: (p) => g.world.score(p, w),
      recent: (p) => g.world.form(p, w),
    };
  };
  g.searchFA = (q = '', side = '') => {
    const w = g.week;
    return [...g.freeAgents.values()]
      .filter((p) => (!side || p.side === side) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => g.world.score(b, w) - g.world.score(a, w)).slice(0, 40);
  };
  g.move = (addId, dropId) => {
    if (g.budget <= 0) throw new Error('整季 150 次換人已用完');
    const add = g.freeAgents.get(addId);
    const drop = g.teams[mySlot].find((p) => p.id === dropId);
    if (!add || !drop) throw new Error('找不到這兩位球員');
    if (add.side !== drop.side) throw new Error('打者換打者、投手換投手');
    g.actions.push(['move', addId, dropId]);
    swap(g.teams[mySlot], g.freeAgents, drop, add);
    g.overrides.delete(dropId);
    g.budget--;
  };
  g.autoMoves = () => {
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const best = pickupOptions(g.teams, g.freeAgents, mySlot, g.world, g.week).options[0];
      if (!best || best.gain <= 0.05 || g.budget <= 0) break;
      g.move(best.add.id, best.drop.id);
      n++;
    }
    return n;
  };
  g.setLineup = (id, v) => {
    g.actions.push(['lineup', id, v]);
    if (v) g.overrides.set(id, v); else g.overrides.delete(id);
  };
  g.resetLineup = () => { g.actions.push(['resetLineup']); g.overrides.clear(); };

  g.playWeek = () => {
    g.actions.push(['play']);
    const w = g.week;
    g.aiTotal += aiMoves(g.teams, g.freeAgents, g.ai, mySlot, g.world, w, r);
    if (g.phase === 'season') {
      const games = [];
      for (const [a, b] of g.sched[w]) {
        const m = match(stats(a, w), stats(b, w));
        g.rec[a].w += m.w; g.rec[a].l += m.l; g.rec[a].t += m.t;
        g.rec[b].w += m.l; g.rec[b].l += m.w; g.rec[b].t += m.t;
        if (m.w > m.l) { g.rec[a].mw++; g.rec[b].ml++; } else if (m.l > m.w) { g.rec[b].mw++; g.rec[a].ml++; }
        games.push({ a, b, ...m });
      }
      const ev = { type: 'week', week: w + 1, games, myGame: games.find((x) => x.a === mySlot || x.b === mySlot), standings: standings(g.rec) };
      g.events.push(ev);
      g.week++;
      if (g.week >= REG_WEEKS) startPlayoffs();
      return ev;
    }
    // 季後賽週
    const res = [];
    for (const m of g.bracket.filter((x) => x.week === w + 1)) {
      const s = match(stats(m.a, w), stats(m.b, w));
      m.res = s;
      m.winner = s.w > s.l || (s.w === s.l && g.seeds.indexOf(m.a) < g.seeds.indexOf(m.b)) ? m.a : m.b;
      res.push(m);
    }
    if (w + 1 === 24) {
      const [q1, q2] = res;
      g.bracket.push({ week: 25, label: '四強', a: g.seeds[0], b: q2.winner }, { week: 25, label: '四強', a: g.seeds[1], b: q1.winner });
    } else if (w + 1 === 25) {
      g.bracket.push({ week: 26, label: '冠軍戰', a: res[0].winner, b: res[1].winner });
    } else {
      g.champ = res[0].winner;
      g.phase = 'done';
    }
    const ev = { type: 'playoff', week: w + 1, games: res };
    g.events.push(ev);
    g.week++;
    return ev;
  };
  function startPlayoffs() {
    g.phase = 'playoffs';
    g.seeds = standings(g.rec).map((x) => x.team);
    const s = g.seeds;
    g.bracket = [{ week: 24, label: '八強', a: s[2], b: s[5] }, { week: 24, label: '八強', a: s[3], b: s[4] }];
    // 1、2 種子第 24 週輪空
  }
  g.myRank = () => standings(g.rec).findIndex((x) => x.team === mySlot) + 1;
  g.alive = () => g.phase !== 'playoffs' || g.bracket.some((m) => m.winner == null && (m.a === mySlot || m.b === mySlot)) || [0, 1].includes(g.seeds.indexOf(mySlot)) && g.week === 23;
  g.autoRest = () => {
    while (g.phase !== 'done') {
      if (g.phase === 'draft') g.autoDraftRest();
      else { g.autoMoves(); g.resetLineup(); g.playWeek(); }
    }
  };
  // 同一個種子、同一個順位，全照 App 建議會打到第幾名
  g.compare = () => {
    const { events } = runSeason(players, { mySlot, profiles, seed, weekly });
    const end = events.at(-1);
    return { myRank: end.myRank, champ: end.champ === mySlot, champName: end.names[end.champ] };
  };
  g.serialize = () => ({ v: 1, seed, mySlot, actions: g.actions });

  runAI();
  return g;
}

// 讀檔：照動作清單重播
export function restoreGame(players, save, { profiles, weekly }) {
  const g = createGame(players, { mySlot: save.mySlot, profiles, seed: save.seed, weekly });
  for (const a of save.actions) {
    if (a[0] === 'pick') g.draftPick(a[1]);
    else if (a[0] === 'move') g.move(a[1], a[2]);
    else if (a[0] === 'lineup') g.setLineup(a[1], a[2]);
    else if (a[0] === 'resetLineup') g.resetLineup();
    else if (a[0] === 'play') g.playWeek();
  }
  return g;
}

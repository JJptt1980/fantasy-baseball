// 手動玩 2027：選秀、每週撿人、排先發都由使用者決定，App 給建議
// 存檔 = 亂數種子＋動作清單；讀檔時照順序重播一次（AI 的亂數順序完全一樣）
import { CATS, CAT_LABEL, teamLine, margin, scale } from './pickup.js';
import {
  rng, TEAMS, ROUNDS, REG_WEEKS, assign, fits, posGroup, bucketOf, makeWorld, lineupSlots, lineupW,
  weekStats, weekStatsReal, match, schedule, swap, aiMoves, newcomers, standings, pickupOptions, runSeason, holes, uniqueById,
} from './demo-sim.js';
import { recommend, predictAvailable, categoryNeeds } from './draft-sync.js';

const BUDGET = 150;
const IL_SLOTS = 2;
const ROSTER = 25;

export function createGame(players, { mySlot, profiles, seed, weekly, draftOnly = false }) {
  players = uniqueById(players);
  const r = rng(seed);
  const g = {
    seed, mySlot, phase: 'draft', actions: [],
    avail: new Map(players.map((p) => [p.id, p])),
    teams: Array.from({ length: TEAMS }, () => []),
    ai: [], pickIndex: 0, draftLog: [],
    world: null, freeAgents: null, sched: null, rec: null, week: 0, budget: BUDGET,
    overrides: new Map(), events: [], seeds: null, bracket: [], champ: null, aiTotal: 0,
    il: [], moveLog: [], preds: [],
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
    if (g.pickIndex >= TEAMS * ROUNDS) { if (draftOnly) g.phase = 'drafted'; else startSeason(); }
  };
  g.turn = () => turn(g.pickIndex);
  // 我的下一次順位（總第幾位，1 起算）；沒有了回 null
  const nextMine = (from) => {
    for (let i = from; i < TEAMS * ROUNDS; i++) if (turn(i).team === mySlot) return i + 1;
    return null;
  };
  // 推薦：選秀表順序為底＋守位缺口＋類別平衡（跟選秀即時同步同一套）；
  // 另外預測每位推薦到我下一次順位時還在不在（別人照市場排名選）
  g.draftOptions = () => {
    const { list, open } = cands(mySlot);
    const sorted = [...list].sort((a, b) => a.rank - b.rank);
    const mine = g.teams[mySlot];
    const left = ROUNDS - mine.length;
    const forced = left <= open.length;
    const takenIds = new Set(players.filter((p) => !g.avail.has(p.id)).map((p) => p.id));
    const next = nextMine(g.pickIndex + 1);
    const between = next ? next - (g.pickIndex + 1) - 1 : null;
    const pred = between != null ? predictAvailable({ board: sorted, takenIds: new Set(), k: between }) : null;
    const stayIds = pred ? new Set(pred.stay.map((p) => p.id)) : null;
    let recs = recommend({ board: players, takenIds, myPlayers: mine, myPicksLeft: left, n: 5 });
    if (recs.length < 5) {
      const have = new Set(recs.map((x) => x.p.id));
      recs = recs.concat(sorted.filter((p) => !have.has(p.id)).slice(0, 5 - recs.length).map((p) => ({ p, reasons: [] })));
    }
    const recommended = recs.map((x) => ({ ...x.p, recReasons: x.reasons, fillSlot: x.fillSlot ?? null, staysNext: stayIds ? stayIds.has(x.p.id) : null }));
    return { recommended, all: sorted, open, forced, left, next, between, needs: categoryNeeds(mine, players) };
  };
  g.draftPick = (id) => {
    if (g.phase !== 'draft') throw new Error('不在選秀階段');
    const p = cands(mySlot).list.find((x) => x.id === id);
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
    const team = g.teams[mySlot];
    return {
      week: w + 1, dates: weekly?.weeks?.[w] ?? null, opp, cats, weak: pk.weak,
      options: pk.options.filter((o) => o.gain > 0.005).slice(0, 8),
      room: ROSTER - team.length,
      injured: team.filter((p) => g.world.injured(p, w)),
      il: g.il.map((p) => ({ p, healthy: !g.world.injured(p, w) && g.world.played(p, Math.max(0, w - 1)) })),
      ilFree: IL_SLOTS - g.il.length,
      holesIf: (addId, dropId) => {
        const add = g.freeAgents.get(addId);
        const trial = team.map((p) => (p.id === dropId ? add : p));
        return holes(trial, g.world, w) - holes(team, g.world, w);
      },
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
    const team = g.teams[mySlot];
    const add = g.freeAgents.get(addId);
    if (!add) throw new Error('找不到這位自由球員');
    if (dropId == null) {
      if (team.length >= ROSTER) throw new Error('陣容已滿 25 人，要選一個人丟掉');
      g.actions.push(['move', addId, null]);
      team.push(add);
      g.freeAgents.delete(addId);
    } else {
      const drop = team.find((p) => p.id === dropId);
      if (!drop) throw new Error('找不到要丟的球員');
      if (add.side !== drop.side) throw new Error('打者換打者、投手換投手');
      g.actions.push(['move', addId, dropId]);
      swap(team, g.freeAgents, drop, add);
      g.overrides.delete(dropId);
    }
    g.moveLog.push({ add, dropId, week: g.week });
    g.budget--;
  };
  // 傷兵格：連兩週沒上場的人才能放進 IL；放進去後陣容空出一格可以只撿不丟
  g.toIL = (id) => {
    const team = g.teams[mySlot];
    const p = team.find((x) => x.id === id);
    if (!p) throw new Error('找不到這位球員');
    if (g.il.length >= IL_SLOTS) throw new Error('2 個 IL 格都滿了');
    if (!g.world.injured(p, g.week)) throw new Error('他最近有上場，不能放 IL');
    g.actions.push(['il', id]);
    team.splice(team.indexOf(p), 1);
    g.il.push(p);
    g.overrides.delete(id);
  };
  // 傷癒歸隊：陣容滿了就要丟一個人
  g.fromIL = (id, dropId) => {
    const team = g.teams[mySlot];
    const p = g.il.find((x) => x.id === id);
    if (!p) throw new Error('IL 裡沒有這位球員');
    if (team.length >= ROSTER) {
      const drop = team.find((x) => x.id === dropId);
      if (!drop) throw new Error('陣容已滿，要選一個人丟掉');
      team.splice(team.indexOf(drop), 1);
      g.freeAgents.set(drop.id, drop);
    }
    g.actions.push(['unil', id, dropId ?? null]);
    g.il.splice(g.il.indexOf(p), 1);
    team.push(p);
  };
  g.autoMoves = () => {
    let n = 0;
    const w = g.week;
    const team = g.teams[mySlot];
    // ① 傷癒的人從 IL 回來（丟近況最差的同類球員）
    for (const p of [...g.il]) {
      if (g.world.injured(p, w) || !g.world.played(p, Math.max(0, w - 1))) continue;
      const worst = team.filter((x) => x.side === p.side).sort((a, b) => g.world.score(a, w) - g.world.score(b, w))[0];
      if (team.length < ROSTER) g.fromIL(p.id, null);
      else if (worst && g.world.score(p, w) > g.world.score(worst, w)) g.fromIL(p.id, worst.id);
    }
    // ② 傷兵放進 IL
    for (const p of [...team].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))) {
      if (g.il.length < IL_SLOTS && g.world.injured(p, w)) g.toIL(p.id);
    }
    // ③ 空位補人、再換最多 2 次
    for (let k = 0; k < 4 && g.budget > 0; k++) {
      const best = pickupOptions(g.teams, g.freeAgents, mySlot, g.world, w).options[0];
      const roomLeft = ROSTER - team.length;
      if (!best || (best.drop && (best.score <= 0.05 || k - roomLeft >= 2))) break;
      if (!best.drop && best.gain <= 0) break;
      g.move(best.add.id, best.drop?.id ?? null);
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
    const predCats = g.opponent() != null ? g.preview().cats : null;
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
      const myGame = games.find((x) => x.a === mySlot || x.b === mySlot);
      const ev = { type: 'week', week: w + 1, games, myGame, standings: standings(g.rec), pred: track(predCats, myGame) };
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
    const mine = res.find((m) => m.a === mySlot || m.b === mySlot);
    const ev = { type: 'playoff', week: w + 1, games: res, pred: mine ? track(predCats, { ...mine.res, a: mine.a, b: mine.b }) : null };
    g.events.push(ev);
    g.week++;
    return ev;
  };
  // 預估命中：每類「預估勝率 > 50%」跟實際勝負對得上嗎（平手不算）
  function track(cats, game) {
    if (!cats || !game) return null;
    const meA = game.a === mySlot;
    let hit = 0;
    let n = 0;
    let pw = 0;
    for (const c of cats) {
      const r0 = game.cats[c.cat];
      const r = meA ? r0 : r0 === 'win' ? 'loss' : r0 === 'loss' ? 'win' : 'tie';
      if (c.prob > 0.5) pw++;
      if (r === 'tie') continue;
      n++;
      if ((c.prob > 0.5) === (r === 'win')) hit++;
    }
    const p = { hit, n, predWin: pw, predLoss: cats.length - pw };
    g.preds.push(p);
    return p;
  }

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
  // 季末回顧：在哪一輪被誰淘汰、選秀最賺／最虧、最佳撿人、預估命中率
  g.recap = () => {
    const total = (p, from = 0, to = 26) => { let s = 0; for (let w = from; w < to; w++) s += g.world.actScore(p, w); return s; };
    const lost = g.bracket.find((m) => m.winner != null && (m.a === mySlot || m.b === mySlot) && m.winner !== mySlot);
    const picks = g.draftLog.filter((x) => x.team === mySlot).map((x) => ({ ...x, total: total(x.player) }));
    const late = picks.filter((x) => x.round >= 6).sort((a, b) => b.total - a.total)[0];
    const early = picks.filter((x) => x.round <= 5).sort((a, b) => a.total - b.total)[0];
    const adds = g.moveLog.map((m) => {
      const dropped = g.moveLog.find((x) => x.dropId === m.add.id && x.week > m.week);
      return { ...m, total: total(m.add, m.week, dropped ? dropped.week : 26) };
    }).sort((a, b) => b.total - a.total);
    // 換成「整季表現在所有球員中前幾 %」（同打者或同投手比）
    const pool = [...g.teams.flat(), ...g.il, ...g.freeAgents.values()];
    const tot = new Map(pool.map((p) => [p, total(p)]));
    const pct = (p, v) => {
      const same = pool.filter((x) => x.side === p.side).map((x) => tot.get(x)).sort((a, b) => b - a);
      const rank = same.findIndex((x) => x <= v) + 1 || same.length;
      return Math.max(1, Math.round((rank / same.length) * 100));
    };
    for (const x of [late, early]) if (x) x.pct = pct(x.player, x.total);
    if (adds[0]) adds[0].pct = pct(adds[0].add, total(adds[0].add));
    const hit = g.preds.reduce((a, p) => a + p.hit, 0);
    const n = g.preds.reduce((a, p) => a + p.n, 0);
    return {
      seed: g.seeds?.indexOf(mySlot) + 1,
      out: lost ? { label: lost.label, by: lost.a === mySlot ? lost.b : lost.a, res: lost.res, a: lost.a } : null,
      missed: g.seeds && g.seeds.indexOf(mySlot) >= 6,
      steal: late, bust: early, bestAdd: adds[0] ?? null, accuracy: n ? hit / n : null,
    };
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
    else if (a[0] === 'il') g.toIL(a[1]);
    else if (a[0] === 'unil') g.fromIL(a[1], a[2]);
    else if (a[0] === 'lineup') g.setLineup(a[1], a[2]);
    else if (a[0] === 'resetLineup') g.resetLineup();
    else if (a[0] === 'play') g.playWeek();
  }
  return g;
}

"""West Bay Star 2027 模擬器：12 隊蛇形選秀 + 23 週 H2H 18 類別例行賽 + 6 隊季後賽。

用法：python3 -I sim/sim.py <players.json> [每組模擬季數]
球員價值以 2026 實際數據當作 2027 的預估（真正的 2027 預測要到春訓才有）。
"""
import json
import math
import random
import sys
from collections import defaultdict

BAT_CATS = ['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K', 'AVG', 'OPS']
PIT_CATS = ['W', 'L', 'SV', 'BB', 'K', 'HLD', 'ERA', 'WHIP', 'QS']
CATS = [('B', c) for c in BAT_CATS] + [('P', c) for c in PIT_CATS]
LOWER = {('B', 'K'), ('P', 'L'), ('P', 'BB'), ('P', 'ERA'), ('P', 'WHIP')}

# 先發格子：C 1B 2B 3B SS IF OF×5 Util ｜ SP×6 RP×3 P×2 ｜ BN×2
BAT_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'OF', 'OF', 'OF', 'OF', 'Util']
PIT_SLOTS = ['SP'] * 6 + ['RP'] * 3 + ['P', 'P']
ROUNDS = 25
TEAMS = 12
REG_WEEKS = 23
WEEKS = 26


def num(s):
    s = (s or '').replace(',', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def load(path):
    raw = json.load(open(path))
    elig = defaultdict(set)
    for pos, ids in raw['elig'].items():
        for i in ids:
            elig[i].add(pos)
    players = {}
    for side in ('B', 'P'):
        head = raw[side]['head']
        idx = {h.rstrip('*'): k for k, h in enumerate(head)}
        for r in raw[side]['rows']:
            if not r.get('id') or r['id'] in players and side == 'B':
                continue
            v = r['vals']
            g = lambda k: num(v[idx[k]]) if k in idx and idx[k] < len(v) else 0.0
            p = {'id': r['id'], 'name': r['name'], 'side': side,
                 'yahoo_rank': g('Current') or 9999, 'pre_rank': g('Pre-Season') or 9999}
            if side == 'B':
                hab = v[idx['H/AB']] if 'H/AB' in idx else '0/0'
                h, ab = (num(x) for x in hab.split('/')) if '/' in hab else (0, 0)
                p.update(AB=ab, H=h, R=g('R'), HR=g('HR'), RBI=g('RBI'), SB=g('SB'),
                         BB=g('BB'), K=g('K'), OPS=g('OPS'))
                p['pos'] = (elig[r['id']] & {'C', '1B', '2B', '3B', 'SS', 'OF'}) or {'Util'}
                if p['AB'] < 120:
                    continue
            else:
                ip_s = v[idx['IP']] if 'IP' in idx else '0'
                whole, _, frac = ip_s.partition('.')
                ip = num(whole) + (num(frac) / 3 if frac else 0)
                p.update(IP=ip, W=g('W'), L=g('L'), SV=g('SV'), BB=g('BB'), K=g('K'),
                         HLD=g('HLD'), QS=g('QS'), ERA=g('ERA'), WHIP=g('WHIP'))
                p['ER'] = p['ERA'] * ip / 9
                p['WH'] = p['WHIP'] * ip
                pos = elig[r['id']] & {'SP', 'RP'}
                p['pos'] = pos or ({'SP'} if p['QS'] > 3 else {'RP'})
                if ip < 25:
                    continue
            players[r['id']] = p
    return players


# ── 價值：每類別對「可用球員池」的 z 分數（比率類別按出賽量加權） ──

def contributions(p):
    """回傳 {類別: 對球隊的邊際貢獻}（越大越好；越小越好的類別已反轉）"""
    c = {}
    if p['side'] == 'B':
        for k in ('R', 'H', 'HR', 'RBI', 'SB', 'BB'):
            c[('B', k)] = p[k]
        c[('B', 'K')] = -p['K']
        c[('B', 'AVG')] = p['H'] - 0.250 * p['AB']
        c[('B', 'OPS')] = (p['OPS'] - 0.740) * (p['AB'] + p['BB'])
    else:
        for k in ('W', 'SV', 'K', 'HLD', 'QS'):
            c[('P', k)] = p[k]
        c[('P', 'L')] = -p['L']
        c[('P', 'BB')] = -p['BB']
        c[('P', 'ERA')] = (3.90 * p['IP'] / 9) - p['ER']
        c[('P', 'WHIP')] = 1.24 * p['IP'] - p['WH']
    return c


def zscores(players):
    pools = {'B': sorted((p for p in players.values() if p['side'] == 'B'), key=lambda p: p['yahoo_rank'])[:200],
             'P': sorted((p for p in players.values() if p['side'] == 'P'), key=lambda p: p['yahoo_rank'])[:180]}
    stats = {}
    for side, pool in pools.items():
        cs = [contributions(p) for p in pool]
        for cat in cs[0]:
            vals = [c[cat] for c in cs]
            m = sum(vals) / len(vals)
            sd = math.sqrt(sum((x - m) ** 2 for x in vals) / len(vals)) or 1
            stats[cat] = (m, sd)
    for p in players.values():
        p['z'] = {cat: (val - stats[cat][0]) / stats[cat][1] for cat, val in contributions(p).items()}


STRATEGIES = {
    '均衡（18 類全拚）': {},
    '放棄打者K': {('B', 'K'): 0.0},
    '放棄打者K＋重中繼救援': {('B', 'K'): 0.0, ('P', 'SV'): 1.6, ('P', 'HLD'): 1.8},
    '放棄打者K＋重中繼救援＋控球': {('B', 'K'): 0.0, ('P', 'SV'): 1.6, ('P', 'HLD'): 1.8,
                          ('P', 'BB'): 1.4, ('P', 'WHIP'): 1.3, ('P', 'ERA'): 1.2},
    '放棄SV/HLD（全先發）': {('P', 'SV'): 0.0, ('P', 'HLD'): 0.0, ('P', 'QS'): 1.4, ('P', 'W'): 1.3},
}


def value(p, weights):
    return sum(z * weights.get(cat, 1.0) for cat, z in p['z'].items())


# ── 選秀 ──

def can_fill(team, p):
    """還有沒有先發格子可以放這個人（板凳 2 格例外）"""
    slots = BAT_SLOTS if p['side'] == 'B' else PIT_SLOTS
    filled = assign(team, p['side'])
    open_slots = [s for s, who in zip(slots, filled) if who is None]
    return any(fits(p, s) for s in open_slots)


def fits(p, slot):
    if slot in ('Util',):
        return p['side'] == 'B'
    if slot == 'IF':
        return bool(p['pos'] & {'1B', '2B', '3B', 'SS'})
    if slot == 'P':
        return p['side'] == 'P'
    return slot in p['pos']


def assign(team, side):
    """貪婪把球員排進先發格子（先排守位最少的）"""
    slots = BAT_SLOTS if side == 'B' else PIT_SLOTS
    order = sorted(range(len(slots)), key=lambda i: {'C': 0, 'SS': 1, '2B': 2, '3B': 3, '1B': 4, 'SP': 0, 'RP': 1,
                                                        'OF': 5, 'IF': 6, 'Util': 7, 'P': 8}[slots[i]])
    filled = [None] * len(slots)
    used = set()
    roster = sorted((p for p in team if p['side'] == side), key=lambda p: -p.get('_v', 0))
    for i in order:
        for p in roster:
            if p['id'] not in used and fits(p, slots[i]):
                filled[i] = p
                used.add(p['id'])
                break
    return filled


def draft(players, my_slot, my_weights, rng):
    avail = dict(players)
    teams = [[] for _ in range(TEAMS)]
    # 電腦對手：照 Yahoo 排名（ADP）＋雜訊，各隊再帶一點偏好
    ai_noise = {t: {('P', 'SV'): rng.uniform(0.6, 1.6), ('P', 'HLD'): rng.uniform(0.2, 1.4)} for t in range(TEAMS)}
    for rnd in range(ROUNDS):
        order = range(TEAMS) if rnd % 2 == 0 else reversed(range(TEAMS))
        for t in order:
            team = teams[t]
            open_slots = [sl for side in ('B', 'P')
                          for sl, who in zip(BAT_SLOTS if side == 'B' else PIT_SLOTS, assign(team, side)) if who is None]
            picks_left = ROUNDS - len(team)
            if picks_left <= len(open_slots):
                cands = [p for p in avail.values() if any(fits(p, sl) for sl in open_slots)]
            else:
                cands = list(avail.values())
            if not cands:
                cands = list(avail.values())
            if t == my_slot:
                pick = max(cands, key=my_weights)
                pick['_v'] = 1000 - pick.get('my_order', 0)
            else:
                def score(p):
                    adp = p['yahoo_rank'] * rng.lognormvariate(0, 0.25)
                    pref = 1.0
                    if p['side'] == 'P' and p['SV'] > 10:
                        pref = ai_noise[t][('P', 'SV')]
                    if p['side'] == 'P' and p['HLD'] > 10:
                        pref = ai_noise[t][('P', 'HLD')]
                    return adp / pref
                pick = min(cands, key=score)
                pick['_v'] = 1000 - pick['yahoo_rank']
            team.append(pick)
            del avail[pick['id']]
    return teams


# ── 例行賽與季後賽 ──

def lineup(team):
    return [p for p in assign(team, 'B') if p] + [p for p in assign(team, 'P') if p]


def week_stats(lu, rng, frac):
    """一週：計數用 Poisson，打擊率用二項分佈，自責分/被上壘用 Poisson"""
    t = defaultdict(float)
    ab = h = ops_w = pa = ip = er = wh = 0.0
    for p in lu:
        if p['side'] == 'B':
            for k in ('R', 'HR', 'RBI', 'SB', 'BB', 'K'):
                t[('B', k)] += poisson(rng, p[k] * frac)
            a = max(0, round(rng.gauss(p['AB'] * frac, math.sqrt(p['AB'] * frac) * 0.5)))
            hits = binom(rng, a, p['H'] / p['AB'] if p['AB'] else 0)
            ab += a
            h += hits
            w = a + p['BB'] * frac
            pa += w
            ops_w += max(0, rng.gauss(p['OPS'], 0.9 / math.sqrt(max(w, 1)))) * w
        else:
            i = max(0.0, rng.gauss(p['IP'] * frac, math.sqrt(p['IP'] * frac) * 0.6))
            ip += i
            ratio = i / (p['IP'] * frac) if p['IP'] else 0
            er += poisson(rng, p['ER'] * frac * ratio)
            wh += poisson(rng, p['WH'] * frac * ratio)
            for k in ('W', 'L', 'SV', 'BB', 'K', 'HLD', 'QS'):
                t[('P', k)] += poisson(rng, p[k] * frac * (ratio if k in ('BB', 'K', 'QS', 'W', 'L') else 1))
    t[('B', 'H')] = h
    t[('B', 'AVG')] = h / ab if ab else 0
    t[('B', 'OPS')] = ops_w / pa if pa else 0
    t[('P', 'ERA')] = er * 9 / ip if ip else 99
    t[('P', 'WHIP')] = wh / ip if ip else 99
    return t


def poisson(rng, lam):
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def binom(rng, n, p):
    return sum(1 for _ in range(int(n)) if rng.random() < p) if n < 60 else max(0, round(rng.gauss(n * p, math.sqrt(n * p * (1 - p)))))


def match(a, b):
    w = l = t = 0
    for cat in CATS:
        x, y = a[cat], b[cat]
        if abs(x - y) < 1e-9:
            t += 1
        elif (x > y) != (cat in LOWER):
            w += 1
        else:
            l += 1
    return w, l, t


def schedule(rng):
    ids = list(range(TEAMS))
    rng.shuffle(ids)
    rounds = []
    for r in range(TEAMS - 1):
        rounds.append([(ids[i], ids[TEAMS - 1 - i]) for i in range(TEAMS // 2)])
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    sched = rounds + rounds
    return (sched + rounds)[:REG_WEEKS]


def season(teams, rng):
    lus = [lineup(t) for t in teams]
    frac = 1 / WEEKS
    rec = [[0, 0, 0] for _ in teams]
    cat_rec = defaultdict(lambda: [0, 0, 0])  # (隊, 類別) → 勝敗和
    for wk in schedule(rng):
        for a, b in wk:
            sa, sb = week_stats(lus[a], rng, frac), week_stats(lus[b], rng, frac)
            w, l, t = match(sa, sb)
            for i, v in enumerate((w, l, t)):
                rec[a][i] += v
            for i, v in enumerate((l, w, t)):
                rec[b][i] += v
            for cat in CATS:
                x, y = sa[cat], sb[cat]
                if abs(x - y) < 1e-9:
                    cat_rec[(a, cat)][2] += 1
                    cat_rec[(b, cat)][2] += 1
                else:
                    a_win = (x > y) != (cat in LOWER)
                    cat_rec[(a, cat)][0 if a_win else 1] += 1
                    cat_rec[(b, cat)][1 if a_win else 0] += 1
    pct = lambda r: (r[0] + 0.5 * r[2]) / max(1, sum(r))
    seeds = sorted(range(TEAMS), key=lambda i: -pct(rec[i]))
    # 季後賽：6 隊，1、2 種子首輪輪空
    def play(a, b):
        w, l, _ = match(week_stats(lus[a], rng, frac), week_stats(lus[b], rng, frac))
        return a if w > l or (w == l and seeds.index(a) < seeds.index(b)) else b
    s = seeds
    q1, q2 = play(s[2], s[5]), play(s[3], s[4])
    f1, f2 = play(s[0], q2), play(s[1], q1)
    champ = play(f1, f2)
    return {'rec': rec, 'seeds': seeds, 'champ': champ, 'cat_rec': cat_rec,
            'final': {f1, f2}}


def from_rank(d):
    """用 rank.py（MLB 官方資料）建立球員池與兩種排序：我的選秀表、市場排名"""
    import copy
    sys.path.insert(0, __file__.rsplit('/', 1)[0])
    import rank
    raw = rank.build(d)
    board = rank.board(copy.deepcopy(raw))
    players = {}
    for i, p in enumerate(board, 1):
        q = dict(p)
        q['id'] = str(p['id'])
        q['my_order'] = i
        q['yahoo_rank'] = p['market_rank']
        if p['side'] == 'B':
            q['pos'] = {'Util'} if p['pos'] == 'DH' else {p['pos']}
        else:
            q['pos'] = {p['pos']}
            q['ERA'] = p['ER'] * 9 / p['IP']
        players[q['id']] = q
    return players


def main():
    players = from_rank(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    zscores(players)
    order_key = {'我的選秀表': lambda p: -p['my_order'], '照市場排名選': lambda p: -p['yahoo_rank']}
    print(f'球員：打者 {sum(p["side"] == "B" for p in players.values())}、投手 {sum(p["side"] == "P" for p in players.values())}，每個順位跑 {n} 季')
    for name, key in order_key.items():
        champ = playoff = rank_sum = 0
        cat_tot = defaultdict(lambda: [0, 0, 0])
        for slot in range(TEAMS):
            for k in range(n):
                rng = random.Random(slot * 100003 + k)
                teams = draft(players, slot, key, rng)
                r = season(teams, rng)
                champ += r['champ'] == slot
                playoff += slot in r['seeds'][:6]
                rank_sum += r['seeds'].index(slot) + 1
                for cat in CATS:
                    for i in range(3):
                        cat_tot[cat][i] += r['cat_rec'][(slot, cat)][i]
        total = TEAMS * n
        print(f'{name:<10} 奪冠 {champ / total:6.1%}  進季後賽 {playoff / total:6.1%}  平均名次 {rank_sum / total:4.1f}')
        print('   各類別逐週勝率：' + '  '.join(f'{c[1]}{"(投)" if c[0] == "P" and c[1] in ("BB", "K") else ""} {cat_tot[c][0] / max(1, sum(cat_tot[c])):.0%}' for c in CATS), flush=True)


if __name__ == '__main__':
    main()

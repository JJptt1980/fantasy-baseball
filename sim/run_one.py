"""跑一組設定：python3 -I sim/run_one.py <資料夾> <每順位季數> <投手倍率|market> <SV權重>"""
import sys, random
from collections import defaultdict
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import rank, sim
d, n, ps, sv = sys.argv[1], int(sys.argv[2]), sys.argv[3], float(sys.argv[4])
market = ps == 'market'
PRESETS = {
    'bal': {},
    'bal_sv': {('P', 'SV'): 1.3},
    'bal_hld_ctl': {('P', 'HLD'): 1.3, ('P', 'BB'): 1.2, ('P', 'WHIP'): 1.1},
}
if ps.startswith('raw'):
    rank.USE_REPLACEMENT = False
    rank.STREAM_PENALTY = 0.0
    rank.WEIGHTS.clear()
    if ps == 'raw_sv':
        rank.WEIGHTS[('P', 'SV')] = 1.3
    if ps == 'raw_reach30':
        rank.MAX_REACH = 30
elif ps in PRESETS:
    rank.WEIGHTS.clear(); rank.WEIGHTS.update(PRESETS[ps])
elif not market:
    rank.PITCHER_SCALE = float(ps)
    rank.WEIGHTS[('P', 'SV')] = sv
players = sim.from_rank(d)
sim.zscores(players)
key = (lambda p: -p['yahoo_rank']) if market else (lambda p: -p['my_order'])
champ = playoff = rs = 0
cat = defaultdict(lambda: [0, 0, 0])
for slot in range(sim.TEAMS):
    for k in range(n):
        rng = random.Random(slot * 100003 + k)
        r = sim.season(sim.draft(players, slot, key, rng), rng)
        champ += r['champ'] == slot; playoff += slot in r['seeds'][:6]; rs += r['seeds'].index(slot) + 1
        for c in sim.CATS:
            for i in range(3):
                cat[c][i] += r['cat_rec'][(slot, c)][i]
t = sim.TEAMS * n
name = '市場排名' if market else (ps if ps in PRESETS or ps.startswith('raw') else f'投手倍率{ps} SV{sv}')
print(f'{name:<16} 奪冠 {champ/t:6.1%}  季後賽 {playoff/t:6.1%}  平均名次 {rs/t:4.1f}')
print('  ' + ' '.join(f'{c[0]}{c[1]}:{cat[c][0]/max(1,sum(cat[c])):.0%}' for c in sim.CATS))

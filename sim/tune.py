"""調校投手倍率與 SV 權重：每組設定跑完整模擬，看奪冠率"""
import sys, random
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import rank, sim
d, n = sys.argv[1], int(sys.argv[2])
for ps in (1.0, 1.4, 1.8, 2.2, 2.6):
    for sv in (1.5, 2.2):
        rank.PITCHER_SCALE = ps
        rank.WEIGHTS[('P', 'SV')] = sv
        players = sim.from_rank(d)
        sim.zscores(players)
        champ = playoff = rs = 0
        key = lambda p: -p['my_order']
        for slot in range(sim.TEAMS):
            for k in range(n):
                rng = random.Random(slot * 100003 + k)
                r = sim.season(sim.draft(players, slot, key, rng), rng)
                champ += r['champ'] == slot; playoff += slot in r['seeds'][:6]; rs += r['seeds'].index(slot) + 1
        t = sim.TEAMS * n
        print(f'投手倍率 {ps}  SV權重 {sv}  奪冠 {champ/t:6.1%}  季後賽 {playoff/t:6.1%}  平均名次 {rs/t:4.1f}', flush=True)

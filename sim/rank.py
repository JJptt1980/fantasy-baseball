"""依使用者勾選的方向，替 West Bay Star（12 隊、H2H 18 類別）排 2027 選秀順序表。

資料：MLB 官方公開 API（statsapi.mlb.com）2026、2025 季數據。
用法：python3 -I sim/rank.py <資料夾（含 hit.json pit.json hit25.json pit25.json）> <輸出 csv>
"""
import csv
import json
import math
import sys
from collections import defaultdict

# ── 定案設定（2026-11-22，依模擬結果）──
# 使用者勾選：火力路線、王牌＋控球、SV 優先、年輕上升股、避開傷病、捕手晚選、季中積極串流。
# 模擬（12 隊 × 30 季 × 各順位，對手照市場排名選）奪冠率：
#   火力＋放棄打者K 23.1%｜均衡＋SV 加重 25.0%｜照市場排名 29.7%｜均衡＋輕度偏好 30.8%（採用）
# 結論：18 類別 H2H 放棄任何類別都吃虧；守位替補扣分、先發打折都會讓投手太晚拿而拖累。
WEIGHTS = {}  # 18 個類別一樣重要
YOUNG_AGE = 26          # 2026 年齡 ≤ 26 視為上升股
YOUNG_BONUS = 0.08      # 價值 +8%
INJURY_PENALTY = 0.12   # 近兩季有一季出賽明顯不足 → 價值 -12%
CATCHER_PENALTY = 0.50  # 捕手晚選：價值再打五折
STREAM_SP_RANK = 45     # 第 45 名以後的先發打折（季中靠串流補）
STREAM_PENALTY = 0.0   # 模擬顯示先發打折會拖累，關掉；季中串流照做即可

# 每個守位的「替補水準」：12 隊 × 先發格數 + 一點板凳/IF/Util 分攤
REPLACEMENT_DEPTH = {'C': 13, '1B': 18, '2B': 18, '3B': 18, 'SS': 18, 'OF': 66, 'DH': 14, 'SP': 78, 'RP': 40}
OF = {'LF', 'CF', 'RF', 'OF'}


def ip_to_float(s):
    whole, _, frac = str(s).partition('.')
    return float(whole or 0) + (float(frac) / 3 if frac else 0)


def load(path):
    """同一球員季中轉隊會有多筆，合併成一筆"""
    out = {}
    for s in json.load(open(path))['stats'][0]['splits']:
        pid = s['player']['id']
        st = dict(s['stat'])
        if pid in out:
            prev = out[pid]['stat']
            for k, v in st.items():
                if isinstance(v, (int, float)) and k != 'age':
                    prev[k] = prev.get(k, 0) + v
            if 'inningsPitched' in st:
                prev['_ip'] = prev.get('_ip', 0) + ip_to_float(st['inningsPitched'])
            continue
        if 'inningsPitched' in st:
            st['_ip'] = ip_to_float(st['inningsPitched'])
        out[pid] = {'id': pid, 'name': s['player']['fullName'], 'pos': s['position']['abbreviation'],
                    'team': s.get('team', {}).get('name', ''), 'stat': st}
    return out


def est_qs(st):
    """MLB API 沒有 QS，用先發場次、每場局數、ERA 估計"""
    gs = st.get('gamesStarted', 0)
    if not gs:
        return 0.0
    ip_per = st['_ip'] / gs
    depth = min(1, max(0, (ip_per - 4.3) / 1.9))
    era = (st.get('earnedRuns', 0) * 9 / st['_ip']) if st['_ip'] else 9
    quality = min(1, max(0.15, (5.4 - era) / 2.6))
    return gs * depth * quality


def build(d):
    hit, pit = load(f'{d}/hit.json'), load(f'{d}/pit.json')
    hit25, pit25 = load(f'{d}/hit25.json'), load(f'{d}/pit25.json')
    players = []
    for pid, h in hit.items():
        st = h['stat']
        if st.get('atBats', 0) < 150 or h['pos'] == 'P':
            continue
        pos = 'OF' if h['pos'] in OF else h['pos']
        prev = hit25.get(pid, {}).get('stat', {})
        players.append({
            'id': pid, 'name': h['name'], 'team': h['team'], 'side': 'B', 'pos': pos, 'age': st.get('age'),
            'G': st.get('gamesPlayed', 0), 'G25': prev.get('gamesPlayed', 0),
            'AB': st['atBats'], 'PA': st.get('plateAppearances', st['atBats']),
            'R': st['runs'], 'H': st['hits'], 'HR': st['homeRuns'], 'RBI': st['rbi'], 'SB': st['stolenBases'],
            'BB': st['baseOnBalls'], 'K': st['strikeOuts'], 'AVG': st['hits'] / st['atBats'],
            'OPS': float(st.get('ops') or 0),
            'OPS25': float(prev.get('ops') or 0) if prev.get('atBats', 0) >= 150 else None,
        })
    for pid, p in pit.items():
        st = p['stat']
        ip = st.get('_ip', 0)
        if ip < 30:
            continue
        gs = st.get('gamesStarted', 0)
        prev = pit25.get(pid, {}).get('stat', {})
        players.append({
            'id': pid, 'name': p['name'], 'team': p['team'], 'side': 'P',
            'pos': 'SP' if gs >= 8 else 'RP', 'age': st.get('age'),
            'IP': ip, 'IP25': prev.get('_ip', 0), 'GS': gs,
            'W': st.get('wins', 0), 'L': st.get('losses', 0), 'SV': st.get('saves', 0),
            'HLD': st.get('holds', 0), 'BB': st.get('baseOnBalls', 0), 'K': st.get('strikeOuts', 0),
            'ER': st.get('earnedRuns', 0), 'WH': st.get('baseOnBalls', 0) + st.get('hits', 0),
            'QS': est_qs(st),
        })
    return players


def contributions(p):
    c = {}
    if p['side'] == 'B':
        for k in ('R', 'H', 'HR', 'RBI', 'SB', 'BB'):
            c[('B', k)] = p[k]
        c[('B', 'K')] = -p['K']
        c[('B', 'AVG')] = p['H'] - 0.250 * p['AB']
        c[('B', 'OPS')] = (p['OPS'] - 0.740) * p['PA']
    else:
        for k in ('W', 'SV', 'K', 'HLD', 'QS'):
            c[('P', k)] = p[k]
        c[('P', 'L')] = -p['L']
        c[('P', 'BB')] = -p['BB']
        c[('P', 'ERA')] = 3.90 * p['IP'] / 9 - p['ER']
        c[('P', 'WHIP')] = 1.24 * p['IP'] - p['WH']
    return c


def score(players, weights):
    for side, top in (('B', 220), ('P', 200)):
        pool = [p for p in players if p['side'] == side]
        # 先用簡單量排出前段球員當母體
        pool.sort(key=lambda p: -(p.get('PA', 0) * (p.get('OPS', 0) or 0) if side == 'B' else p['IP'] + 3 * p['SV'] + 2 * p['HLD']))
        base = pool[:top]
        cs = [contributions(p) for p in base]
        stat = {}
        for cat in cs[0]:
            vals = [c[cat] for c in cs]
            m = sum(vals) / len(vals)
            sd = math.sqrt(sum((x - m) ** 2 for x in vals) / len(vals)) or 1
            stat[cat] = (m, sd)
        for p in pool:
            p['z'] = {cat: (v - stat[cat][0]) / stat[cat][1] for cat, v in contributions(p).items()}
            p['raw'] = sum(z * weights.get(cat, 1.0) for cat, z in p['z'].items())
            if side == 'P' and weights is WEIGHTS:
                p['raw'] *= PITCHER_SCALE

    # 守位替補水準 → 價值 = 原始分數 − 該守位替補分數
    by_pos = defaultdict(list)
    for p in players:
        by_pos[p['pos']].append(p['raw'])
    repl = {}
    for pos, vals in by_pos.items():
        vals.sort(reverse=True)
        depth = REPLACEMENT_DEPTH.get(pos, 18)
        repl[pos] = vals[min(depth, len(vals) - 1)]
    # DH 只能放 Util，替補水準取所有打者守位中最高的
    repl['DH'] = max(repl[x] for x in ('C', '1B', '2B', '3B', 'SS', 'OF', 'DH') if x in repl)
    sp_sorted = sorted((p for p in players if p['pos'] == 'SP'), key=lambda p: -p['raw'])
    sp_rank = {p['id']: i + 1 for i, p in enumerate(sp_sorted)}

    for p in players:
        v = p['raw'] - (repl[p['pos']] if USE_REPLACEMENT else 0)
        notes = []
        if p['age'] and p['age'] <= YOUNG_AGE and v > 0:
            v *= 1 + YOUNG_BONUS
            notes.append('上升股')
        if p['side'] == 'B' and p.get('OPS25') and p['OPS'] - p['OPS25'] > 0.060 and p['age'] <= 28:
            notes.append(f'OPS 比 2025 進步 {p["OPS"] - p["OPS25"]:+.3f}')
        hurt = (p['side'] == 'B' and min(p['G'], p['G25'] or p['G']) < 110) or \
               (p['side'] == 'P' and p['pos'] == 'SP' and min(p['IP'], p['IP25'] or p['IP']) < 110)
        if p['age'] and p['age'] >= OLD_AGE and v > 0:
            v *= 1 - OLD_PENALTY
            notes.append('年紀偏大')
        if hurt and v > 0:
            v *= 1 - INJURY_PENALTY
            notes.append('近兩季出賽不足')
        if p['pos'] == 'C' and v > 0:
            v *= 1 - CATCHER_PENALTY
            notes.append('捕手晚選')
        if p['pos'] == 'SP' and sp_rank[p['id']] > STREAM_SP_RANK and v > 0:
            v *= 1 - STREAM_PENALTY
            notes.append('可季中串流')
        if p['side'] == 'B' and p['K'] / p['PA'] > 0.28 and p['AVG'] < 0.240:
            v -= 4.0
            notes.append('三振多＋打擊率低，避開')
        if p['side'] == 'P' and p['IP'] and p['BB'] * 9 / p['IP'] > 3.6:
            notes.append(f'保送偏多 BB/9 {p["BB"] * 9 / p["IP"]:.1f}')
        p['value'] = v
        p['notes'] = '、'.join(notes)
    return sorted(players, key=lambda p: -p['value'])


PITCHER_SCALE = 1.0  # 投手價值倍率（由模擬器調校）
USE_REPLACEMENT = False  # 扣守位替補水準在模擬中較差，關掉
OLD_AGE = 99          # 年齡 ≥ 此值打折（預設不用）
OLD_PENALTY = 0.0
KEY_TRANSFORM = None  # 策略用：調整選秀順序 f(p, key, sp_rank) → 新 key
MAX_REACH = 15  # 最多比市場排名提早幾順位選人（避免白白浪費前段順位）


def board(players):
    """市場排名＝不帶任何偏好的均衡價值排名；我的順序＝偏好價值，但不比市場提早超過 MAX_REACH 順位"""
    import copy
    market = score(copy.deepcopy(players), {})
    for p in market:
        p['value'] = p['raw'] - 0  # 不加偏好修正
    mrank = {(p['side'], p['id']): i + 1 for i, p in enumerate(sorted(market, key=lambda p: -(p['value'])))}  # 二刀流同編號，加上打/投
    mine = score(players, WEIGHTS)
    for i, p in enumerate(mine, 1):
        p['my_rank'] = i
        p['market_rank'] = mrank[(p['side'], p['id'])]
        p['key'] = max(i, mrank[(p['side'], p['id'])] - MAX_REACH)
    if KEY_TRANSFORM:
        sps = sorted((p for p in mine if p['pos'] == 'SP'), key=lambda p: -p['value'])
        sp_rank = {p['id']: i + 1 for i, p in enumerate(sps)}
        for p in mine:
            p['key'] = KEY_TRANSFORM(p, p['key'], sp_rank.get(p['id']))
    return sorted(mine, key=lambda p: (p['key'], -p['value']))


def main():
    d, out = sys.argv[1], sys.argv[2]
    players = board(build(d))
    with open(out, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['排名', '建議輪次', '市場排名', '球員', '守位', '球隊', '2026年齡', '價值',
                    'R', 'HR', 'RBI', 'SB', 'AVG', 'OPS', 'W', 'SV', 'HLD', 'K', 'ERA', 'WHIP', 'BB/9', 'IP', '備註'])
        for i, p in enumerate(players[:300], 1):
            b = p['side'] == 'B'
            w.writerow([i, math.ceil(i / 12), p['market_rank'], p['name'], p['pos'], p['team'], p['age'], f'{p["value"]:.2f}',
                        p['R'] if b else '', p['HR'] if b else '', p['RBI'] if b else '', p['SB'] if b else '',
                        f'{p["AVG"]:.3f}' if b else '', f'{p["OPS"]:.3f}' if b else '',
                        '' if b else p['W'], '' if b else p['SV'], '' if b else p['HLD'], '' if b else p['K'],
                        '' if b else f'{p["ER"] * 9 / p["IP"]:.2f}', '' if b else f'{p["WH"] / p["IP"]:.2f}',
                        '' if b else f'{p["BB"] * 9 / p["IP"]:.1f}', '' if b else f'{p["IP"]:.0f}', p['notes']])
    print(f'已輸出 {out}')
    for i, p in enumerate(players[:60], 1):
        print(f'{i:>3} R{math.ceil(i / 12):<2} 市{p["market_rank"]:<4} {p["name"]:<24} {p["pos"]:<3} {p["age"]} {p["value"]:6.2f}  {p["notes"]}')


if __name__ == '__main__':
    main()

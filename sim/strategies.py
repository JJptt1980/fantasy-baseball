"""10 套選秀流派（2026-11-22 設計），每套都是在「均衡＋輕度偏好」上做調整"""


def base(rank):
    rank.USE_REPLACEMENT = False
    rank.STREAM_PENALTY = 0.0
    rank.WEIGHTS.clear()
    rank.YOUNG_BONUS = 0.08
    rank.INJURY_PENALTY = 0.12
    rank.OLD_AGE, rank.OLD_PENALTY = 99, 0.0
    rank.KEY_TRANSFORM = None


def ace_core(rank):        # 王牌雙核：前 3 輪內鎖定 2 個頂級先發
    rank.KEY_TRANSFORM = lambda p, k, sr: min(k, 8 + 12 * (sr - 1)) if sr and sr <= 2 else k


def bats_first(rank):      # 打者先行：前 5 輪不拿投手
    rank.KEY_TRANSFORM = lambda p, k, sr: max(k, 61) if p['side'] == 'P' else k


def holds_king(rank):      # 中繼大戶：HLD 權重 ×2.2，壟斷中繼
    rank.WEIGHTS[('P', 'HLD')] = 2.2


def closer_monopoly(rank):  # 終結者壟斷：SV ×2.2，拿 3 個終結者
    rank.WEIGHTS[('P', 'SV')] = 2.2


def ratio_arms(rank):      # 比率派投手：ERA/WHIP/保送 ×1.6，三振 ×0.7
    rank.WEIGHTS.update({('P', 'ERA'): 1.6, ('P', 'WHIP'): 1.6, ('P', 'BB'): 1.6, ('P', 'K'): 0.7})


def speed_avg(rank):       # 速度＋打擊率：SB ×1.8、AVG ×1.4、H ×1.3
    rank.WEIGHTS.update({('B', 'SB'): 1.8, ('B', 'AVG'): 1.4, ('B', 'H'): 1.3})


def youth_movement(rank):  # 全押上升股：≤26 歲 +25%，≥32 歲 -15%
    rank.YOUNG_BONUS = 0.25
    rank.OLD_AGE, rank.OLD_PENALTY = 32, 0.15


def safe_vets(rank):       # 穩定牌：傷病 -30%，不加年輕分
    rank.YOUNG_BONUS = 0.0
    rank.INJURY_PENALTY = 0.30


def punt_sv(rank):         # 放棄 SV：SV 權重 0，資源全給先發與打者
    rank.WEIGHTS[('P', 'SV')] = 0.0


def punt_sb(rank):         # 放棄 SB：SB 權重 0，專拿火力與上壘
    rank.WEIGHTS[('B', 'SB')] = 0.0


STRATEGIES = {
    'ace_core': ('王牌雙核', ace_core),
    'bats_first': ('打者先行', bats_first),
    'holds_king': ('中繼大戶', holds_king),
    'closer_monopoly': ('終結者壟斷', closer_monopoly),
    'ratio_arms': ('比率派投手', ratio_arms),
    'speed_avg': ('速度＋打擊率', speed_avg),
    'youth_movement': ('全押上升股', youth_movement),
    'safe_vets': ('穩定牌', safe_vets),
    'punt_sv': ('放棄 SV', punt_sv),
    'punt_sb': ('放棄 SB', punt_sb),
}

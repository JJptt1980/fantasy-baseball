// 選秀流派（與 sim/strategies.py 對應）。sim = 模擬 360 季的奪冠率／進季後賽率（2026-11-22）
// 每個流派是在「均衡＋輕度偏好」上疊加的調整；勾多個就依序疊加（混合組合未經模擬）
export const BASE = { id: 'base', label: '均衡（預設）', sim: [30.8, 85], desc: '18 類一樣重要，模擬起來最強' };

export const STRATEGIES = [
  {
    id: 'youth_movement', label: '全押年輕人', sim: [26.7, 89], desc: '26 歲以下加很多分，32 歲以上扣分',
    apply: (c) => { c.youngBonus = 0.25; c.oldAge = 32; c.oldPenalty = 0.15; },
  },
  {
    id: 'bats_first', label: '先選打者', sim: [26.1, 85], desc: '前 5 輪都不選投手',
    apply: (c) => { const prev = c.keyTransform; c.keyTransform = (p, k, sr) => { k = prev ? prev(p, k, sr) : k; return p.side === 'P' ? Math.max(k, 61) : k; }; },
  },
  {
    id: 'safe_vets', label: '求穩', sim: [25.0, 84], desc: '常受傷的人扣更多分，年輕人不加分',
    apply: (c) => { c.youngBonus = 0; c.injuryPenalty = 0.3; },
  },
  {
    id: 'closer_monopoly', label: '搶救援投手', sim: [22.8, 81], desc: '救援（SV）看得特別重',
    apply: (c) => { c.weights['P:SV'] = 2.2; },
  },
  {
    id: 'punt_sv', label: '不要救援（SV）', sim: [21.7, 77], desc: '完全不選救援投手',
    apply: (c) => { c.weights['P:SV'] = 0; },
  },
  {
    id: 'ratio_arms', label: '投手少失分', sim: [20.3, 76], desc: '投手看 ERA、WHIP、少保送，三振比較不重要',
    apply: (c) => Object.assign(c.weights, { 'P:ERA': 1.6, 'P:WHIP': 1.6, 'P:BB': 1.6, 'P:K': 0.7 }),
  },
  {
    id: 'speed_avg', label: '跑得快＋打擊率高', sim: [19.2, 80], desc: '盜壘、打擊率、安打看得比較重',
    apply: (c) => Object.assign(c.weights, { 'B:SB': 1.8, 'B:AVG': 1.4, 'B:H': 1.3 }),
  },
  {
    id: 'holds_king', label: '搶中繼投手', sim: [17.8, 74], desc: '中繼（HLD）看得特別重',
    apply: (c) => { c.weights['P:HLD'] = 2.2; },
  },
  {
    id: 'punt_sb', label: '不要盜壘（SB）', sim: [11.9, 59], desc: '不管盜壘（模擬最差，不建議）',
    apply: (c) => { c.weights['B:SB'] = 0; },
  },
  {
    id: 'ace_core', label: '兩個王牌投手', sim: [30.8, 85], desc: '前 3 輪先拿 2 個最強的先發投手',
    apply: (c) => { const prev = c.keyTransform; c.keyTransform = (p, k, sr) => { k = prev ? prev(p, k, sr) : k; return sr && sr <= 2 ? Math.min(k, 8 + 12 * (sr - 1)) : k; }; },
  },
];

// 基本偏好開關（使用者勾選過的四項，預設全開）
export const PREFS = [
  { id: 'young', label: '年輕還在進步的加分', on: (c) => c, off: (c) => { c.youngBonus = 0; } },
  { id: 'injury', label: '常受傷的扣分', on: (c) => c, off: (c) => { c.injuryPenalty = 0; } },
  { id: 'catcher', label: '捕手晚點選', on: (c) => c, off: (c) => { c.catcherPenalty = 0; } },
  { id: 'avoidK', label: '常被三振、打擊率低的扣分', on: (c) => c, off: (c) => { c.avoidKPenalty = 0; } },
];

export function buildConfig(selected, prefsOn) {
  const c = { weights: {}, keyTransform: null };
  // 先關偏好，再疊流派（流派可覆寫偏好的數值）
  for (const p of PREFS) if (!prefsOn.has(p.id)) p.off(c);
  for (const s of STRATEGIES) if (selected.has(s.id)) s.apply(c);
  return c;
}

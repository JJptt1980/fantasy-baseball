// 選秀流派（與 sim/strategies.py 對應）。sim = 模擬 360 季的奪冠率／進季後賽率（2026-11-22）
// 每個流派是在「均衡＋輕度偏好」上疊加的調整；勾多個就依序疊加（混合組合未經模擬）
export const BASE = { id: 'base', label: '均衡＋輕度偏好', sim: [30.8, 85], desc: '18 類別一樣重要（模擬最強）' };

export const STRATEGIES = [
  {
    id: 'youth_movement', label: '全押上升股', sim: [26.7, 89], desc: '≤26 歲 +25%、≥32 歲 -15%',
    apply: (c) => { c.youngBonus = 0.25; c.oldAge = 32; c.oldPenalty = 0.15; },
  },
  {
    id: 'bats_first', label: '打者先行', sim: [26.1, 85], desc: '前 5 輪不拿投手',
    apply: (c) => { const prev = c.keyTransform; c.keyTransform = (p, k, sr) => { k = prev ? prev(p, k, sr) : k; return p.side === 'P' ? Math.max(k, 61) : k; }; },
  },
  {
    id: 'safe_vets', label: '穩定牌', sim: [25.0, 84], desc: '傷病 -30%、不加年輕分',
    apply: (c) => { c.youngBonus = 0; c.injuryPenalty = 0.3; },
  },
  {
    id: 'closer_monopoly', label: '終結者壟斷', sim: [22.8, 81], desc: 'SV ×2.2',
    apply: (c) => { c.weights['P:SV'] = 2.2; },
  },
  {
    id: 'punt_sv', label: '放棄 SV', sim: [21.7, 77], desc: '不拿終結者',
    apply: (c) => { c.weights['P:SV'] = 0; },
  },
  {
    id: 'ratio_arms', label: '比率派投手', sim: [20.3, 76], desc: 'ERA/WHIP/保送 ×1.6、三振 ×0.7',
    apply: (c) => Object.assign(c.weights, { 'P:ERA': 1.6, 'P:WHIP': 1.6, 'P:BB': 1.6, 'P:K': 0.7 }),
  },
  {
    id: 'speed_avg', label: '速度＋打擊率', sim: [19.2, 80], desc: 'SB ×1.8、AVG ×1.4、H ×1.3',
    apply: (c) => Object.assign(c.weights, { 'B:SB': 1.8, 'B:AVG': 1.4, 'B:H': 1.3 }),
  },
  {
    id: 'holds_king', label: '中繼大戶', sim: [17.8, 74], desc: 'HLD ×2.2',
    apply: (c) => { c.weights['P:HLD'] = 2.2; },
  },
  {
    id: 'punt_sb', label: '放棄 SB', sim: [11.9, 59], desc: '不追盜壘（模擬最差）',
    apply: (c) => { c.weights['B:SB'] = 0; },
  },
  {
    id: 'ace_core', label: '王牌雙核', sim: [30.8, 85], desc: '前 3 輪鎖 2 個頂級先發（目前的表本來就會）',
    apply: (c) => { const prev = c.keyTransform; c.keyTransform = (p, k, sr) => { k = prev ? prev(p, k, sr) : k; return sr && sr <= 2 ? Math.min(k, 8 + 12 * (sr - 1)) : k; }; },
  },
];

// 基本偏好開關（使用者勾選過的四項，預設全開）
export const PREFS = [
  { id: 'young', label: '年輕上升股加分', on: (c) => c, off: (c) => { c.youngBonus = 0; } },
  { id: 'injury', label: '避開傷病', on: (c) => c, off: (c) => { c.injuryPenalty = 0; } },
  { id: 'catcher', label: '捕手晚選', on: (c) => c, off: (c) => { c.catcherPenalty = 0; } },
  { id: 'avoidK', label: '避開三振多＋打擊率低', on: (c) => c, off: (c) => { c.avoidKPenalty = 0; } },
];

export function buildConfig(selected, prefsOn) {
  const c = { weights: {}, keyTransform: null };
  // 先關偏好，再疊流派（流派可覆寫偏好的數值）
  for (const p of PREFS) if (!prefsOn.has(p.id)) p.off(c);
  for (const s of STRATEGIES) if (selected.has(s.id)) s.apply(c);
  return c;
}

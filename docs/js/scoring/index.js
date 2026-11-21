// 依 Yahoo 的 scoring_type 選擇計分模組
// 每個模組都匯出：id、label、implemented、compute(ctx)
import * as h2hCategories from './h2h-categories.js';
import * as h2hPoints from './h2h-points.js';
import * as roto from './roto.js';

const SCORERS = {
  head: h2hCategories,
  headpoint: h2hPoints,
  roto,
};

export function getScorer(scoringType) {
  return SCORERS[scoringType] ?? null;
}

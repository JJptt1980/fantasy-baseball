// 選秀資料來源（可替換）：每個來源都有 poll() → { picks, live }
// ① Yahoo：讀聯盟的選秀結果頁（選秀進行中會不會即時更新，要在 2027 年 2～3 月用 Yahoo 模擬選秀驗證）
// ② 練習：把某一年的真實選秀結果，照時間一筆一筆「放出來」，當成正在進行的選秀
import * as Y from './yahoo-source.js';

export class RateLimited extends Error {}

export function yahooSource(league) {
  return {
    kind: 'yahoo',
    label: 'Yahoo 即時',
    async poll() {
      try {
        const picks = await Y.draftResults(league);
        return { picks, live: true };
      } catch (e) {
        // Yahoo 限速會回 999（Request denied）
        if (/999|denied/i.test(e.message)) throw new RateLimited('Yahoo 暫時擋下太頻繁的讀取（999），先暫停 2 分鐘');
        throw e;
      }
    },
  };
}

// 練習：secondsPerPick 秒放出一筆（真實選秀每順位 1 分鐘，練習加速）
export function replaySource(allPicks, { secondsPerPick = 4, startAt = 0 } = {}) {
  const sorted = [...allPicks].sort((a, b) => a.overall - b.overall);
  const t0 = Date.now() - startAt * secondsPerPick * 1000;
  let paused = false;
  let pausedAt = 0;
  let shift = 0;
  const count = () => Math.min(sorted.length, Math.floor(((paused ? pausedAt : Date.now()) - t0 - shift) / (secondsPerPick * 1000)));
  return {
    kind: 'replay',
    label: '練習（重播）',
    secondsPerPick,
    async poll() { return { picks: sorted.slice(0, Math.max(0, count())), live: false }; },
    pause() { if (!paused) { paused = true; pausedAt = Date.now(); } },
    resume() { if (paused) { shift += Date.now() - pausedAt; paused = false; } },
    get paused() { return paused; },
    total: sorted.length,
  };
}

// 輪詢間隔：離你很遠時慢、快輪到時快；失敗逐步拉長；被限速暫停 2 分鐘
export function nextDelay({ picksUntil, errors = 0, rateLimited = false, replay = false }) {
  if (rateLimited) return 120000;
  if (errors) return Math.min(120000, 10000 * 2 ** errors);
  if (replay) return 1000;
  if (picksUntil == null) return 30000;
  return picksUntil <= 3 ? 10000 : 45000;
}

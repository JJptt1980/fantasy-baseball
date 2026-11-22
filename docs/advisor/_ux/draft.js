// 模擬選秀室 100 場（新流程：點名字反白 → 按「選他」；別隊照節奏；重新開始開下一場）
const q1 = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const R = window.__dx = { done: 0, errors: [], issues: {}, turns: 0, myPicks: 0, wrongPick: 0, tapWhileWait: 0, tapWhileWaitPicked: 0, reportOk: 0, restartOk: 0, stuck: 0, genericOpp: 0, noStar: 0, btnHidden: 0, waitSec: [], running: true };
const issue = (k) => { R.issues[k] = (R.issues[k] ?? 0) + 1; };
window.addEventListener('error', (e) => R.errors.push(e.message));
window.addEventListener('unhandledrejection', (e) => R.errors.push(String(e.reason?.message ?? e.reason)));
const oe = console.error;
console.error = (...a) => { R.errors.push(a.map(String).join(' ').slice(0, 150)); oe(...a); };
const tap = (el) => { if (!el) return; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.click(); };
const myTurn = () => !!q1('.room-bar.me');
async function until(fn, ms) { const t = performance.now(); while (performance.now() - t < ms) { if (fn()) return true; await sleep(40); } return false; }

export async function run(n = 100, s0 = 5) {
  seed = s0;
  localStorage.setItem('mn.draftTipSkip', 'true');
  localStorage.setItem('mn.room', JSON.stringify({ clock: 60, speed: 0.15 }));
  for (let g = 0; g < n && R.running; g++) {
    q1('.tb[data-tab=more]').click(); q1('[data-goto=demo]').click(); q1('#demo-mode [data-mode=manual]').click();
    await sleep(100);
    // 上一場沒打完：用「重新開始」
    if (q1('[data-act=restart]')) { tap(q1('[data-act=restart]')); await sleep(150); tap(q1('[data-rs=yes]')); await sleep(150); if (!q1('#mn-start').hidden) R.restartOk++; else issue('重新開始沒有回到開始畫面'); }
    if (q1('[data-act=new]')) { tap(q1('[data-act=new]')); await sleep(100); }
    if (q1('#mn-start').hidden) { issue('找不到開始畫面'); continue; }
    q1('#mn-slot').value = String(Math.floor(rnd() * 12));
    tap(q1('#mn-new'));
    if (!(await until(() => q1('.room-bar'), 20000))) { issue('開局後沒出現選秀室'); R.stuck++; continue; }
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      // 等輪到我（別隊選人中：有時亂點球員、有時快轉）
      while (!myTurn() && q1('.room-bar')) {
        const r = rnd();
        if (r < 0.1) { const row = q1('#mn-body .pick-row'); if (row) { tap(row); R.tapWhileWait++; await sleep(50); if (myTurn() && q1('#toast')?.textContent.startsWith('選了')) R.tapWhileWaitPicked++; } }
        else if (r < 0.85) tap(q1('[data-act=roll-skip]'));
        await sleep(120);
        if (performance.now() - t0 > 20000) { issue('等太久沒輪到我'); R.stuck++; break; }
      }
      if (!myTurn()) break; // 選完了（成績單）
      R.waitSec.push((performance.now() - t0) / 1000);
      R.turns++;
      if (/電腦 \d/.test(q1('#mn-body').textContent)) R.genericOpp++;
      const rows = qa('#mn-recs .pick-row');
      if (!rows.length) R.noStar++;
      // 選人：點名字（有時點第 2、3 個）→ 按「選他」
      const pickIdx = rnd() < 0.7 ? 0 : Math.min(rows.length - 1, 1 + Math.floor(rnd() * 2));
      const want = rows[pickIdx];
      if (want) { tap(want); await sleep(40); }
      const go = q1('[data-act=pick-go]');
      if (!go) { R.btnHidden++; issue('輪到我卻沒有「選他」按鈕'); break; }
      const wantName = want?.querySelector('b')?.textContent;
      if (wantName && !go.textContent.includes(wantName)) R.wrongPick++;
      tap(go);
      R.myPicks++;
      await sleep(60);
      // 偶爾按復原
      if (rnd() < 0.05 && q1('#toast.show .toast-undo')) { tap(q1('#toast.show .toast-undo')); await sleep(80); }
    }
    await until(() => q1('[data-act=report-ok]'), 5000);
    if (q1('[data-act=report-ok]')) { R.reportOk++; tap(q1('[data-act=report-ok]')); } else issue('選完沒看到成績單');
    await sleep(100);
    R.done = g + 1;
  }
  R.running = false;
  return JSON.stringify(R);
}

// App 內更新（只有 Android App 裡有 window.Updater；瀏覽器預覽時整個不出現）
// 打開 App 自動查一次；有新版就在頂列下面跳一條「有新版本」，按了就下載、跳出安裝畫面
import { haptic, toast } from './ui-kit.js';

const U = () => window.Updater;
const st = () => { try { return JSON.parse(U().state()); } catch { return { phase: 'failed' }; } };
const mb = (n) => (n / 1048576).toFixed(1);

let timer = null;
let quiet = true; // 自動查的時候：已是最新版、沒網路都不吵

function render() {
  const s = st();
  const bar = document.getElementById('upd-bar');
  const line = document.getElementById('upd-status');
  const btn = document.getElementById('upd-check');
  const name = s.info?.versionName ?? '';
  if (s.phase === 'available') {
    bar.hidden = false;
    bar.innerHTML = `<button type="button" class="upd-go" id="upd-go"><b>有新版本 ${name}</b><span>${s.info?.notes ? s.info.notes : '按這裡更新'}</span></button><button type="button" class="upd-x" id="upd-x" aria-label="先不要">✕</button>`;
    if (line) line.textContent = `有新版本 ${name}`;
  } else if (s.phase === 'downloading') {
    bar.hidden = false;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : null;
    bar.innerHTML = `<div class="upd-go"><b>下載新版本 ${name}…</b><span>${pct != null ? `${pct}%（${mb(s.done)} / ${mb(s.total)} MB）` : `${mb(s.done)} MB`}</span></div>`;
    if (line) line.textContent = '下載中…';
  } else if (s.phase === 'uptodate') {
    bar.hidden = true;
    if (line) line.textContent = '已經是最新版';
    if (!quiet) toast('已經是最新版', { ms: 2000 });
  } else if (s.phase === 'failed') {
    bar.hidden = true;
    if (line) line.textContent = s.message || '檢查更新失敗';
    if (!quiet) toast(s.message || '檢查更新失敗，請確認有網路', { ms: 3000 });
  } else if (s.phase === 'checking') {
    if (line) line.textContent = '檢查中…';
  }
  if (btn) btn.disabled = s.phase === 'checking' || s.phase === 'downloading';
  if (s.message && s.phase === 'available' && !quiet) toast(s.message, { ms: 4000 });
  return s.phase;
}

function poll() {
  clearInterval(timer);
  timer = setInterval(() => {
    const ph = render();
    if (ph !== 'checking' && ph !== 'downloading') { clearInterval(timer); timer = null; }
  }, 500);
}

export function initUpdate() {
  if (!U()) return;
  try { const v = JSON.parse(U().version()); document.getElementById('app-ver').textContent = v.name ?? ''; } catch { /* 讀不到就留原本的字 */ }
  document.getElementById('upd-row').hidden = false;
  document.getElementById('upd-bar').addEventListener('click', (e) => {
    if (e.target.closest('#upd-x')) { haptic('tap'); document.getElementById('upd-bar').hidden = true; return; }
    if (e.target.closest('#upd-go') && st().phase === 'available') { haptic('tap'); quiet = false; U().install(); poll(); }
  });
  document.getElementById('upd-check').addEventListener('click', () => { haptic('tap'); quiet = false; U().check(); render(); poll(); });
  U().check();
  poll();
}

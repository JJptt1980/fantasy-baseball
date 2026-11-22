// 共用互動元件（Apple 風格）：震動、復原提示、底部詳情卡、左右滑、下拉更新、小折線、迷你長條、載入骨架
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 震動：每種事件一種節奏 ──
const HAPTIC = {
  tap: 8,                       // 一般點選、切換
  mark: 14,                     // 標記球員
  undo: [8, 40, 8],             // 復原
  success: [12, 60, 18],        // 完成（更新成功、選秀結束）
  warn: [30, 80, 30],           // 警告（超過額度）
  error: [60, 40, 60, 40, 60],  // 失敗
  soon: [200, 120, 200],        // 選秀：剩 2 順位
  now: [500, 200, 500, 200, 500], // 選秀：輪到你
};
export function haptic(kind = 'tap') {
  try { navigator.vibrate?.(HAPTIC[kind] ?? 10); } catch { /* 不支援就算了 */ }
}

// ── 復原提示（底部浮出，6 秒後消失） ──
let toastTimer = null;
export function toast(msg, { undo, ms = 6000 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="toast-undo">復原</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => el.classList.remove('show');
  toastTimer = setTimeout(hide, ms);
  if (undo) el.querySelector('.toast-undo').onclick = () => { hide(); haptic('undo'); undo(); };
}

// ── 底部詳情卡（點背景或往下拉關閉） ──
export function sheet(html, { onClose } = {}) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grip"></div><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(bg);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => bg.classList.add('show'));
  const box = bg.querySelector('.sheet');
  bg._onClose = onClose;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  // 從把手區往下拉關閉
  let y0 = null;
  box.addEventListener('touchstart', (e) => { y0 = box.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = Math.max(0, e.touches[0].clientY - y0);
    box.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    box.style.transform = '';
    y0 = null;
    if (dy > 90) closeSheet();
  });
  return box;
}
export function closeSheet() {
  const bg = document.querySelector('.sheet-bg');
  if (!bg) return;
  bg.remove();
  document.body.classList.remove('no-scroll');
  bg._onClose?.();
}

// ── 列表左右滑：右滑 onRight、左滑 onLeft（各有底色提示） ──
export function swipeRows(list, rowSel, { right, left }) {
  let cur = null;
  list.addEventListener('touchstart', (e) => {
    const row = e.target.closest(rowSel);
    if (!row || e.target.closest('button, input, select, textarea, a')) return;
    cur = { row, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, dir: null };
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!cur) return;
    const dx = e.touches[0].clientX - cur.x0;
    const dy = e.touches[0].clientY - cur.y0;
    if (!cur.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      cur.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
      if (cur.dir === 'h') cur.row.classList.add('swiping');
    }
    if (cur.dir !== 'h') return;
    cur.dx = Math.max(-140, Math.min(140, dx));
    cur.row.style.transform = `translateX(${cur.dx}px)`;
    cur.row.dataset.swipe = cur.dx > 0 ? 'right' : 'left';
    const armed = Math.abs(cur.dx) > 80;
    if (armed !== cur.armed) { cur.armed = armed; if (armed) haptic('tap'); }
    cur.row.classList.toggle('armed', armed);
  }, { passive: true });
  const end = () => {
    if (!cur) return;
    const { row, dx, dir } = cur;
    cur = null;
    if (dir !== 'h') return;
    row.style.transform = '';
    row.classList.remove('swiping', 'armed');
    delete row.dataset.swipe;
    row.dataset.justSwiped = '1';
    setTimeout(() => delete row.dataset.justSwiped, 350);
    if (dx > 80) right?.(row); else if (dx < -80) left?.(row);
  };
  list.addEventListener('touchend', end);
  list.addEventListener('touchcancel', end);
}

// ── 下拉更新（頁面在最上面時往下拉 70px） ──
export function pullToRefresh(section, run) {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.innerHTML = '<span class="ptr-spin"></span><span class="ptr-t">下拉更新</span>';
  section.prepend(ind);
  let y0 = null;
  let dy = 0;
  let busy = false;
  section.addEventListener('touchstart', (e) => {
    if (busy || window.scrollY > 0 || document.body.classList.contains('no-scroll')) { y0 = null; return; }
    y0 = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  section.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { ind.style.height = '0px'; return; }
    const h = Math.min(80, dy * 0.5);
    ind.style.height = `${h}px`;
    ind.classList.toggle('ready', dy > 70 * 2);
    ind.querySelector('.ptr-t').textContent = dy > 140 ? '放開更新' : '下拉更新';
  }, { passive: true });
  section.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > 140) {
      busy = true;
      ind.classList.add('busy');
      ind.style.height = '44px';
      ind.querySelector('.ptr-t').textContent = '更新中…';
      haptic('tap');
      try { await run(); haptic('success'); } catch { haptic('error'); }
      busy = false;
      ind.classList.remove('busy', 'ready');
    }
    ind.style.height = '0px';
  });
}

// ── 小折線（SVG）；values 可含 null（沒上場）；higherBetter=false 時線往下才是好 ──
export function sparkline(values, { w = 120, h = 32, higherBetter = true, label = '' } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) return '<span class="muted small">資料不足</span>';
  const vs = pts.map(([, v]) => v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const n = values.length - 1 || 1;
  const X = (i) => 2 + (i / n) * (w - 4);
  const Y = (v) => { const t = (v - lo) / (hi - lo); return 2 + (higherBetter ? 1 - t : t) * (h - 4); };
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(li).toFixed(1)}" cy="${Y(lv).toFixed(1)}" r="2.6" fill="currentColor"/></svg>`;
}

// ── 迷你長條：rows = [{ label, pct(0~1), text, cls }] ──
export function miniBars(rows) {
  return `<div class="mbars">${rows.map((r) => `<div class="mb"><span class="mb-l">${esc(r.label)}</span><span class="mb-t"><i class="${r.cls ?? ''}" style="width:${Math.round(Math.max(0.03, Math.min(1, r.pct)) * 100)}%"></i></span><span class="mb-v">${esc(r.text ?? '')}</span></div>`).join('')}</div>`;
}

// ── 載入骨架 ──
export function skeleton(n = 6, cls = 'sk-row') {
  return Array.from({ length: n }, () => `<li class="${cls}"><i></i><b></b></li>`).join('');
}

// 常態分布累積機率（z → 前百分之幾）
export function zPct(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

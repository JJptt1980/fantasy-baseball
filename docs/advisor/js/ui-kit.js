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
  // 點畫面其他地方 → 收起來（不要擋到下一個要按的東西）
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (el.contains(e.target)) return;
    hide();
    document.removeEventListener('pointerdown', off, true);
  }, true), 0);
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

// ── 一致的線條圖示（跟底部分頁同一套：24 格、線寬 1.8、圓角線頭）──
const P = {
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  skip: '<path d="M5 6l8 6-8 6zM13 6l8 6-8 6z"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.7-2.3L4 15.5a1.5 1.5 0 0 1 2.3-1.9L9 16"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  game: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-3-9-2 1.5-3 3.5-3 5-1-1-1.5-2-1.5-3C7.5 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  bandage: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M11 11h.01M13 13h.01M11 13h.01M13 11h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
};
// icon('sync')；fill＝實心（星星、播放）
export const icon = (name, { fill = false, cls = '' } = {}) =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${P[name] ?? ''}</svg>`;
export const stars = (n) => `<span class="stars" aria-label="${n} 顆星">${Array.from({ length: 3 }, (_, i) => icon('star', { fill: true, cls: i < n ? 'on' : 'off' })).join('')}</span>`;

// 選到人時的勾勾（小驚喜：中間跳出一個勾，0.7 秒自己消失）
export function checkPop() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'check-pop';
  el.innerHTML = icon('check');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

// 數字平滑跳到目標值（小驚喜）
export function countUp(root = document) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count);
    if (!Number.isFinite(to)) continue;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 600);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

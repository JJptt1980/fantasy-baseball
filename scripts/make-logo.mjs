// 畫 App logo（A2-Y2 深葡萄紫：菱形內野＋成長折線）→ Android 圖示與網頁圖示
// 不需要任何套件；4×4 超取樣做反鋸齒。設計稿：assets/logo.svg（座標都是 1024×1024）
// 用法：node scripts/make-logo.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };

const hex = (h, a = 1) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const DIAMOND = [[512, 210], [814, 512], [512, 814], [210, 512]];
const LINE = [[330, 620], [450, 540], [560, 575], [700, 400]];

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const inDiamond = (x, y) => Math.abs(x - 512) + Math.abs(y - 512) <= 302;
const polyDist = (x, y, pts, closed) => {
  let d = Infinity;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) d = Math.min(d, segDist(x, y, pts[i], pts[(i + 1) % pts.length]));
  return d;
};

// 一個點的顏色（RGBA 0~255、alpha 0~1），疊圖順序跟 SVG 一樣
function sample(x, y, withBg) {
  let c = withBg ? (() => { const t = (x + y) / 2048; const a = hex('#6001D2'), b = hex('#39007D'); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1]; })() : [0, 0, 0, 0];
  const over = (src) => {
    const a = src[3] + c[3] * (1 - src[3]);
    if (a === 0) { c = [0, 0, 0, 0]; return; }
    c = [0, 1, 2].map((i) => (src[i] * src[3] + c[i] * c[3] * (1 - src[3])) / a).concat(a);
  };
  if (inDiamond(x, y)) over(hex('#907CFF', 0.18));
  if (polyDist(x, y, DIAMOND, true) <= 15) over(hex('#C9BEFF'));
  if (polyDist(x, y, LINE, false) <= 23) over(hex('#FFFFFF'));
  const r = Math.hypot(x - 700, y - 400);
  if (r <= 40) over(hex('#FFA700'));
  if (r >= 31 && r <= 49) over(hex('#FFFFFF'));
  return c;
}

// scale：內容縮放（自適應前景要留安全區）；size：輸出像素
function render(size, { withBg = true, scale = 1 } = {}) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((px + (sx + 0.5) / SS) / size) * 1024;
        const v = ((py + (sy + 0.5) / SS) / size) * 1024;
        const x = 512 + (u - 512) / scale;
        const y = 512 + (v - 512) / scale;
        const c = sample(x, y, withBg);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const root = new URL('../', import.meta.url);
const out = (rel, buf) => { const u = new URL(rel, root); mkdirSync(new URL('./', u), { recursive: true }); writeFileSync(u, buf); console.log('已產生', rel); };

// 網頁圖示
out('docs/icons/icon-192.png', render(192));
out('docs/icons/icon-512.png', render(512));
out('docs/icons/apple-touch-icon.png', render(180));
out('assets/logo-1024.png', render(1024));

// Android：舊式圖示（各密度）＋ 自適應圖示（前景透明、背景漸層；前景縮到 72% 放進安全區）
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const res = `android/app/src/main/res/mipmap-${d}/`;
  out(`${res}ic_launcher.png`, render(Math.round(48 * k)));
  out(`${res}ic_launcher_fg.png`, render(Math.round(108 * k), { withBg: false, scale: 0.72 }));
  out(`${res}ic_launcher_bg.png`, render(Math.round(108 * k), { withBg: true, scale: 100 }));
}

// 資料包：把手機裡的資料存成一個檔案，可以匯入另一支手機；App 也會內建一份（打開就有，不用等 Yahoo 慢慢讀）
// 不含任何密碼、金鑰（FantasyPros 金鑰不會放進來）
export const PACK_KEYS = {
  'demo.profiles': '10 年對手選秀習慣',
  'adp.league': '聯盟近兩年選秀順位',
  'adv.marks': '選秀表的我選／被選',
  'adv.notes': '我的筆記',
  'adv.strategies': '選秀風格',
  'adv.prefs': '選秀小調整',
  'demo.manual.save': 'Demo 存檔',
  'pk.picks': '撿人勾選',
  'pk.wants': '撿人「我想要」',
};
const TYPE = 'xuanxiu-pack';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

export function makePack() {
  const items = {};
  for (const k of Object.keys(PACK_KEYS)) { const v = ls.get(k); if (v != null) items[k] = v; }
  return { type: TYPE, v: 1, created: new Date().toISOString(), items };
}

// 回傳寫進去的項目名稱；onlyMissing＝只補手機裡還沒有的（內建資料包用）
export function applyPack(pack, { onlyMissing = false } = {}) {
  if (!pack || pack.type !== TYPE || typeof pack.items !== 'object') throw new Error('這不是選秀大師的資料包');
  const done = [];
  for (const [k, v] of Object.entries(pack.items)) {
    if (!(k in PACK_KEYS) || typeof v !== 'string') continue;
    if (onlyMissing && ls.get(k) != null) continue;
    if (ls.set(k, v)) done.push(k);
  }
  return done;
}

// App 內建的資料包（編譯時從 data/private/pack.json 打包，不進 git）
export async function seedBundled() {
  try {
    const r = await fetch('data/private/pack.json');
    if (!r.ok) return [];
    return applyPack(await r.json(), { onlyMissing: true });
  } catch { return []; }
}

// 匯出：App 裡用系統「存檔」畫面；電腦瀏覽器直接下載
export function exportPack() {
  const text = JSON.stringify(makePack());
  const name = `選秀大師資料包-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.FileBridge) { window.FileBridge.saveText(name, text); return 'app'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'browser';
}

// 匯入：App 裡用系統「選檔案」畫面；電腦瀏覽器用檔案選擇框；回傳 Promise<文字或 null>
export function pickPackText() {
  return new Promise((resolve) => {
    if (window.FileBridge) { window.__onFileOpened = (t) => resolve(t); window.FileBridge.openText(); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files?.[0]; if (!f) return resolve(null); f.text().then(resolve, () => resolve(null)); };
    inp.click();
  });
}

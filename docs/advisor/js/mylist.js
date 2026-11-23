// 我的名單（像 Yahoo 的選秀前名單）：⭐ 優先想要、🚫 不要
// 推薦永遠不會推「不要」的人；「優先」的人推薦時加分往前排。存在手機裡（也會放進資料包）
export const LIST_KEY = 'adv.mylist';
const empty = () => ({ prio: [], no: [] });

export function getList() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(LIST_KEY) ?? 'null');
    return { prio: Array.isArray(v?.prio) ? v.prio.map(String) : [], no: Array.isArray(v?.no) ? v.no.map(String) : [] };
  } catch { return empty(); }
}
export function listSets(list = getList()) { return { prio: new Set(list.prio), no: new Set(list.no) }; }
export function statusOf(id, list = getList()) {
  const k = String(id);
  return list.prio.includes(k) ? 'prio' : list.no.includes(k) ? 'no' : null;
}
// kind：'prio'｜'no'｜null（拿掉）
export function setStatus(id, kind) {
  const k = String(id);
  const l = getList();
  l.prio = l.prio.filter((x) => x !== k);
  l.no = l.no.filter((x) => x !== k);
  if (kind === 'prio') l.prio.push(k);
  if (kind === 'no') l.no.push(k);
  try { globalThis.localStorage?.setItem(LIST_KEY, JSON.stringify(l)); } catch { /* 存不了就算了 */ }
  globalThis.dispatchEvent?.(new Event('mylist:change'));
  return l;
}

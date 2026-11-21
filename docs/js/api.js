// 和 Worker 溝通。瀏覽器只保存隨機 session id，Yahoo token 只在 Worker 的 KV。
import { WORKER_URL } from './config.js';

const SID_KEY = 'fb.sid';

export class AuthError extends Error {}

export function isConfigured() {
  return !WORKER_URL.includes('REPLACE_ME');
}

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 無痕模式 */ }
}

// Worker 登入完成後會導回 …#sid=<64 hex>，收下後從網址列移除
export function captureSessionFromHash() {
  const m = location.hash.match(/sid=([a-f0-9]{64})/);
  if (!m) return false;
  lsSet(SID_KEY, m[1]);
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

export const getSid = () => lsGet(SID_KEY);

export function loginUrl() {
  const ret = location.origin + location.pathname;
  return `${WORKER_URL}/auth/login?return=${encodeURIComponent(ret)}`;
}

export async function logout() {
  const sid = getSid();
  lsSet(SID_KEY, null);
  cache.clear();
  if (sid) {
    try {
      await fetch(`${WORKER_URL}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${sid}` } });
    } catch { /* 離線也沒關係 */ }
  }
}

const cache = new Map();

// 呼叫 Yahoo Fantasy API（經 Worker 代理），path 例如 "league/469.l.123/settings"
export async function yahoo(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const sid = getSid();
  if (!sid) throw new AuthError('尚未登入');
  const res = await fetch(`${WORKER_URL}/api/yahoo?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${sid}` },
  });
  if (res.status === 401) {
    lsSet(SID_KEY, null);
    throw new AuthError('登入已過期，請重新登入');
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      msg = j.error?.description || j.error || msg;
    } catch { /* 不是 JSON */ }
    throw new Error(`Yahoo 回應錯誤（${res.status}）：${msg}`);
  }
  const data = JSON.parse(text);
  cache.set(path, data);
  return data;
}

// 透過 Android App 原生端（window.AndroidBridge）帶使用者的 Yahoo 登入抓網頁。
// 資料只在手機和 Yahoo 之間傳遞。
import * as web from './yahoo-web.js';

export class LoginNeeded extends Error {}

let seq = 0;
const pending = new Map();
window.__bridgeResolve = (id, res) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (res?.ok) p.resolve(res);
  else p.reject(new Error(res?.error || '連線失敗'));
};

export const hasBridge = () => !!window.AndroidBridge;
export const login = () => window.AndroidBridge?.login();
export const logout = () => window.AndroidBridge?.logout();

function bridgeFetch(path) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    window.AndroidBridge.fetch(id, path);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Yahoo 回應逾時'));
    }, 30000);
  });
}

async function getDoc(path) {
  if (!hasBridge()) throw new Error('撿人功能要在 Android App 裡使用（需要登入 Yahoo）');
  const res = await bridgeFetch(path);
  if (web.isLoginPage(res.url)) throw new LoginNeeded('請先登入 Yahoo');
  if (res.status >= 400) throw new Error(`Yahoo 回應錯誤（${res.status}）`);
  return new DOMParser().parseFromString(res.text, 'text/html');
}

export async function leagues() {
  return web.parseHome(await getDoc('/'));
}

// 對戰頁：本週（或指定週）的對手
export async function matchup(league, week) {
  const path = week ? `/${league.key}/matchup?week=${week}` : `/${league.key}/matchup`;
  return web.parseMatchupPage(await getDoc(path));
}

export async function roster(league, teamId) {
  return web.parseRoster(await getDoc(`/${league.key}/${teamId}`));
}

// 可撿的球員（自由球員＋waiver），依最近 14 天表現排序，打者、投手各抓 pages 頁（每頁 25 人）
export async function freeAgents(league, pages = 4) {
  const out = [];
  for (const pos of ['B', 'P']) {
    const docs = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        getDoc(`/b1/${league.id}/players?status=A&pos=${pos}&stat1=S_L14&sort=AR&sdir=1&count=${i * 25}`)),
    );
    for (const d of docs) out.push(...web.parsePlayerList(d));
  }
  return out;
}

// 選秀結果（指定球季；預設本聯盟這一季）
export async function draftResults(league, path) {
  return web.parseDraftResults(await getDoc(path ?? `/${league.key}/draftresults?drafttab=round`));
}

// 聯盟歷史（最多 years 年）：用自訂網址 /league/<slug>/<年> 找出每年的聯盟 ID，
// 再抓選秀結果與經理人（換人次數）。→ [{ season, key, picks, teams }]
export async function leagueHistory(league, years = 10, onProgress = () => {}) {
  const slug = web.parseLeagueSlug(await getDoc(`/${league.key}/settings`));
  const out = [];
  for (let i = 0; i < years; i++) {
    const season = league.season - i;
    let key = i === 0 ? league.key : null;
    if (!key && slug) {
      const id = web.parseLeagueId(await getDoc(`/league/${slug}/${season}`));
      if (id) key = `${season}/b1/${id}`;
    }
    if (!key) continue;
    onProgress(season);
    const [picks, teams] = await Promise.all([
      getDoc(`/${key}/draftresults?drafttab=round`).then(web.parseDraftResults).catch(() => []),
      getDoc(`/${key}/teams`).then(web.parseTeams).catch(() => []),
    ]);
    if (picks.length || teams.length) out.push({ season, key, picks, teams });
  }
  return out;
}

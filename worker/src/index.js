// fantasy-baseball-api：Yahoo OAuth + Fantasy API 代理
// 路由：
//   GET  /                 健康檢查
//   GET  /auth/login       導向 Yahoo 登入
//   GET  /auth/callback    Yahoo 導回，建立 session 後帶 #sid= 回前端
//   POST /auth/logout      刪除 session
//   GET  /api/me           確認登入狀態
//   GET  /api/yahoo?path=  代理 Yahoo Fantasy API（需 Bearer session id）
import { HttpError, handleLogin, handleCallback, handleLogout, loadSession, accessToken } from './oauth.js';
import { isValidPath, yahooGet } from './yahoo.js';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

async function proxyYahoo(request, env, url) {
  const path = url.searchParams.get('path') || '';
  if (!isValidPath(path)) throw new HttpError(400, '不允許的 Yahoo 路徑');
  const sess = await loadSession(request, env);
  let token = await accessToken(env, url, sess);
  let res = await yahooGet(path, token);
  if (res.status === 401) {
    token = await accessToken(env, url, sess, true);
    res = await yahooGet(path, token);
  }
  const body = await res.text();
  return new Response(body, {
    status: res.status === 401 ? 502 : res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      let res;
      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case 'GET /':
          res = json({ ok: true, name: 'fantasy-baseball-api' });
          break;
        case 'GET /auth/login':
          return await handleLogin(env, url);
        case 'GET /auth/callback':
          return await handleCallback(env, url);
        case 'POST /auth/logout':
          res = await handleLogout(request, env);
          break;
        case 'GET /api/me': {
          const sess = await loadSession(request, env);
          res = json({ ok: true, guid: sess.data.guid });
          break;
        }
        case 'GET /api/yahoo':
          res = await proxyYahoo(request, env, url);
          break;
        default:
          res = json({ error: 'not found' }, 404);
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message || '伺服器錯誤' }, status, cors);
    }
  },
};

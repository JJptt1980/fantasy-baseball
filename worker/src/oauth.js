// Yahoo OAuth 2.0（Authorization Code）與 session 管理
// KV key：
//   state:<state>  → { ret }                         10 分鐘
//   sess:<sid>     → { access_token, refresh_token, expires_at, guid }   60 天

const AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const STATE_TTL = 600;
const SESSION_TTL = 60 * 60 * 24 * 60;
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function redirectUri(url) {
  return `${url.origin}/auth/callback`;
}

export function isAllowedReturn(ret, allowedOrigin) {
  try {
    const u = new URL(ret);
    return u.origin === allowedOrigin;
  } catch {
    return false;
  }
}

function htmlPage(title, body, status = 400) {
  const html = `<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="background:#0b1220;color:#e5e7eb;font-family:system-ui;padding:24px">
<h1 style="font-size:20px">${title}</h1><p>${body}</p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// GET /auth/login?return=<前端網址>
export async function handleLogin(env, url) {
  const ret = url.searchParams.get('return') || '';
  if (!isAllowedReturn(ret, env.ALLOWED_ORIGIN)) {
    return htmlPage('不允許的來源', '登入只能從 App 本身發起。');
  }
  const state = randomHex(16);
  await env.SESSIONS.put(`state:${state}`, JSON.stringify({ ret }), { expirationTtl: STATE_TTL });
  const q = new URLSearchParams({
    client_id: env.YAHOO_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    state,
  });
  return Response.redirect(`${AUTH_URL}?${q}`, 302);
}

async function tokenRequest(env, url, params) {
  const basic = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ redirect_uri: redirectUri(url), ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(401, `Yahoo token 失敗（${res.status}）：${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function toSession(tok, prev = {}) {
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    guid: tok.xoauth_yahoo_guid || prev.guid || null,
  };
}

// GET /auth/callback?code=...&state=...
export async function handleCallback(env, url) {
  const err = url.searchParams.get('error');
  if (err) return htmlPage('登入已取消', escapeHtml(url.searchParams.get('error_description') || err));

  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!/^[a-f0-9]{32}$/.test(state) || !code) return htmlPage('登入失敗', '缺少必要參數。');

  const saved = await env.SESSIONS.get(`state:${state}`, 'json');
  if (!saved) return htmlPage('登入失敗', '登入逾時或驗證碼不符，請回 App 重新登入。');
  await env.SESSIONS.delete(`state:${state}`);

  let tok;
  try {
    tok = await tokenRequest(env, url, { grant_type: 'authorization_code', code });
  } catch (e) {
    return htmlPage('登入失敗', escapeHtml(e.message), 502);
  }

  const sid = randomHex(32);
  await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(toSession(tok)), { expirationTtl: SESSION_TTL });

  const back = new URL(saved.ret);
  back.hash = `sid=${sid}`;
  return Response.redirect(back.toString(), 302);
}

export function bearerSid(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  return m ? m[1] : null;
}

export async function loadSession(request, env) {
  const sid = bearerSid(request);
  if (!sid) throw new HttpError(401, '未登入');
  const data = await env.SESSIONS.get(`sess:${sid}`, 'json');
  if (!data) throw new HttpError(401, '登入已過期');
  return { sid, data };
}

// 取得可用的 access token，快過期或 force 時自動 refresh
export async function accessToken(env, url, sess, force = false) {
  if (!force && Date.now() < sess.data.expires_at - REFRESH_MARGIN_MS) return sess.data.access_token;
  let tok;
  try {
    tok = await tokenRequest(env, url, { grant_type: 'refresh_token', refresh_token: sess.data.refresh_token });
  } catch (e) {
    await env.SESSIONS.delete(`sess:${sess.sid}`);
    throw new HttpError(401, '登入已過期，請重新登入');
  }
  sess.data = toSession(tok, sess.data);
  await env.SESSIONS.put(`sess:${sess.sid}`, JSON.stringify(sess.data), { expirationTtl: SESSION_TTL });
  return sess.data.access_token;
}

export async function handleLogout(request, env) {
  const sid = bearerSid(request);
  if (sid) await env.SESSIONS.delete(`sess:${sid}`);
  return new Response(null, { status: 204 });
}

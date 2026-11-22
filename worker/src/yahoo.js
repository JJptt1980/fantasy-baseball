// Yahoo Fantasy API（唯讀）代理
const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2/';
const PATH_RE = /^[A-Za-z0-9_.;=,/:-]+$/;
const PREFIXES = ['users;use_login=1', 'games;', 'game/', 'league/', 'leagues;', 'team/'];

export function isValidPath(path) {
  if (!path || path.length > 500 || !PATH_RE.test(path) || path.includes('..')) return false;
  return PREFIXES.some((p) => path.startsWith(p));
}

export function yahooGet(path, token) {
  return fetch(`${BASE}${path}?format=json`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

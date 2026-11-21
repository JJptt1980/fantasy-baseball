# Fantasy 棒球助手（Yahoo Fantasy Baseball 輔助 PWA）

手機優先、深色模式的 PWA，用 Yahoo 帳號登入後查看 H2H 對戰各類別的領先/落後與整體戰況（例如 `6-4-0`）。休賽季可選 2026 球季的任一週看歷史對戰。

- 前端：https://jjptt1980.github.io/fantasy-baseball/
- 後端：`https://fantasy-baseball-api.<你的子網域>.workers.dev`

## 架構

```
手機瀏覽器 / PWA（GitHub Pages：docs/）
   │  Authorization: Bearer <隨機 session id>
   ▼
Cloudflare Worker：fantasy-baseball-api（worker/）
   │  KV「SESSIONS」：sess:<sid> → Yahoo access/refresh token
   │                 state:<state> → OAuth 防 CSRF（10 分鐘）
   ▼
Yahoo Fantasy Sports API（唯讀）
```

- Yahoo token **只存在 KV**，瀏覽器只拿到 64 字元隨機 session id（存在 localStorage）。
- access token 快過期或 Yahoo 回 401 時，Worker 自動用 refresh token 換新的。
- CORS 只允許 `https://jjptt1980.github.io`；登入後導回的網址也只允許這個來源。
- OAuth `state` 存 KV、用一次就刪，防 CSRF。
- Client ID / Secret 用 `wrangler secret put` 設定，不進 git。
- Worker 只代理白名單路徑（`users;use_login=1`、`games;`、`league/`、`team/`…）。

### Worker 路由

| 路由 | 說明 |
|---|---|
| `GET /` | 健康檢查 |
| `GET /auth/login?return=<前端網址>` | 建立 state，導向 Yahoo 登入 |
| `GET /auth/callback` | 驗 state、換 token、建 session，導回 `前端網址#sid=…` |
| `POST /auth/logout` | 刪除 session |
| `GET /api/me` | 確認登入 |
| `GET /api/yahoo?path=<Yahoo 路徑>` | 代理 Yahoo Fantasy API（自動加 `format=json`） |

### 前端檔案

```
docs/
  index.html  manifest.webmanifest  sw.js  icons/  css/app.css
  js/config.js          Worker 網址、可選球季
  js/api.js             session 與 Worker 呼叫
  js/yahoo-parse.js     把 Yahoo 的巢狀 JSON 轉成好用的物件
  js/app.js             畫面流程：球季 → 聯盟 → 週次 → 對戰
  js/scoring/index.js   依 scoring_type 選模組
  js/scoring/h2h-categories.js   H2H 類別制（已實作）
  js/scoring/h2h-points.js       H2H 積分制（預留）
  js/scoring/roto.js             Roto（預留）
```

類別大小方向依 Yahoo `stat_categories` 的 `sort_order`（1＝越大越好、0＝越小越好）；`is_only_display_stat` 的類別只顯示不計分。數值無法比較時（例如雙方 ERA 都是 `-`）採用 Yahoo 的 `stat_winners`。

## 部署

### 1. Cloudflare Worker

```bash
cd worker && npm install && npx wrangler login
```

```bash
npx wrangler kv namespace create fantasy-baseball-sessions
```

把印出的 `id` 填進 `worker/wrangler.toml` 的 `[[kv_namespaces]]`，然後：

```bash
npx wrangler deploy
```

記下印出的網址 `https://fantasy-baseball-api.<子網域>.workers.dev`。

### 2. Yahoo App

到 https://developer.yahoo.com/apps/create/ 建立：

- Application Type：**Web Application**
- Redirect URI(s)：`https://fantasy-baseball-api.<子網域>.workers.dev/auth/callback`
- API Permissions：**Fantasy Sports → Read**

建好後把 Client ID / Client Secret 設成 Worker secret（指令會要你貼上值）：

```bash
npx wrangler secret put YAHOO_CLIENT_ID && npx wrangler secret put YAHOO_CLIENT_SECRET
```

### 3. 前端

把 `docs/js/config.js` 的 `WORKER_URL` 改成 Worker 網址，commit + push。
GitHub repo → Settings → Pages：Source 選 `main` 分支的 `/docs`。

## 開發

```bash
npm test
```

```bash
npm run serve
```

`npm run icons` 重新產生 icon。本機（localhost）因為 CORS 只允許 GitHub Pages，無法真的登入 Yahoo；畫面邏輯靠 `tests/` 的假資料測試。

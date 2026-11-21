# 專案狀態

## 目前進度（2026-11-22）
- 第一階段自用版骨架完成：前端 PWA（docs/）+ Cloudflare Worker（worker/）
- 單元測試 9 項通過（npm test）；用假資料在手機尺寸確認過對戰畫面
- 尚未：建 Cloudflare KV / 部署 Worker / 註冊 Yahoo App / 設 secret / 填 WORKER_URL

## 已定案的決定
- 前端純 HTML/CSS/JS（ES Modules、無 build），GitHub Pages 從 main 的 /docs 發佈
- 後端 Cloudflare Worker `fantasy-baseball-api` + KV `SESSIONS`；Yahoo token 只存 KV，瀏覽器只持有隨機 session id（Bearer）
- 登入完成後 Worker 以網址 `#sid=` 把 session id 交給前端，前端收下後立刻從網址列移除
- CORS 與登入導回網址只允許 `https://jjptt1980.github.io`
- Worker 只代理白名單 Yahoo 路徑
- 賽制依 Yahoo `scoring_type`：head（已做）、headpoint / roto（預留）
- Service worker 採「先網路、失敗才快取」，避免手機卡舊版

## 下一步
1. wrangler login → 建 KV → 填 id → deploy，拿到 workers.dev 網址
2. 註冊 Yahoo App（Web Application、Fantasy Sports Read），Redirect URI 用 Worker 網址 + /auth/callback
3. wrangler secret put YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET
4. 填 docs/js/config.js 的 WORKER_URL，push，手機實測

## 已知問題 / 待確認
- Yahoo JSON 解析是依文件結構寫的，尚未用真實資料驗證（首次登入後要核對）
- 季後賽週數若跨多週（Yahoo 有時一個 matchup 涵蓋兩週）尚未特別處理

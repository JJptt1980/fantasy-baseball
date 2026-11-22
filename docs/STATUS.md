# 專案狀態

## 目前進度（2026-11-22）
- 第一階段自用版骨架完成：前端 PWA（docs/）+ Cloudflare Worker（worker/）
- 單元測試 9 項通過（npm test）；用假資料在手機尺寸確認過對戰畫面
- Worker 已部署：https://fantasy-baseball-api.weather-one-proxy.workers.dev（KV fantasy-baseball-sessions，id 0166c23e…）
- GitHub Pages 已開：https://jjptt1980.github.io/fantasy-baseball/
- Yahoo App 已建立（Confidential Client、Fantasy Sports Read），兩個 secret 已設定，Yahoo 已接受 Client ID
- 手機實測：Yahoo 登入成功（Client Secret 正確）
- 修正：Yahoo API 主機應為 fantasysports.yahooapis.com（原本寫錯造成 Cloudflare 530 / 1016），已重新部署
- 登入時明確要求 scope=fspt-r（Fantasy 唯讀）
- **卡關（2026-11-22）**：Yahoo 對所有 Fantasy API 回 403「This application is not authorized to perform this action」。已從 Mac 直接用同一把 token 測過，連 game/mlb 都 403，確定不是 Worker 的問題。據其他開發者回報，Yahoo 從 2026 年 7 月起，Fantasy API 要個別申請核准（勾選 Fantasy Sports - Read 不算核准），需到 sports.yahoo.com/developer/access/ 申請、在 sports.yahoo.com/developer/application-confirmation/ 確認 Client ID，可能還有 DocuSign 合約，聽說約 1–2 週
- 尚未：用真實資料確認聯盟清單與對戰畫面（等 Yahoo 核准）

## 已定案的決定
- 前端純 HTML/CSS/JS（ES Modules、無 build），GitHub Pages 從 main 的 /docs 發佈
- 後端 Cloudflare Worker `fantasy-baseball-api` + KV `SESSIONS`；Yahoo token 只存 KV，瀏覽器只持有隨機 session id（Bearer）
- 登入完成後 Worker 以網址 `#sid=` 把 session id 交給前端，前端收下後立刻從網址列移除
- CORS 與登入導回網址只允許 `https://jjptt1980.github.io`
- Worker 只代理白名單 Yahoo 路徑
- 賽制依 Yahoo `scoring_type`：head（已做）、headpoint / roto（預留）
- Service worker 採「先網路、失敗才快取」，避免手機卡舊版

## 下一步
1. 使用者向 Yahoo 申請 Fantasy API 存取並確認 Client ID
2. 核准後：手機 App 登出再登入，用真實資料核對解析
3. 若核准後仍 403：重建 Yahoo App、重設 secret 再登入

## 已知問題 / 待確認
- Yahoo JSON 解析是依文件結構寫的，尚未用真實資料驗證（首次登入後要核對）
- 季後賽週數若跨多週（Yahoo 有時一個 matchup 涵蓋兩週）尚未特別處理

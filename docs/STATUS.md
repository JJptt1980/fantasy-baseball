# 專案狀態

## 目前進度（2026-11-22）
- 第一階段自用版骨架完成：前端 PWA（docs/）+ Cloudflare Worker（worker/）
- 單元測試 9 項通過（npm test）；用假資料在手機尺寸確認過對戰畫面
- Worker 已部署：https://fantasy-baseball-api.weather-one-proxy.workers.dev（KV fantasy-baseball-sessions，id 0166c23e…）
- GitHub Pages 已開：https://jjptt1980.github.io/fantasy-baseball/
- Yahoo App 已建立（Confidential Client、Fantasy Sports Read），兩個 secret 已設定，Yahoo 已接受 Client ID
- 尚未：手機實測登入（Client Secret 要實際登入才驗證得到）

## 已定案的決定
- 前端純 HTML/CSS/JS（ES Modules、無 build），GitHub Pages 從 main 的 /docs 發佈
- 後端 Cloudflare Worker `fantasy-baseball-api` + KV `SESSIONS`；Yahoo token 只存 KV，瀏覽器只持有隨機 session id（Bearer）
- 登入完成後 Worker 以網址 `#sid=` 把 session id 交給前端，前端收下後立刻從網址列移除
- CORS 與登入導回網址只允許 `https://jjptt1980.github.io`
- Worker 只代理白名單 Yahoo 路徑
- 賽制依 Yahoo `scoring_type`：head（已做）、headpoint / roto（預留）
- Service worker 採「先網路、失敗才快取」，避免手機卡舊版

## 下一步
1. 手機開 GitHub Pages 實測登入，用真實資料核對解析

## 已知問題 / 待確認
- Yahoo JSON 解析是依文件結構寫的，尚未用真實資料驗證（首次登入後要核對）
- 季後賽週數若跨多週（Yahoo 有時一個 matchup 涵蓋兩週）尚未特別處理

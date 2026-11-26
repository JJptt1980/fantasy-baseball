# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

開工前先讀 `docs/STATUS.md`（目前進度、已定案的決定、已知問題）。回覆使用者用台灣繁體中文、白話。

## 專案是什麼

主力產品是 **選秀大師**：Yahoo Fantasy 棒球（12 隊 H2H、18 類別）的選秀建議＋季中撿人建議 Android App。
App 是 WebView 外殼（`android/`），畫面全部是 `docs/advisor/` 的網頁（純 ES modules，沒有打包工具、沒有 npm 相依套件）。

repo 裡另外有兩個舊東西，平常不用動：
- `docs/`（根目錄的 index.html、js/）＋ `worker/`：舊的 PWA＋Cloudflare Worker（Yahoo API 版），Yahoo API 沒核准所以停用，README.md 講的是這個。
- `sim/`：Python 版模擬器（蛇形選秀＋例行賽＋季後賽），用來驗證選秀策略；`sim/fetch.sh` 下載 MLB 數據到 `sim/data/`（不進 git）。

## 常用指令

```bash
npm test
```

```bash
node --test tests/draft-sync.test.js
```

```bash
node --test --test-name-pattern="我的名單" tests/draft-sync.test.js
```

```bash
cd android && ./gradlew -q assembleDebug && cp app/build/outputs/apk/debug/app-debug.apk "../build-out/選秀大師-<日期代號>.apk"
```

- 網頁預覽：`.claude/launch.json` 的 `docs-8010`（python http.server 服務 `docs/`），網址 `http://localhost:8010/advisor/`。瀏覽器會快取 ES module，改完要 `fetch(檔案,{cache:'reload'})` 再重新整理。
- 模擬選秀壓力測試：`docs/advisor/_ux/draft.js`，在預覽頁用 `import('./_ux/draft.js').then(m => m.run(場數, 種子))`，結果在 `window.__dx`（errors、stuck、issues）。
- `build-out/` 放 APK，不進 git（`*.apk` 已忽略）。
- 發 App 內更新的測試版：`scripts/release-beta.sh "改了什麼"`（發到公開的 `JJptt1980/fantasy-baseball-beta`，prerelease；會自動加 versionCode、commit、push）。

## 架構重點

- **APK 打包網頁**：`android/app/build.gradle.kts` 的 `copyWebAssets` 把 `docs/advisor/**`、`docs/icons/**` 複製進 assets，`MainActivity` 用 `WebViewAssetLoader` 從 `https://appassets.androidplatform.net/assets/...` 載入。改網頁後要重新編譯 APK 才會進手機。
- **原生橋接（window.*）**：`AndroidBridge`（YahooBridge：在 App 內登入 Yahoo、帶 cookie 抓 Yahoo 網頁解析聯盟資料）、`FileBridge`（存／讀檔）、`Feedback`（震動＋提示音）。Android WebView 不支援 `navigator.vibrate`，所以震動、聲音一律走 `ui-kit.js` 的 `haptic()`／`sound()`，它們會優先呼叫 `window.Feedback`，瀏覽器裡才退回 WebAudio。提示音用 `STREAM_MUSIC`（媒體音量），因為通知音量在勿擾／靜音時會被關。
- **分頁**：`js/main.js` 的 `PAGES = ['demo','draft','pickup','live','more']`（模擬／選秀／球季中／即時／更多），各分頁 UI 在 `manual-ui.js`、`draft-sync-ui.js`、`pickup-ui.js`、`live-ui.js`；邏輯放在沒有 `-ui` 的同名檔，測試只測邏輯檔。
- **排名與推薦**：`rank.js`、`projections.js`、`strategies.js` 算選秀表；`draft-sync.js` 的 `recommend()` 決定推薦誰。我的名單（`mylist.js`，localStorage `adv.mylist` = `{prio:[id], no:[id]}`，id 是字串）：`no` 永遠不推薦、`prio` 加分；改名單會發 `mylist:change` 事件，各頁靠它重畫。
- **資料都存在手機 localStorage**。`pack.js` 的 `PACK_KEYS` 列出哪些 key 會被「資料包」匯出／匯入；新增要跟著搬家的設定時記得加進去。
- **App 內更新**：`Updater.java`（window.Updater）讀 beta repo `feed` Release 的 `update.json`，網頁端是 `js/update-ui.js`。發版用 `-PpublicBuild=true` 打包，不含 `data/private`。簽章必須是 `~/.android/debug.keystore`（鑰匙圈有備份），換鑰匙手機就無法更新。
- **私人聯盟資料**：`docs/advisor/data/private/pack.json`（gitignored）在 App 第一次打開時只補手機上還沒有的 key。它含對手暱稱等個人資料，所以 **APK 不能公開發布**（例如 GitHub Release），這個 repo 是公開的。
- **數據來源**：MLB 官方公開 API（statsapi.mlb.com，免登入）；`docs/advisor/data/weekly-<年>.json` 由 `scripts/build-weekly.mjs` 產生，給球員卡走勢圖和模擬重播用。
- **字型**：`docs/advisor/fonts/` 的 JJ Sans 子集（約 6,200 常用字），罕用字會退回系統字型。

## 慣例

- commit message 用中文，一行講清楚改了什麼；做完一件事更新 `docs/STATUS.md`。
- 測試手機：`X200 Pro`（序號 10AEA604Z9000RJ，vivo 安裝要使用者在手機上按授權）、`V2126`（序號 3430666920001FL）。adb 一律 `-s <序號>`。
- 程式註解用白話中文寫「為什麼」。

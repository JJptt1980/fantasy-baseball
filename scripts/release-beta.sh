#!/usr/bin/env bash
# 發一個測試版（prerelease）到公開的 JJptt1980/fantasy-baseball-beta，給 App 內更新用。
#   scripts/release-beta.sh "這一版改了什麼"
# beta repo 只放 APK 和 update.json；APK 用 -PpublicBuild=true 打包，不含聯盟私人資料（docs/advisor/data/private）。
# 已裝的手機更新後，手機裡存的資料（localStorage）都還在；新手機要用「更多 → 資料包」匯入一次。
# versionCode 會自動 +1 並 commit、push。測試版一天可以發很多次；正式版（不是 prerelease）一天最多一次，要先問過使用者。
set -euo pipefail

REPO="JJptt1980/fantasy-baseball-beta"
# 簽章憑證的 SHA-256（公開資訊，不是機密）。用別的金鑰簽的 APK 無法更新已安裝的版本，所以直接擋下。
# 金鑰是 ~/.android/debug.keystore，備份在鑰匙圈 android-debug-keystore-base64
CERT_SHA256="a57c2fc1991d083be53f41171de2848b6aeb3b1d38ee90ef9323c1b0c191c807"
FEED_TAG="feed"

cd "$(dirname "$0")/.."
NOTES="${1:-}"
G=android/app/build.gradle.kts

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "工作目錄有未 commit 的變更，請先 commit。" >&2
  exit 1
fi

PUBLISHED=$(gh release download "$FEED_TAG" --repo "$REPO" --pattern update.json --output - 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['versionCode'])" 2>/dev/null || echo 0)
OLD=$(grep -o 'versionCode = [0-9]*' $G | grep -o '[0-9]*')
# 每次發版都要比上次大；本機的數字已經發過就改成「已發佈 +1」
if [ "$OLD" -le "$PUBLISHED" ]; then
  CODE=$((PUBLISHED + 1))
  sed -i '' "s/versionCode = $OLD/versionCode = $CODE/" $G
else
  CODE=$OLD
fi
NAME=$(grep -o 'versionName = "[^"]*"' $G | cut -d'"' -f2)
TAG="v${NAME}-${CODE}"

(cd android && ./gradlew -q assembleDebug -PpublicBuild=true)
APK=android/app/build/outputs/apk/debug/app-debug.apk
APKSIGNER="$(ls -d "$HOME"/Library/Android/sdk/build-tools/* | tail -1)/apksigner"
CERT=$("$APKSIGNER" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
if [ "$CERT" != "$CERT_SHA256" ]; then
  echo "APK 的簽章不對（$CERT），已停止。" >&2
  git checkout -- $G
  exit 1
fi
# 再確認一次：私人資料、測試腳本絕對不能在公開的 APK 裡
if unzip -l "$APK" | grep -qE 'advisor/data/private|advisor/_ux'; then
  echo "APK 裡有私人資料，已停止。" >&2
  git checkout -- $G
  exit 1
fi

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
cp "$APK" "$OUT/xuanxiu.apk"
SHA=$(shasum -a 256 "$OUT/xuanxiu.apk" | cut -d' ' -f1)
[ -n "$NOTES" ] || NOTES="測試版 ${NAME}"

python3 - "$OUT/update.json" "$CODE" "$NAME" "https://github.com/${REPO}/releases/download/${TAG}/xuanxiu.apk" "$SHA" "$NOTES" <<'PY'
import json, sys
path, code, name, url, sha, notes = sys.argv[1:]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"versionCode": int(code), "versionName": name, "apkUrl": url, "sha256": sha, "notes": notes},
              f, ensure_ascii=False, indent=2)
PY

if ! git diff --quiet; then
  git add $G
  git commit -q -m "發測試版 $TAG" -m "$NOTES" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
fi
git pull -q --rebase
git push -q

gh release create "$TAG" "$OUT/xuanxiu.apk" "$OUT/update.json" \
  --repo "$REPO" --title "選秀大師 ${NAME}（${CODE}）" --notes "$NOTES" --prerelease

if ! gh release view "$FEED_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$FEED_TAG" --repo "$REPO" --prerelease --title "更新資訊" \
    --notes "App 內更新讀這裡的 update.json，指向最新的測試版。"
fi
gh release upload "$FEED_TAG" "$OUT/update.json" --repo "$REPO" --clobber

echo "已發佈 ${TAG}：https://github.com/${REPO}/releases/tag/${TAG}"

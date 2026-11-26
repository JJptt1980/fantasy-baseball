package com.jjptt.fantasybaseball;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

/**
 * App 內更新（跟 LanShare、weather-one 同一套做法），給網頁版呼叫（window.Updater）。
 * 公開的 JJptt1980/fantasy-baseball-beta 只放 APK 和 update.json（不含程式碼、不含聯盟私人資料）。
 * update.json：{versionCode, versionName, apkUrl, sha256, notes}；versionCode 比自己大就是新版。
 * apkUrl 只接受 beta repo 的 Release 網址；下載完比對 SHA-256，不符就刪掉；系統也會拒絕不同金鑰簽章的 APK。
 *
 * JavascriptInterface 的呼叫會卡住網頁，所以查詢、下載都在背景執行緒跑，網頁用 state() 輪詢狀態。
 */
public class Updater {
    private static final String REPO = "JJptt1980/fantasy-baseball-beta";
    private static final String FEED_URL = "https://github.com/" + REPO + "/releases/download/feed/update.json";
    private static final Pattern APK_URL = Pattern.compile(
            "https://github\\.com/JJptt1980/fantasy-baseball-beta/releases/download/[A-Za-z0-9._-]+/xuanxiu\\.apk");

    private final Context app;
    // 狀態：idle｜checking｜uptodate｜available｜downloading｜failed（用 JSON 字串交給網頁）
    private volatile String phase = "idle";
    private volatile String message = "";
    private volatile long done = 0, total = -1;
    private volatile JSONObject info = null;

    Updater(Context ctx) { app = ctx.getApplicationContext(); }

    private long myCode() {
        try {
            PackageInfo pi = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            return pi.getLongVersionCode();
        } catch (Exception e) { return 0; }
    }

    @JavascriptInterface
    public String version() {
        try {
            PackageInfo pi = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            return new JSONObject().put("code", pi.getLongVersionCode()).put("name", pi.versionName).toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface
    public String state() {
        try {
            JSONObject o = new JSONObject().put("phase", phase).put("message", message).put("done", done).put("total", total);
            if (info != null) o.put("info", info);
            return o.toString();
        } catch (Exception e) { return "{\"phase\":\"failed\"}"; }
    }

    /** 背景查有沒有新版 */
    @JavascriptInterface
    public void check() {
        if ("checking".equals(phase) || "downloading".equals(phase)) return;
        phase = "checking";
        new Thread(() -> {
            try {
                JSONObject j = latest();
                if (j != null && j.getLong("versionCode") > myCode()) { info = j; phase = "available"; }
                else phase = "uptodate";
            } catch (Exception e) {
                message = "檢查更新失敗：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                phase = "failed";
            }
        }).start();
    }

    /** 背景下載 → 比對 SHA-256 → 跳出安裝畫面 */
    @JavascriptInterface
    public void install() {
        final JSONObject j = info;
        if (j == null || "downloading".equals(phase)) return;
        // 第一次要使用者允許「安裝不明應用程式」，允許後回來再按一次更新
        if (!app.getPackageManager().canRequestPackageInstalls()) {
            app.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            message = "請允許「安裝不明應用程式」，回來再按一次更新";
            return;
        }
        phase = "downloading";
        done = 0; total = -1; message = "";
        new Thread(() -> {
            try {
                File dir = new File(app.getCacheDir(), "update");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File file = new File(dir, "xuanxiu-" + j.getLong("versionCode") + ".apk");
                HttpURLConnection c = open(j.getString("apkUrl"));
                if (c == null) throw new IllegalStateException("找不到更新檔");
                total = c.getContentLengthLong();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); md.update(buf, 0, n); done += n; }
                } finally { c.disconnect(); }
                StringBuilder sb = new StringBuilder();
                for (byte b : md.digest()) sb.append(String.format("%02x", b));
                if (!sb.toString().equals(j.getString("sha256"))) {
                    file.delete();
                    throw new IllegalStateException("檔案檢查碼不符，已刪除");
                }
                phase = "available";
                Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".files", file);
                app.startActivity(new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception e) {
                message = "下載失敗：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                phase = "failed";
            }
        }).start();
    }

    private JSONObject latest() throws Exception {
        HttpURLConnection c = open(FEED_URL);
        if (c == null) return null;
        try (InputStream in = c.getInputStream()) {
            JSONObject j = new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            if (!APK_URL.matcher(j.getString("apkUrl")).matches()) throw new IllegalStateException("更新網址不正確");
            String sha = j.getString("sha256").toLowerCase();
            if (!sha.matches("[0-9a-f]{64}")) throw new IllegalStateException("更新資料不正確");
            j.put("sha256", sha);
            return j;
        } finally { c.disconnect(); }
    }

    /** 自己跟著轉址走（GitHub 下載會轉到另一個主機）；404 回傳 null */
    private static HttpURLConnection open(String start) throws Exception {
        URL url = new URL(start);
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent", "XuanXiu-Android");
            int code = c.getResponseCode();
            if (code == 200) return c;
            if (code == 404) { c.disconnect(); return null; }
            if (code >= 300 && code < 400) {
                url = new URL(url, c.getHeaderField("Location"));
                c.disconnect();
                if (!"https".equals(url.getProtocol())) throw new IllegalStateException("不安全的轉址");
                continue;
            }
            c.disconnect();
            throw new IllegalStateException("HTTP " + code);
        }
        throw new IllegalStateException("轉址太多次");
    }
}

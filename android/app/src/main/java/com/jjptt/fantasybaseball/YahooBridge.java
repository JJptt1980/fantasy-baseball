package com.jjptt.fantasybaseball;

import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 給網頁版呼叫的原生介面（window.AndroidBridge）：帶著 App 內的 Yahoo 登入抓 Fantasy 網頁。
 * 只允許 baseball.fantasysports.yahoo.com 的路徑；碰到登入頁就停下並回報。
 */
public class YahooBridge {
    static final int LOGIN_REQUEST = 7;
    private static final String BASE = "https://baseball.fantasysports.yahoo.com";

    private final Activity activity;
    private final WebView web;
    private final ExecutorService io = Executors.newFixedThreadPool(4);
    private final String userAgent;

    YahooBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.userAgent = WebSettings.getDefaultUserAgent(activity);
    }

    @JavascriptInterface
    public void fetch(final int id, final String path) {
        io.execute(() -> {
            JSONObject res = new JSONObject();
            try {
                if (path == null || !path.startsWith("/") || path.startsWith("//")) {
                    throw new IllegalArgumentException("不允許的路徑");
                }
                get(BASE + path, res);
                res.put("ok", true);
            } catch (Exception e) {
                try {
                    res.put("ok", false);
                    res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                } catch (Exception ignored) { }
            }
            final String js = "window.__bridgeResolve && window.__bridgeResolve(" + id + "," + res + ")";
            activity.runOnUiThread(() -> web.evaluateJavascript(js, null));
        });
    }

    private void get(String start, JSONObject res) throws Exception {
        CookieManager cm = CookieManager.getInstance();
        URL url = new URL(start);
        for (int hop = 0; hop < 8; hop++) {
            String host = url.getHost();
            if (host.equals("login.yahoo.com") || host.startsWith("guce.")) {
                res.put("status", 401);
                res.put("url", url.toString());
                res.put("text", "");
                return;
            }
            if (!host.endsWith("yahoo.com")) throw new IllegalStateException("不允許的網站：" + host);

            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            String cookie = cm.getCookie(url.toString());
            if (cookie != null) c.setRequestProperty("Cookie", cookie);

            int code = c.getResponseCode();
            Map<String, List<String>> headers = c.getHeaderFields();
            List<String> set = headers.get("Set-Cookie");
            if (set != null) for (String sc : set) cm.setCookie(url.toString(), sc);

            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IllegalStateException("轉址沒有目的地");
                url = new URL(url, loc);
                continue;
            }
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = "";
            if (in != null) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[16384];
                int n;
                while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                in.close();
                body = buf.toString(StandardCharsets.UTF_8.name());
            }
            c.disconnect();
            res.put("status", code);
            res.put("url", url.toString());
            res.put("text", body);
            return;
        }
        throw new IllegalStateException("轉址太多次");
    }

    @JavascriptInterface
    public void login() {
        activity.runOnUiThread(() ->
                activity.startActivityForResult(new Intent(activity, LoginActivity.class), LOGIN_REQUEST));
    }

    @JavascriptInterface
    public void logout() {
        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(null);
        cm.flush();
    }
}

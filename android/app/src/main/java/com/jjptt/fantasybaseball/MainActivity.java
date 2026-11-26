package com.jjptt.fantasybaseball;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/** 外殼：用 WebView 開打包在 APK 裡的網頁版（assets/web/advisor/）。 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/web/advisor/index.html";

    private WebView web;
    private FileBridge files;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(bgColor());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // 只有自己的頁面（assets）會載入這個 WebView，外部連結一律交給系統瀏覽器
        web.addJavascriptInterface(new YahooBridge(this, web), "AndroidBridge");
        files = new FileBridge(this, web);
        web.addJavascriptInterface(files, "FileBridge");
        web.addJavascriptInterface(new Feedback(this), "Feedback");
        web.addJavascriptInterface(new Updater(this), "Updater");
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // 外部連結交給系統瀏覽器
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });

        // 避開狀態列與手勢列（WebView 自己的 padding 不會推動網頁內容，要包一層容器）
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(bgColor());
        root.addView(web);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });

        getWindow().getDecorView().setBackgroundColor(bgColor());
        // 淺色模式：狀態列、導覽列圖示改成深色
        if (!isNight() && getWindow().getInsetsController() != null) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        setContentView(root);
        // Android 13 以上的返回手勢
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    // 跟隨系統深淺色（要跟網頁 CSS 的 --bg 一致）
    private boolean isNight() {
        int m = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return m != android.content.res.Configuration.UI_MODE_NIGHT_NO;
    }

    private int bgColor() {
        return Color.parseColor(isNight() ? "#0e0b14" : "#f4f2f8");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (files != null && files.onResult(requestCode, resultCode, data)) return;
        if (requestCode == YahooBridge.LOGIN_REQUEST && resultCode == RESULT_OK) {
            web.evaluateJavascript("window.__onYahooLogin && window.__onYahooLogin()", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    // 返回手勢（從邊緣往內滑）：交給網頁決定要「上一步」還是離開 App
    private void handleBack() {
        web.evaluateJavascript("window.__appBack ? window.__appBack() : 'exit'", v -> {
            if ("\"exit\"".equals(v) || "null".equals(v)) finish();
        });
    }

    @Override
    public void onBackPressed() {
        handleBack(); // Android 12 以下
    }
}

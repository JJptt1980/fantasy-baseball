package com.jjptt.fantasybaseball;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** App 內登入 Yahoo：使用者自己輸入帳密，登入狀態（cookie）留在 App 裡。 */
public class LoginActivity extends Activity {
    static final String DONE = "https://baseball.fantasysports.yahoo.com/";
    private static final String START = "https://login.yahoo.com/?.src=fantasy&.done=" + Uri_encode(DONE);

    private WebView web;

    private static String Uri_encode(String s) {
        return android.net.Uri.encode(s);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // 導回 Fantasy 首頁 = 登入完成
                if (url != null && url.startsWith(DONE)) {
                    CookieManager.getInstance().flush();
                    setResult(RESULT_OK);
                    finish();
                }
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.addView(web);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        web.loadUrl(START);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}

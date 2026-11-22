package com.jjptt.fantasybaseball;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 給網頁版呼叫的檔案介面（window.FileBridge）：匯出資料包（使用者自己選存哪裡）、匯入資料包（使用者自己選檔案）。
 * 只用系統的檔案選擇畫面，App 不需要儲存權限。
 */
public class FileBridge {
    static final int SAVE_REQUEST = 21;
    static final int OPEN_REQUEST = 22;

    private final Activity activity;
    private final WebView web;
    private String pendingText;

    FileBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @JavascriptInterface
    public void saveText(final String fileName, final String text) {
        pendingText = text;
        activity.runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, fileName);
            activity.startActivityForResult(i, SAVE_REQUEST);
        });
    }

    @JavascriptInterface
    public void openText() {
        activity.runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
            activity.startActivityForResult(i, OPEN_REQUEST);
        });
    }

    /** MainActivity.onActivityResult 轉過來 */
    boolean onResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != SAVE_REQUEST && requestCode != OPEN_REQUEST) return false;
        Uri uri = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == SAVE_REQUEST) {
            boolean ok = false;
            if (uri != null && pendingText != null) {
                try (OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) {
                    out.write(pendingText.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (Exception ignored) { }
            }
            pendingText = null;
            call("window.__onFileSaved && window.__onFileSaved(" + ok + ")");
        } else {
            String text = null;
            if (uri != null) {
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) {
                        buf.write(b, 0, n);
                        if (buf.size() > 5_000_000) throw new IllegalStateException("檔案太大");
                    }
                    text = buf.toString(StandardCharsets.UTF_8.name());
                } catch (Exception ignored) { }
            }
            call("window.__onFileOpened && window.__onFileOpened(" + (text == null ? "null" : JSONObject.quote(text)) + ")");
        }
        return true;
    }

    private void call(String js) {
        activity.runOnUiThread(() -> web.evaluateJavascript(js, null));
    }
}

package com.jjptt.fantasybaseball;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;

/**
 * 給網頁版呼叫的震動與提示音（window.Feedback）。
 * Android 的 App 內網頁不支援 navigator.vibrate，所以由這裡直接叫手機震動、發出提示音。
 */
public class Feedback {
    private final Vibrator vibrator;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ToneGenerator tone;

    Feedback(Context ctx) {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        }
    }

    /** pattern：逗號分隔的毫秒數「震,停,震,停…」；strong＝重要提醒（輪到你），用鬧鐘等級，手機設成「觸控不震動」也會震 */
    @JavascriptInterface
    public void vibrate(String pattern, boolean strong) {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try {
            String[] parts = pattern.split(",");
            long[] t = new long[parts.length + 1];
            t[0] = 0;
            for (int i = 0; i < parts.length; i++) t[i + 1] = Math.max(0, Long.parseLong(parts[i].trim()));
            VibrationEffect fx = t.length == 2
                    ? VibrationEffect.createOneShot(Math.max(1, t[1]), VibrationEffect.DEFAULT_AMPLITUDE)
                    : VibrationEffect.createWaveform(t, -1);
            AudioAttributes aa = new AudioAttributes.Builder()
                    .setUsage(strong ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .build();
            vibrator.vibrate(fx, aa);
        } catch (Exception ignored) { }
    }

    /** kind：now＝輪到你、soon＝快輪到你、pick＝選到人；跟著手機的媒體音量（通知靜音、勿擾模式時也會響；媒體音量調到 0 才不響） */
    @JavascriptInterface
    public void beep(String kind) {
        main.post(() -> {
            try {
                if (tone == null) tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
                switch (kind) {
                    case "now":
                        tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 500);
                        main.postDelayed(() -> tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 500), 700);
                        break;
                    case "soon":
                        tone.startTone(ToneGenerator.TONE_PROP_BEEP, 250);
                        break;
                    default:
                        tone.startTone(ToneGenerator.TONE_PROP_ACK, 150);
                }
            } catch (Exception ignored) { }
        });
    }
}

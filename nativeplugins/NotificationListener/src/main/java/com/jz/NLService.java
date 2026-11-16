package com.jz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 核心：Android 通知监听服务
 * Manifest 中声明此 service + BIND_NOTIFICATION_LISTENER_SERVICE 权限
 *
 * 工作流程：
 * 1) 用户在系统「通知使用权」里勾选本 App
 * 2) JS 侧调用 NotificationListener.start() 启动服务
 * 3) 每当有新通知，onNotificationPosted 解析 pkg + title + text，尝试识别微信/支付宝的支付通知
 * 4) 命中支付语义的，构造 JSON 广播给 uni-app（plus.globalEvent）
 */
public class NLService extends NotificationListenerService {

    private static final String TAG = "NLService";
    private static final String CHANNEL = "nl-channel";
    private static final Pattern PAY_KEY = Pattern.compile("支付|消费|付款|扣款|账单|转账|红包|已支付");
    // 金额必须支持无千位分隔的连续数字（原正则 [0-9]{1,3} 会把 1234.56 截成 234.56）
    private static final Pattern[] MONEY = {
        Pattern.compile("[¥￥]\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"),
        Pattern.compile("([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*元"),
        Pattern.compile("(?:支付|付款|消费|扣款|支出|金额|收款)[^0-9]{0,8}([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")
    };

    /** 从通知文案里提取金额，失败返回 0 */
    private static double parseAmount(String s) {
        for (Pattern p : MONEY) {
            Matcher m = p.matcher(s);
            while (m.find()) {
                try {
                    double d = Double.parseDouble(m.group(1).replace(",", ""));
                    if (d > 0 && d < 1_000_000) return Math.round(d * 100.0) / 100.0;
                } catch (Exception ignored) {}
            }
        }
        return 0;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // 注意：NotificationListenerService 由系统在「用户使用其他 App（本 App 处于后台）」时 bind 并创建。
        // Android 12+ 禁止「后台启动前台服务」，此时 startForeground() 会抛
        // ForegroundServiceStartNotAllowedException；若不在 try/catch 里，会直接导致 onCreate 崩溃，
        // 服务创建失败 → onNotificationPosted 永远不会被回调（现象：完全监听不到任何通知）。
        // 因此这里全部兜住：监听服务本身不需要前台通知也能持续运行。
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) {
                    NotificationChannel c = new NotificationChannel(
                        CHANNEL, "记账本监听服务", NotificationManager.IMPORTANCE_LOW);
                    nm.createNotificationChannel(c);
                    Notification n = new Notification.Builder(this, CHANNEL)
                        .setContentTitle("记账本")
                        .setContentText("正在监听支付通知")
                        .setSmallIcon(android.R.drawable.ic_dialog_info)
                        .build();
                    startForeground(1001, n);
                }
            }
        } catch (Throwable e) {
            // 前台服务启动失败不影响通知监听能力
            Log.w(TAG, "startForeground skipped: " + e);
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            // 支付宝包名是 com.eg.android.AlipayGphone，含大写 A，必须忽略大小写判断
            String lower = pkg.toLowerCase(Locale.ROOT);
            if (!lower.contains("tencent.mm") && !lower.contains("alipay")) return;

            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            CharSequence title = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            // 微信支付凭证常常只写在 BIG_TEXT 里，EXTRA_TEXT 为空
            CharSequence big = n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            String titleStr = title == null ? "" : title.toString();
            String textStr = text == null ? "" : text.toString();
            if (textStr.isEmpty() && big != null) textStr = big.toString();
            final String src = lower.contains("tencent.mm") ? "wx" : "ali";

            // 1) 只处理明确的支付类通知：群聊里出现「支付 300 元」不算消费
            if (!isPaymentNotification(src, titleStr, textStr)) return;

            // 2) 必须能解析出金额
            String full = titleStr + "\n" + textStr + "\n" + (big == null ? "" : big.toString());
            double amt = parseAmount(full);
            if (amt > 0 && !PAY_KEY.matcher(full).find()) amt = 0;
            if (amt <= 0) return;

            // 3) 同一条通知被重复推送（微信会反复更新同一条）只处理一次
            String key = sbn.getKey() == null ? "" : sbn.getKey();
            if (AlertEngine.isDuplicate(key, titleStr + "|" + textStr)) return;

            final double amount = amt;

            // 只在识别成功时留诊断日志：聊天通知不再产生任何写盘
            AlertEngine.addRawLog(getApplicationContext(), pkg, titleStr, textStr, amount, true);

            JSONObject obj = new JSONObject();
            obj.put("pkg", pkg);
            obj.put("source", src);
            obj.put("title", titleStr);
            obj.put("content", textStr);
            obj.put("amount", amount);

            final String json = obj.toString();
            Log.d(TAG, "new notification -> " + json);

            // 原生侧维护预算/档位：后台时由这里直接算阈值并发系统通知
            final String body = (titleStr + " " + textStr).trim();
            final long postTs = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();
            final boolean fg = NotificationListenerModule.isForeground();
            AlertEngine.onTransaction(getApplicationContext(), amount, src, body, postTs, fg);

            // 通过 WXGlobalEventModule.postEvent 派发到 JS 侧（plus.globalEvent.addEventListener）
            // 必须在主线程调用，且用反射避免编译期强依赖
            new Handler(Looper.getMainLooper()).post(() -> postToWeex("new-notification", json));
        } catch (Exception e) {
            Log.e(TAG, "onNotificationPosted", e);
        }
    }

    /**
     * 只认明确的支付类通知，避免聊天内容被误记成消费：
     * 微信：群聊/私聊通知的标题是联系人名，只有「微信支付」服务号的凭证才是真实交易；
     * 支付宝：认交易提醒、支付/收款成功、自动扣款、到账等交易文案。
     */
    private static boolean isPaymentNotification(String src, String title, String text) {
        String t = title == null ? "" : title;
        String all = t + " " + (text == null ? "" : text);
        if ("wx".equals(src)) {
            return t.contains("微信支付") || t.contains("支付凭证") || all.contains("微信支付凭证");
        }
        return all.contains("交易提醒") || all.contains("支付成功") || all.contains("付款成功")
            || all.contains("自动扣款") || all.contains("收款") || all.contains("到账");
    }

    /** 反射调用 com.taobao.weex.common.WXGlobalEventModule.postEvent(eventName, jsonString) */
    private static void postToWeex(String event, String payload) {
        try {
            Class<?> clz = Class.forName("com.taobao.weex.common.WXGlobalEventModule");
            Method method = clz.getMethod("postEvent", String.class, String.class);
            method.invoke(null, event, payload);
        } catch (ClassNotFoundException cnfe) {
            // 非 uni-app 运行环境（例如纯 Android 测试壳），静默失败
            Log.w(TAG, "WXGlobalEventModule not found, skip dispatch");
        } catch (Exception e) {
            Log.e(TAG, "postToWeex failed", e);
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) { /* ignore */ }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        try { AlertEngine.markConnected(getApplicationContext(), true); } catch (Throwable ignored) {}
        Log.i(TAG, "listener connected");
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        try { AlertEngine.markConnected(getApplicationContext(), false); } catch (Throwable ignored) {}
        Log.w(TAG, "listener disconnected, try rebind");
        // 系统断开监听时尝试重连（部分 ROM 需要）
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 24) {
                    requestRebind(new ComponentName(getApplicationContext(), NLService.class));
                }
            } catch (Throwable ignored) {}
        }, 2000);
    }
}

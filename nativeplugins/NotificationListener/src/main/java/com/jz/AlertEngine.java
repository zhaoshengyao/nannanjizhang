package com.jz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 告警引擎：原生侧维护预算配置、本月支出、档位判断、系统通知、后台账单暂存
 * 前台由 JS 调用 postAlert；后台由 NLService 在收到支付通知时调用 onTransaction
 */
final class AlertEngine {

    private static final String TAG = "AlertEngine";
    static final String PREFS = "jz_nl_state";
    static final String CHANNEL = "jz-alert";
    private static final int NOTIFY_ID_BASE = 1100;

    private AlertEngine() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String monthKey() {
        return new SimpleDateFormat("yyyy-MM", Locale.CHINA).format(new Date());
    }

    private static String dayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new Date());
    }

    /** JS 同步配置：budget / levels(JSON 字符串) / reminder / monthSpent / monthKey */
    static synchronized void syncConfig(Context ctx, JSONObject cfg) {
        SharedPreferences sp = prefs(ctx);
        SharedPreferences.Editor e = sp.edit();
        if (cfg.has("budget")) e.putFloat("budget", (float) cfg.optDouble("budget", 0));
        if (cfg.has("reminder")) e.putString("reminder", cfg.optString("reminder", "daily"));
        if (cfg.has("levels")) e.putString("levels", cfg.optString("levels", "[]"));
        // JS 的账单是权威数据，直接覆盖原生累计值
        e.putString("monthKey", cfg.optString("monthKey", monthKey()));
        if (cfg.has("monthSpent")) e.putFloat("monthSpent", (float) cfg.optDouble("monthSpent", 0));
        e.apply();
    }

    /** 收到一笔来自微信/支付宝的支付通知（可能发生在后台） */
    static synchronized void onTransaction(Context ctx, double amount, String source, String content, long ts, boolean foreground) {
        SharedPreferences sp = prefs(ctx);
        String mk = monthKey();
        if (!mk.equals(sp.getString("monthKey", mk))) {
            sp.edit().putString("monthKey", mk).putFloat("monthSpent", 0f).apply();
        }
        float before = sp.getFloat("monthSpent", 0f);
        float after = (float) (before + amount);
        sp.edit().putFloat("monthSpent", after).apply();

        // 全部暂存：JS 前台时轮询拉取（广播可能因反射失败而丢事件），后台时等启动补录
        addPending(ctx, amount, source, content, ts);

        float budget = sp.getFloat("budget", 0f);
        if (budget <= 0) return;

        JSONArray levels = parseLevels(sp.getString("levels", "[]"));
        double afterPct = after / budget * 100;
        int hit = 0;
        // 取「当前已达到的最高档位」，而不是只在跨越的那一笔提醒。
        // 否则同一档位在这个月里只会响一次，「每次/每天」的频率设置形同虚设。
        // JS 侧档位已按升序保存，这里从高到低检查
        for (int i = levels.length() - 1; i >= 0; i--) {
            JSONObject l = levels.optJSONObject(i);
            if (l == null || !l.optBoolean("on", false)) continue;
            double p = l.optDouble("pct", 0);
            if (afterPct >= p) {
                hit = (int) Math.round(p);
                break;
            }
        }
        if (hit <= 0) return;

        String title = afterPct >= 100 ? "本月预算已超支" : "预算已用 " + (int) Math.round(afterPct) + "%";
        String body = String.format(Locale.CHINA, "已用 ¥%.2f / 预算 ¥%.2f，触发 %d%% 档", after, budget, hit);
        notifyIfAllowed(ctx, hit, title, body);
    }

    /** 按「提醒频率」去重：each 每次都发；daily 每档每天一次；first 每档每月一次 */
    private static boolean shouldNotify(SharedPreferences sp, int level) {
        String reminder = sp.getString("reminder", "daily");
        if ("each".equals(reminder)) return true;
        if ("first".equals(reminder)) {
            String mk = monthKey();
            String key = "lastMonLevel" + level;
            if (mk.equals(sp.getString(key, ""))) return false;
            sp.edit().putString(key, mk).apply();
            return true;
        }
        String dk = dayKey();
        String key = "lastLevel" + level;
        if (dk.equals(sp.getString(key, ""))) return false;
        sp.edit().putString(key, dk).apply();
        return true;
    }

    /** 带去重的系统通知，返回是否真的发出 */
    static synchronized boolean notifyIfAllowed(Context ctx, int level, String title, String body) {
        SharedPreferences sp = prefs(ctx);
        if (!shouldNotify(sp, level)) return false;
        postAlert(ctx, title, body, level);
        return true;
    }

    /** 直接发系统通知：高优先级渠道 + 震动 + 点击打开 App 定位阈值页 */
    static void postAlert(Context ctx, String title, String body, int level) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "预算告警", NotificationManager.IMPORTANCE_HIGH);
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 300, 150, 300});
                nm.createNotificationChannel(ch);
            }

            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (launch == null) return;
            launch.putExtra("jz_page", "threshold");
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            // 同时写入 SharedPreferences 兜底：Activity 走 onNewIntent 时 getIntent() 拿不到新值
            prefs(ctx).edit().putString("launchPage", "threshold").apply();
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(ctx, NOTIFY_ID_BASE + level, launch, flags);

            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                b = new Notification.Builder(ctx, CHANNEL);
            } else {
                b = new Notification.Builder(ctx).setPriority(Notification.PRIORITY_HIGH);
                b.setVibrate(new long[]{0, 300, 150, 300});
            }
            b.setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setAutoCancel(true)
                .setContentIntent(pi);

            nm.notify(NOTIFY_ID_BASE + level, b.build());
        } catch (Exception e) {
            Log.e(TAG, "postAlert failed", e);
        }
    }

    private static void addPending(Context ctx, double amount, String source, String content, long ts) {
        SharedPreferences sp = prefs(ctx);
        try {
            JSONArray arr = new JSONArray(sp.getString("pending", "[]"));
            JSONObject o = new JSONObject();
            o.put("id", "nl-" + ts + "-" + (int) (Math.random() * 1000));
            o.put("amount", amount);
            o.put("source", source);
            o.put("note", content);
            o.put("ts", ts);
            arr.put(o);
            if (arr.length() > 200) {
                JSONArray cut = new JSONArray();
                for (int i = arr.length() - 200; i < arr.length(); i++) cut.put(arr.get(i));
                arr = cut;
            }
            sp.edit().putString("pending", arr.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "addPending failed", e);
        }
    }

    /** JS 拉取后台暂存的账单（拉取后清空） */
    static synchronized String pullPending(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        String json = sp.getString("pending", "[]");
        sp.edit().putString("pending", "[]").apply();
        return json;
    }

    /** 记录一条原始通知（用于 App 内诊断，最多 20 条） */
    static synchronized void addRawLog(Context ctx, String pkg, String title, String text, double amount, boolean matched) {
        try {
            SharedPreferences sp = prefs(ctx);
            JSONArray arr = new JSONArray(sp.getString("rawlog", "[]"));
            JSONObject o = new JSONObject();
            o.put("pkg", pkg);
            o.put("title", title);
            o.put("text", text);
            o.put("amount", amount);
            o.put("matched", matched);
            o.put("ts", System.currentTimeMillis());
            arr.put(o);
            if (arr.length() > 20) {
                JSONArray cut = new JSONArray();
                for (int i = arr.length() - 20; i < arr.length(); i++) cut.put(arr.get(i));
                arr = cut;
            }
            sp.edit().putString("rawlog", arr.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "addRawLog failed", e);
        }
    }

    /** 读取原始通知日志 */
    static synchronized String getRawLog(Context ctx) {
        if (ctx == null) return "[]";
        return prefs(ctx).getString("rawlog", "[]");
    }

    /** 同一条系统通知被重复推送（微信会反复更新同一条）时，只处理一次。
     *  窗口必须短：微信若对同一会话复用通知 key，两笔同金额消费的文案可能完全相同，
     *  窗口过大会把真实的第二笔当成重复丢掉。
     *  只放内存、不落盘：服务重启后只会收到新通知，不存在历史重放问题。 */
    private static final android.util.LruCache<String, Long> HANDLED = new android.util.LruCache<>(64);
    private static final long DUP_WINDOW_MS = 15_000L;

    static synchronized boolean isDuplicate(String key, String text) {
        String id = key + "#" + (text == null ? 0 : text.hashCode());
        long now = System.currentTimeMillis();
        Long last = HANDLED.get(id);
        if (last != null && now - last < DUP_WINDOW_MS) return true;
        HANDLED.put(id, now);
        return false;
    }

    /** 记录监听服务连接状态 */
    static synchronized void markConnected(Context ctx, boolean connected) {
        try {
            prefs(ctx).edit()
                .putBoolean("connected", connected)
                .putLong("connTs", System.currentTimeMillis())
                .apply();
        } catch (Exception e) {
            Log.e(TAG, "markConnected failed", e);
        }
    }

    /** 读取捕获统计（诊断） */
    static synchronized JSONObject getStats(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences sp = prefs(ctx);
            o.put("anyTotal", sp.getInt("anyTotal", 0));
            o.put("lastPkg", sp.getString("anyLastPkg", ""));
            o.put("lastTs", sp.getLong("anyLastTs", 0));
            o.put("connected", sp.getBoolean("connected", false));
            o.put("connTs", sp.getLong("connTs", 0));
        } catch (Exception e) {
            Log.e(TAG, "getStats failed", e);
        }
        return o;
    }

    /** JS 取一次「通知点击来源页」，取后清除。
     *  优先从 SharedPreferences 读（兜底 onNewIntent 场景下 getIntent() 拿不到新值），
     *  同时兼容 Intent extra 路径（用于首次安装启动场景）。 */
    static synchronized String consumeLaunchPage(Context ctx) {
        try {
            // 1) SharedPreferences（postAlert 发通知时写入，最可靠）
            SharedPreferences sp = prefs(ctx);
            String fromSp = sp.getString("launchPage", "");
            if (!fromSp.isEmpty()) {
                sp.edit().remove("launchPage").apply();
                return fromSp;
            }
            // 2) Intent extra 兜底（全新启动 Activity 场景）
            if (ctx instanceof android.app.Activity) {
                Intent i = ((android.app.Activity) ctx).getIntent();
                if (i != null) {
                    String p = i.getStringExtra("jz_page");
                    if (p != null && !p.isEmpty()) {
                        i.removeExtra("jz_page");
                        return p;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "consumeLaunchPage failed", e);
        }
        return "";
    }

    private static JSONArray parseLevels(String raw) {
        try {
            return new JSONArray(raw == null || raw.isEmpty() ? "[]" : raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }
}

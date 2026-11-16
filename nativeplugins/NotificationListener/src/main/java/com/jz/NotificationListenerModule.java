package com.jz;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;

import com.taobao.weex.annotation.JSMethod;
import com.taobao.weex.bridge.JSCallback;
import com.taobao.weex.common.WXModule;
import com.taobao.weex.WXSDKInstance;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * uni-app 原生插件：NotificationListener
 * 提供 JS 可调用方法：check / open / start / stop / syncConfig / postAlert / pullPending / consumeLaunchPage / setForeground
 * 真正的监听逻辑在 NLService（extends NotificationListenerService）里完成
 */
public class NotificationListenerModule extends WXModule {

    private static final String TAG = "NotifyListener";

    /** App 是否在前台：前台时由 JS 负责入库，后台才暂存原生账单 */
    private static volatile boolean foreground = false;

    static boolean isForeground() { return foreground; }

    /**
     * 取 Context：优先 SDK 实例，回退到 Application。
     * @JSMethod(uiThread = false) 在子线程执行时 mWXSDKInstance 可能为 null，
     * 直接调 getContext() 会抛 NPE（且 message 为 null，JS 侧看不到任何原因）。
     */
    private static Context appCtx(WXSDKInstance inst) {
        try {
            if (inst != null) {
                Context c = inst.getContext();
                if (c != null) return c;
            }
        } catch (Throwable ignored) {}
        try {
            Class<?> at = Class.forName("android.app.ActivityThread");
            Method m = at.getMethod("currentApplication");
            return (Context) m.invoke(null);
        } catch (Throwable ignored) {}
        return null;
    }

    /** App.vue onShow / onHide 时调用，传 "1" 前台，"0" 后台 */
    @JSMethod
    public void setForeground(String f) {
        foreground = "1".equals(f);
    }

    /** 同步预算 / 档位 / 提醒频率 / 本月支出给原生，供后台告警使用 */
    @JSMethod
    public void syncConfig(String json, JSCallback success) {
        try {
            Context ctx = appCtx(mWXSDKInstance);
            AlertEngine.syncConfig(ctx, new JSONObject(json == null ? "{}" : json));
        } catch (Exception e) {
            Log.e(TAG, "syncConfig", e);
        }
        if (success != null) success.invoke(null);
    }

    /** 前台告警时发系统通知（原生侧同档位同天去重） */
    @JSMethod
    public void postAlert(String title, String body, int level, JSCallback success) {
        try {
            Context ctx = appCtx(mWXSDKInstance);
            boolean posted = AlertEngine.notifyIfAllowed(ctx, level, title, body);
            if (success != null) {
                JSONObject r = new JSONObject();
                r.put("posted", posted);
                success.invoke(r);
            }
        } catch (Exception e) {
            Log.e(TAG, "postAlert", e);
            if (success != null) success.invoke(null);
        }
    }

    /** 拉取后台暂存的账单（拉后清空） */
    @JSMethod
    public void pullPending(JSCallback success) {
        if (success == null) return;
        try {
            Context ctx = appCtx(mWXSDKInstance);
            JSONObject r = new JSONObject();
            r.put("list", new JSONArray(AlertEngine.pullPending(ctx)));
            success.invoke(r);
        } catch (Exception e) {
            Log.e(TAG, "pullPending", e);
            success.invoke(null);
        }
    }

    /** 点击系统通知启动 App 时，取来源页标识（取后清除） */
    @JSMethod
    public void consumeLaunchPage(JSCallback success) {
        if (success == null) return;
        try {
            Context ctx = appCtx(mWXSDKInstance);
            JSONObject r = new JSONObject();
            r.put("page", AlertEngine.consumeLaunchPage(ctx));
            success.invoke(r);
        } catch (Exception e) {
            Log.e(TAG, "consumeLaunchPage", e);
            success.invoke(null);
        }
    }

    /** 检查是否已授权通知使用权 */
    @JSMethod
    public void check(JSCallback success) {
        if (success == null) return;
        JSONObject r = new JSONObject();
        String enabled = null;
        try {
            Context ctx = appCtx(mWXSDKInstance);
            String pkg = ctx.getPackageName();
            ComponentName self = new ComponentName(ctx, NLService.class);
            enabled = Settings.Secure.getString(
                ctx.getContentResolver(), "enabled_notification_listeners");

            // 系统里存的是「包名/类名」冒号分隔列表。不同 ROM 对类名的写法不一
            // （全限定名或短名），所以按包名逐条匹配最稳，再兜底全名包含判断。
            boolean granted = false;
            if (!TextUtils.isEmpty(enabled)) {
                String[] items = enabled.split(":");
                for (String s : items) {
                    if (TextUtils.isEmpty(s)) continue;
                    ComponentName c = ComponentName.unflattenFromString(s);
                    if (c != null && pkg.equals(c.getPackageName())) { granted = true; break; }
                    if (s.startsWith(pkg + "/")) { granted = true; break; }
                }
                if (!granted) {
                    granted = enabled.contains(self.flattenToString())
                            || enabled.contains(self.flattenToShortString());
                }
            }
            r.put("granted", granted);
            r.put("pkg", pkg);
            r.put("self", self.flattenToString());
            r.put("raw", enabled == null ? "" : enabled);
        } catch (Throwable e) {
            Log.e(TAG, "check", e);
            try {
                r.put("granted", false);
                r.put("fail", String.valueOf(e));
                r.put("raw", enabled == null ? "" : enabled);
            } catch (Exception ignored) {}
        }
        try { success.invoke(r); } catch (Exception ignored) {}
    }

    /** 跳转到系统通知使用权设置页 */
    @JSMethod
    public void open(JSCallback success) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Context ctx = appCtx(mWXSDKInstance);
            if (ctx == null) throw new IllegalStateException("无法获取 Context");
            ctx.startActivity(intent);
            if (success != null) success.invoke(null);
        } catch (Exception e) { Log.e(TAG, "open", e); }
    }

    /**
     * 启动监听：NotificationListenerService 是系统服务，
     * 用户在「通知使用权」里勾选后系统自动 bind，应用不能手动 start。
     * 这里仅做一个空实现（服务在授权后由系统托管）。
     */
    @JSMethod
    public void start(JSCallback success) {
        // NotificationListenerService 由系统在用户授权后 bind；但多次重装/国产 ROM 上，
        // 系统可能仍显示"已授权"却没真正连接（onListenerConnected 不触发）。
        // 这里主动请求系统重新绑定（API 24+），是修复"权限开着但收不到"的标准做法。
        try {
            Context ctx = appCtx(mWXSDKInstance);
            if (ctx != null && Build.VERSION.SDK_INT >= 24) {
                ComponentName cn = new ComponentName(ctx.getPackageName(), NLService.class.getName());
                NotificationListenerService.requestRebind(cn);
            }
        } catch (Throwable e) {
            Log.e(TAG, "requestRebind failed", e);
        }
        if (success != null) success.invoke(null);
    }

    /** 停止监听（实际上监听服务由系统管理，应用无权 stop） */
    @JSMethod
    public void stop(JSCallback success) {
        if (success != null) success.invoke(null);
    }

    /** 读取最近收到的微信/支付宝原始通知（诊断用）。只读内存和 SharedPreferences，直接在 UI 线程执行。 */
    @JSMethod
    public void getRawLog(JSCallback cb) {
        JSONObject ret = new JSONObject();
        try {
            // 版本标记必须最先写入：旧原生模块没有此字段，JS 可据此识别新旧 AAR 混用。
            ret.put("nativeRev", 2);
            ret.put("ok", false);
            ret.put("log", "[]");
            Context ctx = appCtx(mWXSDKInstance);
            if (ctx == null) throw new IllegalStateException("appCtx=null");

            String pkg = ctx.getPackageName();
            String selfComp = pkg + "/" + NLService.class.getName();
            ret.put("selfComponent", selfComp);
            ret.put("log", AlertEngine.getRawLog(ctx));
            JSONObject st = AlertEngine.getStats(ctx);
            ret.put("anyTotal", st.optInt("anyTotal", 0));
            ret.put("lastPkg", st.optString("lastPkg", ""));
            ret.put("lastTs", st.optLong("lastTs", 0));
            ret.put("connected", st.optBoolean("connected", false));
            ret.put("connTs", st.optLong("connTs", 0));

            boolean declared = false;
            try {
                ComponentName cn = new ComponentName(pkg, NLService.class.getName());
                ctx.getPackageManager().getServiceInfo(cn, 0);
                declared = true;
            } catch (Throwable ignored) {}
            ret.put("declared", declared);

            String enabled = "";
            try {
                enabled = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
            } catch (Throwable ignored) {}
            if (enabled == null) enabled = "";
            ret.put("enabledList", enabled);

            // 系统可能保存全类名，也可能保存短类名；统一用 ComponentName 比较，避免字符串误判。
            boolean enabledHasSelf = false;
            for (String item : enabled.split(":")) {
                ComponentName c = ComponentName.unflattenFromString(item);
                if (c != null && pkg.equals(c.getPackageName())
                        && NLService.class.getName().equals(c.getClassName())) {
                    enabledHasSelf = true;
                    break;
                }
            }
            ret.put("enabledHasSelf", enabledHasSelf);
            ret.put("ok", true);
        } catch (Throwable e) {
            Log.e(TAG, "getRawLog", e);
            try { ret.put("msg", e.getClass().getSimpleName() + ": " + e.getMessage()); }
            catch (Exception ignored) {}
        }
        if (cb != null) {
            try { cb.invoke(ret); } catch (Throwable ignored) {}
        }
    }

    /**
     * 把 base64 内容保存到系统「下载」目录（Download/）。
     * Android 10+ 走 MediaStore，无需任何存储权限；10 以下回退到公共 Downloads 目录。
     */
    @JSMethod(uiThread = false)
    public void saveToDownloads(String base64, String fileName, JSCallback cb) {
        JSONObject ret = new JSONObject();
        try {
            Context ctx = appCtx(mWXSDKInstance);
            if (ctx == null) throw new IllegalStateException("无法获取 Context");
            byte[] data = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
            String saved = null;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                cv.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IllegalStateException("MediaStore 未返回下载文件 Uri");
                OutputStream os = null;
                try {
                    os = ctx.getContentResolver().openOutputStream(uri);
                    if (os == null) throw new IllegalStateException("无法打开下载文件输出流");
                    os.write(data);
                    os.flush();
                    os.close();
                    os = null;
                    saved = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS), fileName).getAbsolutePath();
                } finally {
                    try { if (os != null) os.close(); } catch (Exception ignored) {}
                    // 写一半失败时删除残缺文件，避免 Download 中留下 0 字节 CSV
                    if (saved == null) {
                        try { ctx.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
                    }
                }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null) {
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, fileName);
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(data);
                    fos.flush();
                    fos.close();
                    saved = f.getAbsolutePath();
                }
            }
            ret.put("ok", saved != null);
            ret.put("path", saved == null ? "" : saved);
        } catch (Throwable e) {
            Log.e(TAG, "saveToDownloads", e);
            try { ret.put("ok", false); ret.put("msg", String.valueOf(e)); } catch (Exception ignored) {}
        }
        final JSONObject out = ret;
        if (cb != null) new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { try { cb.invoke(out); } catch (Throwable ignored) {} }
        });
    }

    /**
     * 读取用户通过系统文件选择器选中的文件（content:// uri），返回 base64
     * 供 JS 解析 CSV / XLSX 账单使用
     */
    @JSMethod(uiThread = false)
    public void readUriAsBase64(String uriStr, JSCallback cb) {
        JSONObject ret = new JSONObject();
        InputStream in = null;
        try {
            Context ctx = appCtx(mWXSDKInstance);
            if (ctx == null) throw new IllegalStateException("无法获取 Context");
            Uri uri = Uri.parse(uriStr);
            in = ctx.getContentResolver().openInputStream(uri);
            if (in == null) throw new IllegalStateException("openInputStream 返回 null");
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            byte[] data = bos.toByteArray();
            ret.put("ok", true);
            ret.put("size", data.length);
            ret.put("base64", Base64.encodeToString(data, Base64.NO_WRAP));
        } catch (Throwable e) {
            Log.e(TAG, "readUriAsBase64 " + uriStr, e);
            try {
                ret.put("ok", false);
                // 异常 message 可能为 null（如 NPE），带上类名才不会看到空白原因
                ret.put("msg", e.getClass().getSimpleName() + ": " + e.getMessage() + " | " + uriStr);
            } catch (Exception ignored) {}
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
        }
        // uiThread=false 时本方法在工作线程执行，JSCallback 必须在主线程 invoke，否则回调会被丢弃
        final JSONObject out = ret;
        if (cb != null) new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { try { cb.invoke(out); } catch (Throwable ignored) {} }
        });
    }
}

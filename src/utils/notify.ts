// JS 桥接：Android 通知监听插件
// H5 端：浏览器无法读取其他 App 的通知，能力降级为系统 Notification（仅在网页打开时可用）
// App-Android：通过 uni.requireNativePlugin('NotificationListener') 调用

const isApp = typeof plus !== 'undefined' && !!plus.android

function plug() {
  try { return uni.requireNativePlugin('NotificationListener') } catch (e) { return null }
}

export interface ParsedNotification {
  source: 'wx' | 'ali' | 'manual'
  title: string
  content: string
  amount?: number
}

export interface PermDetail {
  granted: boolean
  raw?: string
  self?: string
  pkg?: string
}

/** 直接读系统「通知使用权」列表（不依赖原生插件，作为兜底判定） */
function readEnabledListeners(): { raw: string; pkg: string } | null {
  if (!isApp) return null
  try {
    const main = plus.android.runtimeMainActivity() as any
    const pkg = String(main.getPackageName())
    const Secure = plus.android.importClass('android.provider.Settings$Secure') as any
    const raw = String(Secure.getString(main.getContentResolver(), 'enabled_notification_listeners') || '')
    return { raw, pkg }
  } catch (e) { return null }
}

/** 检查系统通知使用权（含诊断信息，仅 Android App） */
export async function checkPermissionDetail(): Promise<PermDetail> {
  if (!isApp) return { granted: false }
  const sys = readEnabledListeners()
  const inSys = !!(sys && sys.raw.includes(sys.pkg))
  const p = plug()
  if (!p || typeof p.check !== 'function') {
    // 插件未注册（如运行在无插件基座）时，仍以系统授权记录为准
    return { granted: inSys, raw: sys?.raw, pkg: sys?.pkg }
  }
  return new Promise<PermDetail>((resolve) => {
    let done = false
    const finish = (r: PermDetail) => {
      if (done) return
      done = true
      if (!r.granted && inSys) {
        // 插件判定失败，但系统里确实有本包的监听器 → 视为已授权
        resolve({ granted: true, raw: sys?.raw || r.raw, self: r.self, pkg: sys?.pkg })
        return
      }
      resolve({ ...r, raw: r.raw || sys?.raw })
    }
    try {
      // 原生模块 @JSMethod 的 JSCallback 用裸函数回调（与 readUriAsBase64 验证可用的写法一致）
      p.check((r: any) => finish({
        granted: !!r?.granted,
        raw: r?.raw,
        self: r?.self,
        pkg: r?.pkg
      }))
    } catch (e) { finish({ granted: false }) }
    // 原生侧异常时不回回调，避免 await 永久挂起导致状态一直停在「未授权」
    setTimeout(() => finish({ granted: false }), 1200)
  })
}

/** 检查系统通知使用权是否已授权（仅 Android App） */
export async function checkPermission(): Promise<boolean> {
  const r = await checkPermissionDetail()
  return r.granted
}

/** 打开系统通知使用权设置页（仅 Android App） */
export function openSettings() {
  if (!isApp) {
    if (typeof uni !== 'undefined') uni.showToast({ title: '浏览器无法读取系统通知，打包为 Android App 后可用', icon: 'none' })
    return
  }
  const Intent = plus.android.importClass('android.content.Intent')
  const Settings = plus.android.importClass('android.provider.Settings')
  const intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
  const activity = plus.android.runtimeMainActivity()
  activity.startActivity(intent)
}

/**
 * 启动监听（仅 Android App）。
 * 说明：原生侧的 plus.globalEvent 广播在当前 uni-app 运行时不可用，
 * 记账数据统一由 1.5 秒轮询 pullPendingRecords 拉取，这里只负责确保服务已绑定。
 */
export function startListening() {
  if (!isApp) return
  ensureListenerBinding()
}

// ---------------------------------------------------------
// 系统通知（前台/后台）
// ---------------------------------------------------------

/** 标记 App 前后台，后台时原生侧才暂存账单（前台由 JS 入库） */
export function setNativeForeground(fg: boolean) {
  if (!isApp) return
  const p = plug(); if (!p) return
  try { p.setForeground(fg ? '1' : '0') } catch (e) {}
}

/** Android 13+ 申请通知展示权限（POST_NOTIFICATIONS） */
export function requestNotifyPermission() {
  if (!isApp) return
  try {
    if (plus.os.name === 'Android') {
      const Build = plus.android.importClass('android.os.Build')
      const sdk = Number(Build.VERSION.SDK_INT)
      if (sdk >= 33) {
        plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'], () => {}, () => {})
      }
    }
  } catch (e) {}
}

/** 同步预算 / 档位 / 提醒频率 / 本月支出给原生，供后台告警使用 */
export function syncNativeConfig(cfg: {
  budget: number
  levels: { pct: number; on: boolean }[]
  reminder: 'each' | 'daily' | 'first'
  monthSpent: number
  monthKey: string
}) {
  if (!isApp) return
  const p = plug(); if (!p) return
  try {
    p.syncConfig(JSON.stringify({ ...cfg, levels: JSON.stringify(cfg.levels) }))
  } catch (e) {}
}

/**
 * 发系统通知：App 端走高优先级通知渠道（原生去重：同档位同天一条）；
 * H5 端降级为浏览器通知（需用户允许）
 */
export function postSystemAlert(title: string, body: string, level: number) {
  if (isApp) {
    const p = plug()
    if (p) {
      try { p.postAlert(title, body, Math.round(level)) } catch (e) {}
      return
    }
  }
  try {
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification(title, { body })
      } else if (Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }
  } catch (e) {}
}

/** 主动请求系统重新绑定监听服务（修复"权限开着但没连上"，国产 ROM 常见） */
export function ensureListenerBinding() {
  if (!isApp) return
  try {
    const main = plus.android.runtimeMainActivity() as any
    const BuildVersion = plus.android.importClass('android.os.Build$VERSION') as any
    if (Number(BuildVersion.SDK_INT) >= 24) {
      const ComponentName = plus.android.importClass('android.content.ComponentName') as any
      const ListenerService = plus.android.importClass('android.service.notification.NotificationListenerService') as any
      const cn = new ComponentName(String(main.getPackageName()), 'com.jz.NLService')
      ListenerService.requestRebind(cn)
      return
    }
  } catch (e) {}
  // 老系统或 Native.js 调用失败时保留插件通道。
  const p = plug()
  if (!p || typeof p.start !== 'function') return
  try { p.start(() => {}) } catch (e) {}
}

function parsePendingJson(value: any): any[] | null {
  try {
    const arr = JSON.parse(String(value || '[]'))
    return Array.isArray(arr) ? arr : null
  } catch (e) { return null }
}

let pullOkLogged = false
let lastPendingLen = -1

/** 写系统日志，正式包也会出现在 logcat，便于真机定位（console 在正式包会被移除） */
export function jzLog(msg: string) {
  try {
    const Log = plus.android.importClass('android.util.Log') as any
    Log.d('JZBridge', msg)
  } catch (e) {}
}

/**
 * 只读方式读取原生暂存记录（不依赖 Weex 回调）。
 * 优先复用诊断页已验证的 prefs 读法，再用 plus.android.invoke 兜底；
 * 读取后不清空，由 JS 侧按 id 去重，避免「读后清空」与写入并发丢单。
 */
function readPendingByNativeJs(): any[] | null {
  if (!isApp) return []
  const main = plus.android.runtimeMainActivity() as any
  if (!main) { jzLog('read pending: no activity'); return null }

  // 方式一：与诊断页 getRawLog 完全相同的写法（已在真机验证能读到 jz_nl_state）
  try {
    plus.android.importClass('android.content.SharedPreferences')
    const sp = main.getSharedPreferences('jz_nl_state', 0)
    if (sp) {
      plus.android.importClass(sp)
      const list = parsePendingJson(sp.getString('pending', '[]'))
      if (list) return list
    }
  } catch (e: any) {
    jzLog(`pending prefs direct failed: ${e?.message || e}`)
  }

  // 方式二：反射调用，实例方法未映射到代理对象时的兜底
  try {
    const android = plus.android as any
    const sp = android.invoke(main, 'getSharedPreferences', 'jz_nl_state', 0)
    if (sp) {
      const list = parsePendingJson(android.invoke(sp, 'getString', 'pending', '[]'))
      if (list) return list
    }
  } catch (e: any) {
    jzLog(`pending prefs invoke failed: ${e?.message || e}`)
  }

  jzLog('read pending: both ways failed')
  return null
}

/**
 * 清空原生暂存与原始通知日志。
 * 「恢复初始状态」时调用，保证不残留任何自动记账数据。
 */
export function clearNativePending() {
  if (!isApp) return
  const main = plus.android.runtimeMainActivity() as any
  if (!main) return

  // 与诊断页一致：先走已验证的直接调用
  try {
    plus.android.importClass('android.content.SharedPreferences')
    const sp = main.getSharedPreferences('jz_nl_state', 0)
    if (sp) {
      plus.android.importClass(sp)
      const editor = sp.edit()
      if (editor) {
        plus.android.importClass(editor)
        editor.putString('pending', '[]')
        editor.putString('rawlog', '[]')
        editor.apply()
        return
      }
    }
  } catch (e: any) {
    jzLog(`clear native pending direct failed: ${e?.message || e}`)
  }

  try {
    const android = plus.android as any
    const sp = android.invoke(main, 'getSharedPreferences', 'jz_nl_state', 0)
    const editor = android.invoke(sp, 'edit')
    android.invoke(editor, 'putString', 'pending', '[]')
    android.invoke(editor, 'putString', 'rawlog', '[]')
    android.invoke(editor, 'apply')
  } catch (e: any) {
    jzLog(`clear native pending invoke failed: ${e?.message || e}`)
  }
}

/** 拉取原生暂存的账单（只读，不清空；由 JS 按 id 去重） */
export function pullPendingRecords(): Promise<any[]> {
  if (!isApp) return Promise.resolve([])
  try {
    const list = readPendingByNativeJs()
    if (list) {
      // 首次成功 + 数量变化才记日志（轮询 1.5 秒一次，避免刷屏）
      if (!pullOkLogged || list.length !== lastPendingLen) {
        pullOkLogged = true
        lastPendingLen = list.length
        jzLog(`pending read ok, size=${list.length}`)
      }
      return Promise.resolve(list)
    }
  } catch (e) {}

  // Native.js 不可用时保留插件通道，并设置超时避免 onLaunch 永久挂起。
  const p = plug()
  if (!p) return Promise.resolve([])
  return new Promise((resolve) => {
    let done = false
    const finish = (arr: any[]) => { if (!done) { done = true; resolve(arr) } }
    try {
      p.pullPending((r: any) => {
        const value = Array.isArray(r?.list) ? r.list : parsePendingJson(r?.listJson || r?.list)
        jzLog(`pending from plugin: ${value ? value.length : 'null'}`)
        finish(value || [])
      })
    } catch (e) { finish([]) }
    setTimeout(() => finish([]), 2500)
  })
}

/** 点击系统通知启动 App 时读取来源页（如 threshold） */
export function consumeLaunchPage(): Promise<string> {
  if (!isApp) return Promise.resolve('')
  const p = plug()
  if (!p) return Promise.resolve('')
  return new Promise((resolve) => {
    let done = false
    const finish = (v: string) => { if (!done) { done = true; resolve(v) } }
    try {
      // 裸函数回调（原生 @JSMethod 的 JSCallback）
      p.consumeLaunchPage((r: any) => finish(r?.page || ''))
    } catch (e) { finish('') }
    setTimeout(() => finish(''), 1500)
  })
}

/** 系统通知文案：按实际百分比三档 */
export function alertCopy(a: { level: number; spent: number; limit: number; scope?: string; catName?: string }) {
  const pct = a.limit ? a.spent / a.limit * 100 : 0
  const title = pct >= 100 ? '已超支' : pct >= 90 ? '即将超支' : `预算已用 ${Math.round(pct)}%`
  const body = a.scope === 'cat'
    ? `${a.catName || '分类'}支出 ¥${a.spent.toFixed(2)} / ¥${a.limit.toFixed(2)}（${a.level}% 档）`
    : `已用 ¥${a.spent.toFixed(2)} / 预算 ¥${a.limit.toFixed(2)}（${a.level}% 档）`
  return { title, body, pct }
}

/**
 * 解析通知文本，提取金额 + 来源
 * 真实 Android 插件中会在 NotificationListenerService.onNotificationPosted 调用此函数
 */
export function parseNotification(pkg: string, title: string, content: string): ParsedNotification | null {
  const source: 'wx' | 'ali' | 'manual' =
    pkg.indexOf('tencent.mm') >= 0 ? 'wx' :
    pkg.indexOf('AlipayGphone') >= 0 || pkg.indexOf('alipay') >= 0 ? 'ali' : 'manual'

  // 正则匹配金额（支持「¥1,234.56」「12.34元」「+128」等常见格式）
  const m = content.match(/([¥￥]\s*)?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:元|块)?/)
  let amount: number | undefined
  if (m) {
    const raw = m[2].replace(/,/g, '')
    const n = parseFloat(raw)
    if (n > 0 && n < 1000000) amount = Math.round(n * 100) / 100
  }
  // 金额必须出现在「支付成功 / 消费」等语境里，防止把普通消息里的数字误判
  if (amount && !/支付|消费|付款|扣款|账单|转账|红包/.test(content)) amount = undefined

  return { source, title, content, amount }
}

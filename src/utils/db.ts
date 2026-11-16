// 存储适配层：统一使用 uni 本地存储（App / H5 / 小程序均有原生实现）
// 早期版本用 plus.sqlite 存 KV，但 openDatabase 是异步的，页面读取时机早于数据库就绪，
// 且路径写成相对路径，导致「读不到 / 写不进」——表现为重启后数据全部归零。KV 场景无需 SQLite。
const DB_KEY = 'jz-state-v1'

let ready = false

export function isAppPlatform() {
  return typeof plus !== 'undefined'
}

/** 兼容旧调用；uni 存储无异步初始化需求 */
export function ensureDb(): boolean {
  ready = true
  return true
}

/**
 * 同步读取完整状态。
 * 必须是同步的：App 端首屏页面可能在 onLaunch 的异步初始化完成前就挂载，
 * 异步读会让页面先看到空状态（onboarded=false），误跳引导页。
 */
export function loadStateSync(): string | null {
  try {
    const raw = uni.getStorageSync(DB_KEY)
    if (typeof raw === 'string' && raw.length) return raw
    // 兼容极端情况：存储返回对象
    if (raw && typeof raw === 'object') return JSON.stringify(raw)
    return null
  } catch (e) {
    return null
  }
}

/** 恢复初始状态时移除旧快照；没有快照时启动会自然回到未引导状态 */
export function clearState(): void {
  try {
    uni.removeStorageSync(DB_KEY)
  } catch (e) {
    console.error('[db] clearState failed', e)
  }
}

/** 异步持久化完整状态 */
export async function saveState(raw: string): Promise<void> {
  try {
    uni.setStorageSync(DB_KEY, raw)
  } catch (e) {
    // 存储写满或被拒时不要让业务流程崩溃
    console.error('[db] saveState failed', e)
  }
}

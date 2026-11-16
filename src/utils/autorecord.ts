import { guessCat } from './categorize'
import { startListening, jzLog } from './notify'

let bound = false

/** 已入库的原生记录 id（原生 pending 不再清空，靠 id 保证同一笔只记一次） */
const PROCESSED_KEY = 'jz_nl_processed_ids'
let processedIds: string[] = []
let processedLoaded = false

function loadProcessed() {
  if (processedLoaded) return
  processedLoaded = true
  try {
    const v = uni.getStorageSync(PROCESSED_KEY)
    if (Array.isArray(v)) processedIds = v.filter((x: any) => typeof x === 'string')
  } catch (e) {}
}

function saveProcessed() {
  try {
    // 只保留最近 300 个，避免无限增长
    uni.setStorageSync(PROCESSED_KEY, processedIds.slice(-300))
  } catch (e) {}
}

/**
 * 自动记账唯一入库入口（轮询触发）。
 * 去重：原生已按通知 key 去重，这里再用记录 id 保证同一笔只记一次。
 * 收支：按通知文案判断（收款/到账/收入 → income，其余按支出）。
 */
export function ingestPendingList(store: any, list: any[]): number {
  if (!list || !list.length) return 0
  loadProcessed()
  const seen = new Set(processedIds)
  let added = 0
  for (const r of list) {
    const amt = Math.round((Number(r.amount) || 0) * 100) / 100
    const id = typeof r.id === 'string' ? r.id : ''
    if (id && seen.has(id)) continue
    if (id) { seen.add(id); processedIds.push(id) }
    if (!(amt > 0)) continue
    const source = r.source === 'ali' ? 'ali' : 'wx'
    const ts = Number(r.ts) || Date.now()
    const note = r.note || '自动记账'
    const type: 'expense' | 'income' = /收款|到账|收入/.test(note) ? 'income' : 'expense'
    // 兜底去重：原生已按通知 key 去重，这里只挡 15 秒内同来源同金额的重复写入，
    // 窗口不能太大，否则连买两笔同价商品时第二笔会被误判成重复而漏账。
    const dup = store.s.records.some((x: any) =>
      x.source === source && Math.abs(x.amount - amt) < 0.005 && Math.abs(x.ts - ts) < 15000)
    if (dup) continue
    store.addRecord({
      amount: amt,
      source,
      note,
      catId: guessCat(note, store.s.cats).id,
      type,
      ts
    }, { silent: true })
    added++
  }
  if (processedIds.length > 300) processedIds = processedIds.slice(-300)
  saveProcessed()
  if (added > 0) jzLog(`ingest: added ${added}, total records ${store.s.records.length}`)
  return added
}

/**
 * 清空自动记账去重标记（配合「恢复初始状态」使用）
 * 原生暂存由 clearNativePending 一起清空，两者必须同时清，否则会漏记或重复记。
 */
export function clearProcessedIds() {
  processedLoaded = true
  processedIds = []
  try { uni.removeStorageSync(PROCESSED_KEY) } catch (e) {}
}

/**
 * 绑定自动记账：确保系统已绑定监听服务。
 * 入库统一由 App.vue 的 1.5 秒轮询触发（原生广播在当前运行时不可用）。
 */
export function bindAutoRecord(_store: any) {
  if (bound) return
  bound = true
  startListening()
}

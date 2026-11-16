import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { loadStateSync, saveState, clearState, ensureDb } from '../utils/db'
import { buildDefaultCats } from '../utils/seed'
import { syncNativeConfig, clearNativePending } from '../utils/notify'
import { clearProcessedIds } from '../utils/autorecord'
import { monthKey } from '../utils/money'
import { guessCat } from '../utils/categorize'
import type { ParsedBill } from '../utils/csv'
import {
  findMonthCross, findCatCross, shouldAlert, reachedLevel,
  monthSpent, monthIncome, spentOf, catSpendMap, monthRecords,
  recordsOfMonth, spentOfMonth, incomeOfMonth, catSpendOfMonth,
  DEFAULT_LEVELS,
  type Category, type Record, type ThresholdInfo, type ThrLevel
} from '../utils/threshold'

/** 一次导入的结果（也用于导入历史） */
export interface ImportStats {
  id: string
  name: string
  added: number
  skipped: number
  auto: number
  ts: number
}

interface State {
  schemaVersion: number
  onboarded: boolean
  /** 用户昵称 */
  name: string
  /** 头像本地路径，空字符串表示用默认图 */
  avatar: string
  budget: number | null
  cats: Category[]
  favCats: string[]
  records: Record[]
  thr: ThrLevel[]
  catBudgets: Record<string, number>
  reminder: 'each' | 'daily' | 'first'
  notifiedMonth: string
  notifiedMon: string
  notifiedDayKey: string
  notifiedDay: string
  permission: boolean
  importStats: null | ImportStats
  importHistory: ImportStats[]
  /** 明细/统计页正在查看的月份，YYYY-MM */
  viewMonth: string
  lastAlert: ThresholdInfo | null
}

/**
 * 持久化结构版本。老版本（无此字段）存过演示种子数据，升级时必须丢弃
 * records / importHistory / lastAlert，避免演示账单残留到真版本。
 */
const SCHEMA_VERSION = 2

function blank(): State {
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: false, budget: null,
    name: '楠楠', avatar: '',
    cats: buildDefaultCats(), favCats: [],
    records: [],
    thr: DEFAULT_LEVELS.map(l => ({ ...l })),
    catBudgets: {},
    reminder: 'daily',
    notifiedMonth: '', notifiedMon: '',
    notifiedDayKey: '', notifiedDay: '',
    permission: false, importStats: null, importHistory: [],
    viewMonth: monthKey(),
    lastAlert: null
  }
}

/** 旧版本 thr 是 { 70: true, 90: true, 100: false }，迁移成数组 */
function migrateThr(raw: any): ThrLevel[] | null {
  if (Array.isArray(raw)) {
    const arr = raw
      .map((x: any) => ({ pct: Number(x?.pct), on: !!x?.on }))
      .filter((x: ThrLevel) => x.pct >= 1 && x.pct <= 200)
    return arr.length ? arr.sort((a, b) => a.pct - b.pct) : null
  }
  if (raw && typeof raw === 'object') {
    const arr: ThrLevel[] = Object.keys(raw)
      .map(k => ({ pct: Number(k), on: !!raw[k] }))
      .filter(x => x.pct >= 1 && x.pct <= 200)
    return arr.length ? arr.sort((a, b) => a.pct - b.pct) : null
  }
  return null
}

/**
 * 持久化数据可能因旧版本或写入中断而残缺（records 不是数组、金额是字符串等），
 * 读入后必须做最小校验，否则首页 monthSpent 直接抛异常，App 一开就白屏且无法自救。
 */
function sanitize(s: State) {
  if (!Array.isArray(s.records)) {
    s.records = []
  } else {
    s.records = s.records
      .filter((r: any) => r && typeof r.id === 'string'
        && Number.isFinite(Number(r.amount)) && Number.isFinite(Number(r.ts)))
      .map((r: any) => ({
        ...r,
        amount: Number(r.amount),
        ts: Number(r.ts),
        type: r.type === 'income' ? 'income' : 'expense'
      }))
  }
  if (!Array.isArray(s.cats) || !s.cats.length) s.cats = buildDefaultCats()
  if (!Array.isArray(s.thr) || !s.thr.length) s.thr = DEFAULT_LEVELS.map(l => ({ ...l }))
  if (!Array.isArray(s.favCats)) s.favCats = []
  if (!Array.isArray(s.importHistory)) s.importHistory = []
  if (!s.catBudgets || typeof s.catBudgets !== 'object') s.catBudgets = {}
  if (typeof s.reminder !== 'string') s.reminder = 'daily'
  if (typeof s.name !== 'string' || !s.name.trim()) s.name = '楠楠'
  if (typeof s.avatar !== 'string') s.avatar = ''
}

export const useAppStore = defineStore('app', () => {
  const s = reactive<State>(blank())

  /**
   * 启动时从持久化层加载；老版本演示数据自动清空 records/importHistory/lastAlert。
   *
   * 注意：这里必须同步执行（在 store 创建时），不能只放在 App.onLaunch 的 async init 里。
   * App 端首屏页面可能在 init 的 await 完成前就挂载，此时 onboarded 仍是 false，
   * 页面会误判成「未完成引导」跳转引导页，用户点「跳过」就会把预算清空。
   */
  let hydrated = false
  let isLegacy = false

  function hydrate() {
    if (hydrated) return
    hydrated = true
    const raw = loadStateSync()
    if (!raw) return
    try {
      const obj = JSON.parse(raw) as Partial<State>
      const levels = migrateThr((obj as any).thr)
      Object.assign(s, blank(), obj, levels ? { thr: levels } : {})
      // 老版本（schemaVersion < 2）存过演示种子数据：必须丢弃账单、导入历史、告警抑制标记
      // 但保留预算 / 分类 / 档位 / 提醒频率这些用户配置
      const savedVersion = Number((obj as any).schemaVersion) || 0
      if (savedVersion < SCHEMA_VERSION) {
        isLegacy = true
        s.records = []
        s.importStats = null
        s.importHistory = []
        s.lastAlert = null
        s.notifiedMonth = ''; s.notifiedMon = ''
        s.notifiedDayKey = ''; s.notifiedDay = ''
        s.schemaVersion = SCHEMA_VERSION
      }
    } catch (e) {}
  }

  // 创建 store 时立即同步还原，保证任何页面挂载时数据已就绪
  hydrate()
  sanitize(s)
  // 每次启动回到当前月，避免上次浏览的历史月份让首页看起来没数据
  s.viewMonth = monthKey()

  /** 兼容原有调用：数据已在 store 创建时同步就绪，这里只补一次老版本迁移落盘 */
  async function init() {
    ensureDb()
    hydrate()
    if (isLegacy) {
      isLegacy = false
      saveState(JSON.stringify(s))
    }
  }

  /** 自动持久化 + 同步给原生侧（后台告警要用），合并高频写入 */
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(s, (v) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveState(JSON.stringify(v))
      syncNative()
    }, 120)
  }, { deep: true })

  /** 把预算/档位/提醒频率/本月支出同步到原生 SharedPreferences */
  function syncNative() {
    syncNativeConfig({
      budget: s.budget || 0,
      levels: s.thr.map(l => ({ pct: l.pct, on: l.on })),
      reminder: s.reminder,
      monthSpent: monthSpent(s.records),
      monthKey: monthKey()
    })
  }

  function catOf(id: string): Category {
    return s.cats.find(c => c.id === id) || { id, icon: '其', name: '其他' }
  }
  function orderedCats(): Category[] {
    const fav = new Set(s.favCats || [])
    return s.cats.slice().sort((a, b) => {
      const fa = fav.has(a.id) ? 0 : 1
      const fb = fav.has(b.id) ? 0 : 1
      return fa - fb
    })
  }

  function addRecord(
    partial: Omit<Record, 'id' | 'ts'> & { ts?: number },
    opts: { silent?: boolean } = {}
  ): ThresholdInfo | null {
    const beforeM = monthSpent(s.records)
    const beforeC = catSpendMap(s.records)
    const rec: Record = {
      ...partial,
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
      ts: partial.ts ?? Date.now()
    }
    s.records.push(rec)
    // 后台补录的账单不再重复告警
    if (opts.silent || rec.type === 'income') return null
    const afterM = monthSpent(s.records)
    const afterC = catSpendMap(s.records)
    // 先月度，再分类；都没跨线时，若当前支出已在某档之上，仍按频率提醒
    const enabledLv = s.thr.filter(x => x.on).map(x => x.pct)
    let info = findMonthCross(beforeM, afterM, s.budget || 0, enabledLv)
    if (!info) info = findCatCross(beforeC, afterC, s.catBudgets, s.cats)
    if (!info) info = reachedLevel(afterM, s.budget || 0, enabledLv)
    if (!info) return null
    const remState = {
      reminder: s.reminder,
      notifiedMonth: s.notifiedMonth, notifiedMon: s.notifiedMon,
      notifiedDayKey: s.notifiedDayKey, notifiedDay: s.notifiedDay
    }
    const real = shouldAlert(info, remState)
    s.notifiedMonth = remState.notifiedMonth
    s.notifiedMon = remState.notifiedMon
    s.notifiedDayKey = remState.notifiedDayKey
    s.notifiedDay = remState.notifiedDay
    if (real) {
      s.lastAlert = info
      return info
    }
    return null
  }

  /** 修改昵称（最多 12 字，空值忽略） */
  function setName(v: string) {
    const n = (v || '').trim().slice(0, 12)
    if (n) s.name = n
  }

  /** 修改头像，传空字符串恢复默认图 */
  function setAvatar(path: string) {
    s.avatar = path || ''
  }

  function finishOnboarding(budgetRaw: number | null, favIds: string[]) {
    s.onboarded = true
    s.budget = budgetRaw && budgetRaw > 0 ? Math.round(budgetRaw * 100) / 100 : null
    s.favCats = favIds.slice()
  }

  function skipOnboarding() {
    // 只标记已引导。不主动清预算/收藏，避免误入引导页点「跳过」抹掉已有配置
    s.onboarded = true
  }

  /** 编辑一笔账单（不触发告警，避免改金额反复弹窗） */
  function updateRecord(id: string, patch: Partial<Omit<Record, 'id'>>): boolean {
    const r = s.records.find(x => x.id === id)
    if (!r) return false
    Object.assign(r, patch)
    if (patch.amount != null) r.amount = Math.round(Math.abs(patch.amount) * 100) / 100
    return true
  }

  function deleteRecord(id: string): boolean {
    const before = s.records.length
    s.records = s.records.filter(r => r.id !== id)
    return s.records.length < before
  }

  /** 清空账单（保留预算、分类、告警配置） */
  function clearRecords() {
    s.records = []
    s.importStats = null
    s.importHistory = []
    s.lastAlert = null
    s.notifiedMonth = ''; s.notifiedMon = ''
    s.notifiedDayKey = ''; s.notifiedDay = ''
  }

  /** 内容键：用于和自动记账产生的账单去重（同来源 + 同分钟 + 同金额 + 同类型） */
  function contentKey(r: Record): string {
    return `${r.source}|${Math.floor(r.ts / 60000)}|${r.amount.toFixed(2)}|${r.type}`
  }
  function uniqueKeys(r: Record): string[] {
    const arr = [contentKey(r)]
    if (r.extId) arr.push('e:' + r.extId)
    return arr
  }

  /**
   * 批量导入解析后的账单
   * 去重：交易单号优先，其次 来源+时间(分钟)+金额+类型
   */
  function importBills(bills: ParsedBill[], name: string): { stats: ImportStats; alert: ThresholdInfo | null } {
    const beforeM = monthSpent(s.records)
    const beforeC = catSpendMap(s.records)
    const seen = new Set<string>()
    s.records.forEach(r => uniqueKeys(r).forEach(k => seen.add(k)))

    const now = new Date()
    let added = 0, skipped = 0, matched = 0
    bills.forEach((b, i) => {
      const g = guessCat(b.note, s.cats)
      const rec: Record = {
        id: 'i' + now.getTime().toString(36) + '-' + i,
        amount: b.amount,
        catId: g.id,
        source: b.source,
        note: b.note,
        ts: b.ts,
        type: b.type,
        extId: b.extId
      }
      const keys = uniqueKeys(rec)
      if (keys.some(k => seen.has(k))) { skipped++; return }
      keys.forEach(k => seen.add(k))
      s.records.push(rec)
      added++
      if (g.matched) matched++
    })

    const stats: ImportStats = {
      id: 'h' + Date.now().toString(36),
      name,
      added,
      skipped,
      auto: added ? Math.round(matched / added * 100) : 0,
      ts: Date.now()
    }
    s.importStats = stats
    s.importHistory = [stats, ...(s.importHistory || [])].slice(0, 10)

    let alert: ThresholdInfo | null = null
    if (added) {
      const afterM = monthSpent(s.records)
      const afterC = catSpendMap(s.records)
      const enabledLv = s.thr.filter(x => x.on).map(x => x.pct)
      alert = findMonthCross(beforeM, afterM, s.budget || 0, enabledLv)
      if (!alert) alert = findCatCross(beforeC, afterC, s.catBudgets, s.cats)
      if (alert) s.lastAlert = alert
    }
    return { stats, alert }
  }

  function addCategory(name: string): Category | null {
    const n = (name || '').trim()
    if (!n) return null
    if (s.cats.some(c => c.name === n)) return null
    const c: Category = { id: 'c' + Date.now(), icon: n.slice(0, 1), name: n }
    s.cats.push(c)
    return c
  }
  function deleteCategory(id: string): boolean {
    if (s.records.some(r => r.catId === id)) return false
    s.cats = s.cats.filter(c => c.id !== id)
    delete s.catBudgets[id]
    s.favCats = s.favCats.filter(x => x !== id)
    return true
  }

  function updateBudget(v: number) {
    s.budget = Math.round(v * 100) / 100
    // 预算变化重置告警抑制，避免永远卡在已提醒状态
    s.notifiedMonth = ''; s.notifiedMon = ''
    s.notifiedDayKey = ''; s.notifiedDay = ''
  }

  /** 更新告警档位：pct 递减校验（严格递增），范围 1–200 */
  function updateLevels(next: { pct: number; on: boolean }[]): boolean {
    const arr = next.map(x => ({ pct: Math.round(Number(x.pct)), on: !!x.on }))
    if (arr.length !== 3) return false
    if (arr.some(x => !isFinite(x.pct) || x.pct < 1 || x.pct > 200)) return false
    if (!(arr[0].pct < arr[1].pct && arr[1].pct < arr[2].pct)) return false
    s.thr = arr
    // 档位变化后旧抑制标记失效，重置避免整月不提醒
    s.notifiedMonth = ''; s.notifiedMon = ''
    s.notifiedDayKey = ''; s.notifiedDay = ''
    return true
  }

  function toggleLevel(pct: number) {
    const l = s.thr.find(x => x.pct === pct)
    if (l) l.on = !l.on
  }

  /** 提醒频率：each / daily / first（同步给原生侧） */
  function setReminder(v: 'each' | 'daily' | 'first') {
    s.reminder = v
    syncNative()
  }

  function dismissAlert() { s.lastAlert = null }

  function resetAll() {
    // 先取消重置前排队的写入，再移除旧快照。即使马上杀进程，重启也只能读到空白状态，
    // 不会从旧快照恢复出 onboarded=true 而跳过引导。
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    Object.assign(s, blank())
    // 恢复初始状态必须连原生暂存和去重标记一起清，否则残留通知会在下次轮询时被补录
    clearNativePending()
    clearProcessedIds()
    clearState()
  }

  // —— 查询 helpers（不依赖 store reactive 直接访问）——
  const api = {
    monthSpent: () => monthSpent(s.records),
    monthIncome: () => monthIncome(s.records),
    spentOf: (catId: string) => spentOf(s.records, catId),
    catSpendMap: () => catSpendMap(s.records),
    monthRecords: () => monthRecords(s.records),
    recordsOfMonth: (mk: string) => recordsOfMonth(s.records, mk),
    spentOfMonth: (mk: string) => spentOfMonth(s.records, mk),
    incomeOfMonth: (mk: string) => incomeOfMonth(s.records, mk),
    catSpendOfMonth: (mk: string) => catSpendOfMonth(s.records, mk),
    catOf, orderedCats
  }

  return {
    s, catOf, orderedCats,
    init, addRecord, updateRecord, deleteRecord, clearRecords, importBills,
    finishOnboarding, skipOnboarding,
    setName, setAvatar,
    addCategory, deleteCategory, updateBudget,
    updateLevels, toggleLevel, setReminder, syncNative,
    dismissAlert, resetAll, api
  }
})

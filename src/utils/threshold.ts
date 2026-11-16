import { monthKey, dayKey, monthStartOf, monthEndOf } from './money'

export type Source = 'wx' | 'ali' | 'manual'
export type TxType = 'expense' | 'income'

export interface Category {
  id: string
  icon: string
  name: string
}
export interface Record {
  id: string
  amount: number
  catId: string
  source: Source
  note: string
  ts: number
  type: TxType
  /** 外部交易单号 / 去重键（导入的账单才有） */
  extId?: string
}

export interface ThresholdInfo {
  scope: 'month' | 'cat'
  level: number // 触发的百分比档位（可在阈值页自定义，1–200）
  spent: number
  limit: number
  catId?: string
  catName?: string
}

/** 告警档位：pct 百分比，on 是否启用 */
export interface ThrLevel {
  pct: number
  on: boolean
}

export const DEFAULT_LEVELS: ThrLevel[] = [
  { pct: 70, on: true },
  { pct: 90, on: true },
  { pct: 100, on: false }
]

/** 找出本次新增一笔前/后跨越了哪个月度阈值档位（最高优先） */
export function findMonthCross(before: number, after: number, limit: number, enabledLevels: number[]): ThresholdInfo | null {
  if (!limit) return null
  const lv = enabledLevels.slice().sort((a, b) => b - a) // 从高到低检查
  for (const l of lv) {
    if (before / limit * 100 < l && after / limit * 100 >= l) {
      return { scope: 'month', level: l, spent: after, limit }
    }
  }
  return null
}
/**
 * 当前支出已达到的最高档位（没有任何档位被达到时返回 null）。
 * 用于「每次 / 每天 / 每月」的重复提醒：只在跨线那一笔提醒一次，
 * 会让频率设置形同虚设。
 */
export function reachedLevel(spent: number, limit: number, enabledLevels: number[]): ThresholdInfo | null {
  if (!limit) return null
  const pct = spent / limit * 100
  const hit = enabledLevels.filter(l => pct >= l).sort((a, b) => b - a)[0]
  return hit == null ? null : { scope: 'month', level: hit, spent, limit }
}

/** 分类阈值单独判断（当前仅支持 100% 线） */
export function findCatCross(
  before: Record<string, number>,
  after: Record<string, number>,
  catBudgets: Record<string, number>,
  cats?: Category[]
): ThresholdInfo | null {
  for (const id of Object.keys(catBudgets)) {
    const lim = catBudgets[id]
    if (!lim) continue
    const b = before[id] || 0, a = after[id] || 0
    if (b < lim && a >= lim) {
      const cat = cats?.find(c => c.id === id)
      return { scope: 'cat', level: 100, spent: a, limit: lim, catId: id, catName: cat?.name }
    }
  }
  return null
}

export interface ReminderState {
  reminder: 'each' | 'daily' | 'first'
  /** 每月已提醒过的档位，用 | 分隔 */
  notifiedMonth: string
  notifiedMon: string
  /** 当天已提醒过的档位，用 | 分隔 */
  notifiedDayKey: string
  notifiedDay: string
}

/**
 * 判断本次告警是否该真实弹出
 * 返回 true = 弹出；false = 已被频率抑制
 */
export function shouldAlert(info: ThresholdInfo, rem: ReminderState): boolean {
  if (rem.reminder === 'each') return true
  const mk = monthKey(), dk = dayKey()
  const key = info.scope === 'cat' ? 'cat:' + info.catId : 'lv:' + info.level
  if (rem.reminder === 'first') {
    if (rem.notifiedMon !== mk) { rem.notifiedMon = mk; rem.notifiedMonth = '' }
    const arr = rem.notifiedMonth ? rem.notifiedMonth.split('|') : []
    if (arr.indexOf(key) >= 0) return false
    rem.notifiedMonth = arr.concat(key).join('|')
    return true
  }
  // daily
  if (rem.notifiedDayKey !== dk) { rem.notifiedDayKey = dk; rem.notifiedDay = '' }
  const arr2 = rem.notifiedDay ? rem.notifiedDay.split('|') : []
  if (arr2.indexOf(key + '@' + dk) >= 0) return false
  rem.notifiedDay = arr2.concat(key + '@' + dk).join('|')
  return true
}

export function recordsOfMonth(records: Record[], mk: string): Record[] {
  const s = monthStartOf(mk), e = monthEndOf(mk)
  return records.filter(r => r.ts >= s && r.ts < e)
}
export function spentOfMonth(records: Record[], mk: string): number {
  return recordsOfMonth(records, mk).filter(r => r.type !== 'income').reduce((a, r) => a + r.amount, 0)
}
export function incomeOfMonth(records: Record[], mk: string): number {
  return recordsOfMonth(records, mk).filter(r => r.type === 'income').reduce((a, r) => a + r.amount, 0)
}
export function catSpendOfMonth(records: Record[], mk: string): Record<string, number> {
  const m: Record<string, number> = {}
  recordsOfMonth(records, mk).forEach(r => { if (r.type !== 'income') m[r.catId] = (m[r.catId] || 0) + r.amount })
  return m
}
export function monthRecords(records: Record[]): Record[] {
  return recordsOfMonth(records, monthKey())
}
export function catSpendMap(records: Record[]): Record<string, number> {
  const m: Record<string, number> = {}
  monthRecords(records).forEach(r => { if (r.type !== 'income') m[r.catId] = (m[r.catId] || 0) + r.amount })
  return m
}
export function monthSpent(records: Record[]): number {
  return monthRecords(records).filter(r => r.type !== 'income').reduce((a, r) => a + r.amount, 0)
}
export function monthIncome(records: Record[]): number {
  return monthRecords(records).filter(r => r.type === 'income').reduce((a, r) => a + r.amount, 0)
}
export function spentOf(records: Record[], catId: string): number {
  return monthRecords(records).filter(r => r.type !== 'income' && (!catId || r.catId === catId)).reduce((a, r) => a + r.amount, 0)
}

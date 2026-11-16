/** 金额格式化：¥ + 两位小数 + 千分位
 *  不依赖 Intl/toLocaleString —— 部分 Android WebView 会忽略 options，
 *  直接把 daily 这类除不尽的数（如 166.66666666666666）原样输出 */
export function num(n: number): string {
  const v = isFinite(n) ? n : 0
  // 先四舍五入到分，再固定两位；加 EPSILON 规避 1.005 这类二进制浮点误差
  const abs = Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100
  const s = abs.toFixed(2)
  const dot = s.indexOf('.')
  const int = s.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (v < 0 ? '-' : '') + int + s.slice(dot)
}
export function money(n: number): string { return '¥' + num(n) }
/** KPI 大字，整数与小数字体分开 */
export function kpiHtml(n: number): string {
  const s = num(n).split('.')
  return '¥' + s[0] + '<small>.' + s[1] + '</small>'
}
/** 当前月份起始时间戳 */
export function monthStart(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
export function monthKey(d = new Date()): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
/** 'YYYY-MM' → 该月 1 日 00:00 */
export function monthStartOf(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).getTime()
}
/** 'YYYY-MM' → 次月 1 日 00:00（不含） */
export function monthEndOf(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, (m || 1), 1).getTime()
}
/** 'YYYY-MM' → '2026年11月' */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}年${m}月`
}
/** 按月偏移，返回 'YYYY-MM' */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1 + delta, 1)
  return monthKey(d)
}
export function dayKey(d = new Date()): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export function daysInMonth(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
export function dayLabel(ts: number): string {
  const d = new Date(ts), t = dayKey()
  if (dayKey(d) === t) return '今天'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (dayKey(d) === dayKey(y)) return '昨天'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}
export function timeLabel(ts: number): string {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
export function srcName(s: string): string {
  if (s === 'wx') return '微信'
  if (s === 'ali') return '支付宝'
  return '手动'
}
export function pad(n: number): string { return n < 10 ? '0' + n : '' + n }

import type { Record as Bill, Source } from './threshold'
import { srcName } from './money'
import { decodeGbk } from './gbk'
import * as XLSX from 'xlsx'

/** 解析后的一条待入库账单 */
export interface ParsedBill {
  ts: number
  amount: number
  type: 'expense' | 'income'
  source: Source
  note: string
  extId?: string
}

export interface ParseResult {
  bills: ParsedBill[]
  skipped: number
  format: 'wx' | 'ali' | 'unknown'
  /** 解析诊断信息：表头未命中时用于定位真实文件格式 */
  diag?: string
}

/** 简单字符串哈希（无 crypto 环境可用），用于无交易单号时生成去重键 */
export function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'h' + h.toString(36)
}

/** 按 RFC4180 拆分 CSV（支持引号内逗号与换行） */
function splitCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const TIME_RE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日]?(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/

/** 解析常见的账单时间格式：2026-11-01 14:16、2026/11/1 14:16:00、2026年11月1日 14:16 */
export function parseBillTime(raw: string): number | null {
  const m = (raw || '').match(TIME_RE)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  const t = d.getTime()
  return isFinite(t) ? t : null
}

function toAmount(raw: string): number {
  const n = parseFloat((raw || '').replace(/[¥￥,，\s元]/g, ''))
  return isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0
}

function findCol(head: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = head.findIndex(h => p.test(h.replace(/\s/g, '')))
    if (i >= 0) return i
  }
  return -1
}

const SKIP_STATUS = /退款|关闭|失败|撤销|退回|等待付款|未付款|已全额|银行处理中/

/**
 * 解析微信 / 支付宝导出的账单 CSV
 * 兼容文件头部的说明行（微信账单前面有若干行汇总信息）
 */
export function parseBillCsv(text: string, fileName = ''): ParseResult {
  const clean = (text || '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
  const res = parseBillRows(splitCsv(clean))
  if (res.bills.length) return res
  const head = clean.slice(0, 220).replace(/\n/g, ' ⏎ ')
  return {
    ...res,
    diag: `文件 ${fileName || '未命名'}｜${clean.length} 字符｜文本前几行：${head}`
  }
}

/**
 * 纯 JS UTF-8 解码（App 运行时没有 TextDecoder，它只是浏览器 WebView API）。
 * 返回 null 表示数据中存在非法 UTF-8 序列（调用方据此回退 GBK）。
 */
function tryDecodeUtf8(bytes: Uint8Array): string | null {
  let out = ''
  let i = 0
  const len = bytes.length
  while (i < len) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue }
    let need = 0
    let cp = 0
    if (b >= 0xC2 && b <= 0xDF) { need = 1; cp = b & 0x1F }
    else if (b >= 0xE0 && b <= 0xEF) { need = 2; cp = b & 0x0F }
    else if (b >= 0xF0 && b <= 0xF4) { need = 3; cp = b & 0x07 }
    else return null
    if (i + need >= len) return null
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if ((c & 0xC0) !== 0x80) return null
      cp = (cp << 6) | (c & 0x3F)
    }
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return null
    if (need === 2 && cp < 0x800) return null
    if (need === 3 && cp < 0x10000) return null
    if (cp >= 0x10000) {
      const v = cp - 0x10000
      out += String.fromCharCode(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF))
    } else {
      out += String.fromCharCode(cp)
    }
    i += need + 1
  }
  return out
}

/** 解码文本：优先 UTF-8，非法序列则按 GBK（支付宝 CSV 常用）解码。全程纯 JS，不依赖 TextDecoder */
export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (!bytes.length) return ''
  // 去掉 UTF-8 BOM 再判断
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    const t = tryDecodeUtf8(bytes.subarray(3))
    if (t != null) return t.replace(/^\ufeff/, '')
  }
  const utf8 = tryDecodeUtf8(bytes)
  if (utf8 != null) return utf8.replace(/^\ufeff/, '')
  return decodeGbk(bytes).replace(/^\ufeff/, '')
}

/** 单元格值转字符串：日期对象按本地时间格式化成「2026-11-01 14:16:22」，避免 String(Date) 变成英文串 */
function cellToStr(c: any): string {
  if (c == null) return ''
  if (c instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())} ${p(c.getHours())}:${p(c.getMinutes())}:${p(c.getSeconds())}`
  }
  return String(c)
}

/**
 * 解析 XLSX / XLS 账单（微信新版导出为 xlsx）
 * 遍历工作表，取第一张能识别到「交易时间 + 金额」表头的表
 */
export function parseBillXlsx(buffer: ArrayBuffer, fileName = ''): ParseResult {
  // 先做文件头快速预判，避免把明显不是 Excel 的东西喂给 XLSX.read 导致抛异常
  const headBytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  const headSig = Array.from(headBytes).map(x => x.toString(16).padStart(2, '0')).join('')
  const isZip = headBytes[0] === 0x50 && headBytes[1] === 0x4b && headBytes[2] === 0x03 && headBytes[3] === 0x04
  const isOle = headBytes[0] === 0xd0 && headBytes[1] === 0xcf && headBytes[2] === 0x11 && headBytes[3] === 0xe0

  const base = `文件 ${fileName || '未命名'}｜${buffer.byteLength} 字节｜文件头:${headSig}`
  if (!isZip && !isOle) {
    return { bills: [], skipped: 0, format: 'unknown', diag: `${base}｜文件头不是 ZIP(504b0304) 也不是 OLE(docf11e0)，可能不是 Excel 文件` }
  }

  let wb: any
  try {
    wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true, cellFormula: true, cellHTML: true })
  } catch (e: any) {
    return { bills: [], skipped: 0, format: 'unknown', diag: `${base}｜XLSX 解包失败: ${e?.message || String(e)}` }
  }
  const sheets = wb.SheetNames || []
  const fullBase = `${base}｜Excel 工作表 ${sheets.length} 个：${sheets.join(' / ')}`

  let preview = ''
  for (const name of sheets) {
    const ws = wb.Sheets[name]
    if (!ws) continue

    // 先看原始 cell 数量和类型（不做任何转换）
    const cellKeys = Object.keys(ws).filter(k => !k.startsWith('!'))
    preview += `｜${name} 原始cell数:${cellKeys.length}`
    if (cellKeys.length > 0) {
      const sampleCells = cellKeys.slice(0, 8).map(k => {
        const c = ws[k]
        return `${k}=${JSON.stringify(c)}`
      }).join(',')
      preview += `｜样例:${sampleCells}`
    }

    // 用 raw:true 拿原始值（cellDates:true 时日期是 Date 对象），由 cellToStr 统一格式化，
    // 不依赖单元格的显示格式；再用 raw:false 的格式化字符串作为第二策略兜底
    const rawRaw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: '' }) as any[][]
    const rawFmt = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' }) as any[][]

    const toRows = (m: any[][]) => m.map(r => (r || []).map(c => cellToStr(c)))
    let res = parseBillRows(toRows(rawRaw))
    if (!res.bills.length) res = parseBillRows(toRows(rawFmt))
    if (res.bills.length) return { ...res, diag: `${fullBase}｜命中工作表「${name}」` }

    // 诊断：两种模式的前 10 行都打出来，不做 filter
    const rawPreview = rawRaw.slice(0, 10).map((r, i) => `R${i}(${r.length}):${JSON.stringify(r)}`).join(' ⏎ ')
    const fmtPreview = rawFmt.slice(0, 10).map((r, i) => `F${i}:${JSON.stringify(r)}`).join(' ⏎ ')
    preview += `｜raw模式前10行:${rawPreview.slice(0, 600)}｜fmt模式前10行:${fmtPreview.slice(0, 600)}`
  }
  return { bills: [], skipped: 0, format: 'unknown', diag: `${fullBase}｜${preview}` }
}

/** 按文件后缀 / 文件头判断解析方式（xlsx 是 zip：PK\x03\x04；xls 是 OLE：D0 CF 11 E0） */
export function parseBillFile(name: string, buffer: ArrayBuffer): ParseResult {
  if (/\.(xlsx|xls)$/i.test(name || '') || isExcelBuffer(buffer)) return parseBillXlsx(buffer, name)
  return parseBillCsv(decodeText(buffer), name)
}

function isExcelBuffer(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  return (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) ||
    (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)
}

/** 核心解析：输入二维表（CSV 或 Excel 转成的字符串矩阵） */
export function parseBillRows(rows: string[][]): ParseResult {

  // 找到表头行：优先「时间类 + 金额类」同时出现；再用工单关键词命中数兜底
  let headIdx = rows.findIndex(r => {
    const line = r.join(',')
    return /交易时间|付款时间|交易创建时间|创建时间/.test(line) && /金额|收\/支|收支|发生额/.test(line)
  })
  if (headIdx < 0) {
    const KEY = /交易时间|付款时间|金额|收\/支|收支|交易对方|商品|商品说明|支付方式|当前状态|交易状态|交易单号|商户单号|备注/
    headIdx = rows.findIndex(r => r.filter(c => KEY.test((c || '').trim())).length >= 3)
  }
  const head = headIdx >= 0 ? rows[headIdx].map(x => x.trim()) : []

  const preface = (headIdx >= 0 ? rows.slice(0, headIdx) : rows.slice(0, 3)).map(r => r.join(' ')).join(' ')

  const cTime = findCol(head, [/交易时间/, /付款时间/, /交易创建时间/, /创建时间/, /时间/])
  const cType = findCol(head, [/收\/支/, /收支类型/, /收支/, /收\\?支/, /资金方向/])
  const cAmount = findCol(head, [/金额/, /发生额/, /交易额/])
  const cMerchant = findCol(head, [/交易对方/, /对方/, /商户/])
  const cGoods = findCol(head, [/商品说明/, /商品名称/, /商品/, /类型/])
  const cStatus = findCol(head, [/当前状态/, /交易状态/, /状态/])
  const cOrder = findCol(head, [/交易单号/, /交易订单号/, /交易号/, /商户单号/, /订单号/])
  const cPay = findCol(head, [/支付方式/, /收付款方式/, /收\/付款方式/])

  const format: ParseResult['format'] =
    /微信/.test(preface) ? 'wx' :
    /支付宝/.test(preface) ? 'ali' :
    /零钱|微信/.test(head.join(',')) ? 'wx' :
    /余额宝|花呗|支付宝/.test(head.join(',')) ? 'ali' : 'unknown'

  let source: Source = format === 'wx' ? 'wx' : format === 'ali' ? 'ali' : 'manual'

  const bills: ParsedBill[] = []
  let skipped = 0

  if (headIdx >= 0 && cAmount >= 0) {
    for (let i = headIdx + 1; i < rows.length; i++) {
      const cells = rows[i]
      if (!cells.length || cells.join('').trim() === '') continue

      const timeRaw = cTime >= 0 ? cells[cTime] || '' : ''
      const ts = parseBillTime(timeRaw)
      const amount = cAmount >= 0 ? toAmount(cells[cAmount] || '') : 0
      if (!ts || amount <= 0) { skipped++; continue }

      const statusRaw = cStatus >= 0 ? cells[cStatus] || '' : ''
      if (SKIP_STATUS.test(statusRaw)) { skipped++; continue }

      const typeRaw = cType >= 0 ? (cells[cType] || '').trim() : ''
      let type: 'expense' | 'income'
      if (/不计|其他/.test(typeRaw)) { skipped++; continue }
      if (/收入|收$|^收/.test(typeRaw)) type = 'income'
      else if (/支出|支$|^支/.test(typeRaw)) type = 'expense'
      else if (!typeRaw) {
        // 无收/支列时按金额列的正负判断（部分银行账单）
        type = (cells[cAmount] || '').includes('-') ? 'income' : 'expense'
      } else { skipped++; continue }

      // 支付宝部分导出文件的来源在「收/付款方式」列
      if (source === 'manual' && cPay >= 0) {
        const pay = cells[cPay] || ''
        if (/零钱|微信/.test(pay)) source = 'wx'
        else if (/余额宝|花呗|支付宝|余额/.test(pay)) source = 'ali'
      }

      const merchant = cMerchant >= 0 ? (cells[cMerchant] || '').trim() : ''
      const goods = cGoods >= 0 ? (cells[cGoods] || '').trim() : ''
      const note = [merchant, goods && goods !== merchant ? goods : ''].filter(Boolean).join(' ') || (type === 'income' ? '收入' : '支出')
      const order = cOrder >= 0 ? (cells[cOrder] || '').trim() : ''

      bills.push({
        ts, amount, type,
        source: source === 'wx' ? 'wx' : source === 'ali' ? 'ali' : 'manual',
        note,
        extId: order ? `${source}:${order}` : `${source}:${hashKey(`${ts}|${amount}|${merchant}|${type}`)}`
      })
    }
  }

  if (headIdx < 0 || cAmount < 0) {
    const sample = rows.slice(0, 6).map(r => r.filter(Boolean).join(' | ')).filter(Boolean).join(' ⏎ ')
    return {
      bills, skipped, format,
      diag: `未识别表头（表头行=${headIdx}，金额列=${cAmount}，共 ${rows.length} 行）｜前几行：${sample.slice(0, 200)}`
    }
  }

  return { bills, skipped, format }
}

/** 生成可回导/可备份的 CSV（带 BOM，Excel 直接打开不乱码） */
export function buildExportCsv(records: Bill[], catName: (id: string) => string): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const fmt = (ts: number) => {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const head = ['交易时间', '类型', '金额', '分类', '来源', '备注'].join(',')
  const lines = records
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map(r => [
      fmt(r.ts),
      r.type === 'income' ? '收入' : '支出',
      r.amount.toFixed(2),
      catName(r.catId),
      srcName(r.source),
      r.note || ''
    ].map(esc).join(','))
  return '\ufeff' + [head, ...lines].join('\r\n')
}

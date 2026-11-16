/**
 * 文件读写适配：
 * - H5：隐藏 input 选文件 + Blob 下载（读取原始字节，CSV/XLSX 都能处理）
 * - App（Android）：Native.js 打开系统文件选择器，拿到 content URI 后交给原生插件读成 base64
 * 若 App 端文件选择失败，页面会提供「粘贴 CSV 内容」作为兜底
 */

export interface PickedFile {
  name: string
  buffer: ArrayBuffer
  /** 读取通道与字节数，用于导入失败时的诊断 */
  channel?: string
}

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined'

function pickH5(): Promise<PickedFile | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (v: PickedFile | null) => { if (!settled) { settled = true; resolve(v) } }

    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    inp.style.position = 'fixed'
    inp.style.left = '-9999px'
    document.body.appendChild(inp)

    inp.onchange = () => {
      const f = inp.files && inp.files[0]
      if (!f) { finish(null); document.body.removeChild(inp); return }
      const reader = new FileReader()
      reader.onload = () => {
        finish({ name: f.name || '账单', buffer: reader.result as ArrayBuffer })
        document.body.removeChild(inp)
      }
      reader.onerror = () => { finish(null); document.body.removeChild(inp) }
      reader.readAsArrayBuffer(f)
    }
    // 用户取消时浏览器不会触发 change，窗口重新获得焦点后兜底结束
    window.addEventListener('focus', () => setTimeout(() => finish(null), 900), { once: true })
    inp.click()
  })
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const atobFn = (globalThis as any).atob
  const bin = atobFn(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** 纯 Native.js 读取 content URI，直接返回原始字节。
 *  关键点：ContentResolver / InputStream 的实例方法不会自动暴露在代理对象上，
 *  必须用 plus.android.invoke() 反射调用；
 *  编码传递：InputStream 读入 ByteArrayOutputStream 后，用 android.util.Base64
 *  编码成纯 ASCII 的 base64 字符串跨层传递——这样完全避开 ISO-8859-1 这类
 *  非 ASCII 编码跨 JNI 时被 UTF-8 二次编码导致的字节损坏。 */
function readContentUriToBuffer(main: any, uri: any): ArrayBuffer {
  const A = (globalThis as any).plus.android

  const resolver = A.invoke(main, 'getContentResolver')
  if (!resolver) throw new Error('getContentResolver 返回 null')

  // 先拿系统声明的大小，便于出错时判断是 0 字节还是内容不对
  let size = -1
  try {
    const pfd = A.invoke(resolver, 'openFileDescriptor', uri, 'r')
    if (pfd) {
      size = Number(A.invoke(pfd, 'getStatSize'))
      A.invoke(pfd, 'close')
    }
  } catch (e) { /* ignore */ }

  const inputStream = A.invoke(resolver, 'openInputStream', uri)
  if (!inputStream) throw new Error('openInputStream 返回 null' + (size >= 0 ? `（声明大小 ${size} 字节）` : ''))

  try {
    // 关键修复：不能用 byte[] 数组代理作为输出参数。
    // Native.js 里 Array.newInstance 创建的 byte[] 代理，传给 InputStream.read(byte[])
    // 后 Java 侧读进了数据，但数据不会同步回 JS 侧代理数组，导致 bos 里全是 0
    // （现象：读到大小正确、headHex 全 0）。
    // 这里改用无参 read()，一次返回一个字节的 int（0-255，EOF 为 -1），完全不涉及数组传递。
    const bytes: number[] = []
    let b = Number(A.invoke(inputStream, 'read'))
    while (b >= 0) {
      bytes.push(b & 0xFF)
      b = Number(A.invoke(inputStream, 'read'))
    }
    if (!bytes.length) throw new Error(`读取到 0 字节${size >= 0 ? `（系统声明 ${size} 字节）` : ''}`)
    const u8 = new Uint8Array(bytes)
    return u8.buffer
  } finally {
    try { A.invoke(inputStream, 'close') } catch (e) { /* ignore */ }
  }
}

/** 从 content uri 解析文件名；实例方法统一走 invoke，避免代理不暴露方法 */
function resolveName(A: any, main: any, uri: any, uriStr: string): string {
  let name = ''
  try {
    const last = String(A.invoke(uri, 'getLastPathSegment') || '')
    if (last) {
      const parts = last.split(':')
      name = parts[parts.length - 1]
    }
  } catch (e) { /* ignore */ }

  if (!/\.(csv|xlsx|xls)$/i.test(name)) {
    try {
      const proj = A.newArray('java.lang.String', ['_display_name', '_size'])
      const resolver = A.invoke(main, 'getContentResolver')
      const cursor = A.invoke(resolver, 'query', uri, proj, null, null, null)
      if (cursor) {
        if (Number(A.invoke(cursor, 'moveToFirst'))) {
          const idx = Number(A.invoke(cursor, 'getColumnIndex', '_display_name'))
          if (idx >= 0) {
            const dn = String(A.invoke(cursor, 'getString', idx) || '')
            if (dn) name = dn
          }
        }
        A.invoke(cursor, 'close')
      }
    } catch (e) { /* ignore */ }
  }

  if (!name) {
    const tail = uriStr.split('/').pop() || ''
    const decoded = decodeURIComponent(tail)
    name = decoded || '账单'
  }
  return name
}

function pickApp(): Promise<PickedFile | null> {
  const P = (globalThis as any).plus
  if (!P || !P.android) return Promise.resolve(null)
  const A = P.android
  return new Promise(resolve => {
    let settled = false
    const finish = (v: PickedFile | null) => { if (!settled) { settled = true; resolve(v) } }

    const timer = setTimeout(() => finish(null), 30000)

    try {
      const main = A.runtimeMainActivity()
      const Intent = A.importClass('android.content.Intent')
      const intent = new Intent(Intent.ACTION_GET_CONTENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.setType('*/*')
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      const PICK_CODE = 9211

      const onResult = (requestCode: number, resultCode: number, data: any) => {
        if (requestCode !== PICK_CODE) return
        clearTimeout(timer)
        try {
          if (!data) { finish(null); return }
          const Activity = A.importClass('android.app.Activity')
          if (resultCode !== Activity.RESULT_OK) { finish(null); return }

          const uri = A.invoke(data, 'getData')
          if (!uri) { finish(null); return }
          const uriStr = String(A.invoke(uri, 'toString') || '')
          const name = resolveName(A, main, uri, uriStr)

          const errors: string[] = []

          // 兜底 2：纯 Native.js 读取（无参 read() 逐字节，绕开 byte[] 代理不同步的 bug）
          const tryNative = () => {
            try {
              const buffer = readContentUriToBuffer(main, uri)
              const hh = headHex(buffer)
              // 关键：把 errors（插件为何没生效）也带上，否则成功路径会吞掉插件失败原因
              const errTxt = errors.length ? ` | ${errors.join(' | ')}` : ''
              finish({ name, buffer, channel: `Native.js ${buffer.byteLength}字节 headHex:${hh}${errTxt}` })
            } catch (e: any) {
              errors.push('Native.js: ' + String(e?.message || e))
              uni.showModal({
                title: '读取文件失败',
                content: `${name}\n${uriStr}\n\n` + errors.join('\n'),
                showCancel: false, confirmText: '知道了'
              })
              finish(null)
            }
          }

          // 首选：原生插件（Java 直读 ContentResolver + Base64 编码）
          const plugin = (globalThis as any).uni.requireNativePlugin('NotificationListener')
          if (plugin && typeof plugin.readUriAsBase64 === 'function') {
            plugin.readUriAsBase64(uriStr, (res: any) => {
              if (res && res.ok && res.base64) {
                const buffer = base64ToBuffer(String(res.base64))
                if (buffer.byteLength > 0) {
                  const hh = headHex(buffer)
                  finish({ name, buffer, channel: `插件 ${buffer.byteLength}字节(声明${res.size}) headHex:${hh}` })
                  return
                }
                errors.push(`插件: 解码后 ${buffer.byteLength} 字节（声明 ${res.size}），base64前缀=${String(res.base64).slice(0,20)}`)
              } else {
                errors.push('插件: ' + String(res?.msg || '未返回内容') + ` | uri=${uriStr.slice(0,80)}`)
              }
              tryNative()
            })
            return
          }

          errors.push('插件: 未加载（plugin=' + !!plugin + ', readUriAsBase64=' + (plugin && typeof plugin.readUriAsBase64) + ')')
          tryNative()
        } catch (e: any) {
          uni.showModal({
            title: '读取失败',
            content: String(e?.message || e || '未知错误') + '\n\n可改用「粘贴 CSV 内容」，或先把账单复制到「内部存储/Download」再选。',
            showCancel: false, confirmText: '知道了'
          })
          finish(null)
        }
      }

      main.onActivityResult = onResult
      main.startActivityForResult(intent, PICK_CODE)
    } catch (e: any) {
      clearTimeout(timer)
      uni.showModal({
        title: '无法打开文件选择器',
        content: String(e?.message || e || '未知错误') + '。请改用「粘贴 CSV 内容」导入。',
        showCancel: false, confirmText: '知道了'
      })
      finish(null)
    }
  })
}

/** 把 buffer 前 n 字节转成 hex 字符串，用于诊断（判断是不是有效 xlsx zip 头 PK\x03\x04 等） */
function headHex(buf: ArrayBuffer, n = 16): string {
  const u8 = new Uint8Array(buf, 0, Math.min(n, buf.byteLength))
  return Array.from(u8).map(x => x.toString(16).padStart(2, '0')).join('')
}

/** 选择并读取一个账单文件（CSV / XLSX） */
export function pickCsvFile(): Promise<PickedFile | null> {
  if (hasDom && !(globalThis as any).plus) return pickH5()
  return pickApp()
}

function saveH5(name: string, content: string): Promise<string> {
  try {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 1200)
    return Promise.resolve('已下载到浏览器下载目录')
  } catch (e) {
    return Promise.resolve('')
  }
}

/** 纯 JS：字符串 → UTF-8 字节（App 运行时没有 TextEncoder） */
function utf8Bytes(str: string): number[] {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return out
}

/** 纯 JS：UTF-8 字符串 → base64（App 运行时没有 btoa / Buffer） */
function toBase64(str: string): string {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const b = utf8Bytes(str)
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const b0 = b[i]
    const b1 = i + 1 < b.length ? b[i + 1] : -1
    const b2 = i + 2 < b.length ? b[i + 2] : -1
    out += T[b0 >> 2]
    out += T[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
    out += b1 < 0 ? '=' : T[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
    out += b2 < 0 ? '=' : T[b2 & 63]
  }
  return out
}

/** 通过原生插件保存到系统「下载」目录（base64 跨层，避免中文被 JNI 重编码损坏） */
function saveToDownloadsNative(name: string, content: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const succeed = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve('已保存到 Download 文件夹')
    }
    const fail = (msg: string) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      reject(new Error(msg))
    }
    try {
      const plugin = (globalThis as any).uni.requireNativePlugin('NotificationListener')
      if (!plugin || typeof plugin.saveToDownloads !== 'function') {
        fail('当前安装包没有 Download 导出方法，请确认安装的是最新云打包版本')
        return
      }
      timer = setTimeout(() => fail('原生保存超时，请重试'), 8000)
      plugin.saveToDownloads(toBase64(content), name, (res: any) => {
        if (res && res.ok && res.path) succeed()
        else fail(String(res?.msg || '系统未确认文件已写入 Download'))
      })
    } catch (e: any) {
      fail(String(e?.message || e || '原生导出调用失败'))
    }
  })
}

/** App 兜底：Download 不可写时，写入应用私有文档目录（_doc/export） */
function saveToPrivateNative(name: string, content: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const P = (globalThis as any).plus
    if (!P || !P.io) {
      reject(new Error('当前运行环境不支持文件写入'))
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const succeed = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve('已保存到应用内 export 文件夹')
    }
    const fail = (msg: string) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      reject(new Error(msg))
    }
    const reason = (e: any, fallback: string) => {
      const msg = e && (e.message || e.msg)
      return String(msg || fallback)
    }

    timer = setTimeout(() => fail('写入应用内目录超时'), 8000)

    // 兜底文件加时间后缀，避免同名覆盖后旧内容残留
    const t = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`
    const dot = name.lastIndexOf('.')
    const fallbackName = dot > 0
      ? `${name.slice(0, dot)}-${stamp}${name.slice(dot)}`
      : `${name}-${stamp}`

    try {
      P.io.requestFileSystem(P.io.PRIVATE_DOC, (fs: any) => {
        fs.root.getDirectory('export', { create: true, exclusive: false }, (dir: any) => {
          dir.getFile(fallbackName, { create: true, exclusive: false }, (entry: any) => {
            entry.createWriter((writer: any) => {
              writer.onwrite = () => succeed()
              writer.onerror = () => fail('写入文件失败')
              writer.write(content)
            }, (e: any) => fail('打开文件失败：' + reason(e, '未知错误')))
          }, (e: any) => fail('创建文件失败：' + reason(e, '未知错误')))
        }, (e: any) => fail('创建导出目录失败：' + reason(e, '未知错误')))
      }, (e: any) => fail('打开应用内目录失败：' + reason(e, '未知错误')))
    } catch (e: any) {
      fail(String(e?.message || e || '应用内保存调用失败'))
    }
  })
}

/** App 优先保存到系统「下载」目录；不可写时兜底写入应用私有目录，只返回实际保存位置 */
export async function saveCsvFile(name: string, content: string): Promise<string> {
  if (hasDom && !(globalThis as any).plus) return saveH5(name, content)
  try {
    return await saveToDownloadsNative(name, content)
  } catch (e: any) {
    const first = String(e?.message || e || '未知错误')
    try {
      return await saveToPrivateNative(name, content)
    } catch (e2: any) {
      throw new Error(`系统 Download 不可写：${first}；应用内目录也失败：${String(e2?.message || e2 || '未知错误')}`)
    }
  }
}

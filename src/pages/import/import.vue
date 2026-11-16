<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '../../store/app'
import { pickCsvFile } from '../../utils/file'
import { parseBillFile, parseBillCsv, type ParseResult } from '../../utils/csv'
import { dayLabel, timeLabel } from '../../utils/money'

const store = useAppStore()
const busy = ref(false)
const pasteOpen = ref(false)
const pasteText = ref('')
const parseInfo = ref('')

const last = computed(() => store.s.importStats)
const history = computed(() => store.s.importHistory || [])
const fmtName = computed(() => ({
  wx: '微信', ali: '支付宝', unknown: '未识别来源'
} as Record<string, string>))

function tip(t: string) {
  uni.showToast({ title: t, icon: 'none' })
}

/** 导入历史左侧标签：按文件名后缀显示 CSV / XLSX / XLS */
function fileKind(name: string): string {
  if (/\.xlsx$/i.test(name || '')) return 'XLSX'
  if (/\.xls$/i.test(name || '')) return 'XLS'
  return 'CSV'
}

/** 统一处理：解析结果 → 入库 → 反馈 */
function finishImport(res: ParseResult, name: string, channel = '') {
  if (!res.bills.length) {
    const base = res.skipped
      ? `识别到 ${res.skipped} 行，但都不是有效支出/收入（可能全是退款或不计收支）。`
      : '请确认选的是微信/支付宝导出的账单文件，且包含「交易时间」「金额」「收/支」表头。'
    const diag = [channel ? `读取通道 ${channel}` : '', res.diag || ''].filter(Boolean).join('\n')
    uni.showModal({
      title: '没有解析到账单',
      content: diag ? `${base}\n\n【诊断】${diag}` : base,
      showCancel: false,
      confirmText: '知道了'
    })
    return
  }
  const { stats, alert } = store.importBills(res.bills, name)
  parseInfo.value = `${fmtName.value[res.format]} · 共 ${res.bills.length + res.skipped} 行，有效 ${res.bills.length} 笔`
  if (stats.added) {
    tip(`新增 ${stats.added} 笔，重复跳过 ${stats.skipped} 笔`)
  } else {
    tip(`这 ${stats.skipped} 笔都已存在，未重复导入`)
  }
  if (alert) {
    setTimeout(() => {
      uni.showModal({
        title: '预算提醒',
        content: `本月支出已达 ${alert.level}% 档位，可在首页查看进度。`,
        showCancel: false,
        confirmText: '知道了'
      })
    }, 600)
  }
}

/** 文件导入：按后缀 / 文件头自动区分 CSV 与 XLSX */
function runFile(name: string, buffer: ArrayBuffer, channel = '') {
  if (!buffer.byteLength) {
    uni.showModal({
      title: '文件是空的',
      content: `读取到 0 字节。\n${channel ? '读取通道 ' + channel + '\n' : ''}建议改用「粘贴 CSV 内容」，或先把账单复制到「内部存储/Download」再选择。`,
      showCancel: false,
      confirmText: '知道了'
    })
    return
  }
  try {
    finishImport(parseBillFile(name, buffer), name, channel || `${buffer.byteLength} 字节`)
  } catch (e: any) {
    uni.showModal({
      title: '文件解析失败',
      content: `${name || '未命名'}｜${buffer.byteLength} 字节\n${String(e?.message || e || '未知错误')}\n可能已加密或格式不支持，可在微信「账单 → 常见问题 → 下载账单」重新导出后再试。`,
      showCancel: false,
      confirmText: '知道了'
    })
  }
}

/** 粘贴导入：只支持文本（CSV） */
function runText(name: string, text: string) {
  if (!text || !text.trim()) { tip('内容为空'); return }
  finishImport(parseBillCsv(text, name), name)
}

async function chooseFile() {
  if (busy.value) return
  busy.value = true
  uni.showLoading({ title: '读取文件…', mask: true })
  try {
    const f = await pickCsvFile()
    uni.hideLoading()
    if (!f) {
      tip('未选择文件，可改用「粘贴 CSV 内容」')
      return
    }
    runFile(f.name, f.buffer, f.channel || '')
  } catch (e) {
    uni.hideLoading()
    tip('文件读取失败，请改用「粘贴 CSV 内容」')
  } finally {
    busy.value = false
  }
}

function openPaste() {
  pasteText.value = ''
  pasteOpen.value = true
}
function doPasteImport() {
  const text = pasteText.value
  pasteOpen.value = false
  runText('粘贴导入.csv', text)
}

</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-nav" @tap="uni.navigateBack()">‹ 返回</text>
      <text class="top-title">导入账单</text>
      <text class="top-spacer"></text>
    </view>

    <view class="fineprint">支持微信 / 支付宝导出的账单文件：.xlsx、.xls、.csv。解析全部在本机完成，不上传任何账单。</view>

    <view class="pf-card">
      <view class="pf-logo wx">微</view>
      <view class="pf-main">
        <text class="pf-t">微信支付</text>
        <text class="pf-s">我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单（选 Excel）</text>
      </view>
      <text class="link" @tap="tip('微信：账单页右上角「常见问题」→ 下载账单，可选 Excel(.xlsx) 或 CSV')">查看</text>
    </view>
    <view class="pf-card">
      <view class="pf-logo ali">支</view>
      <view class="pf-main">
        <text class="pf-t">支付宝</text>
        <text class="pf-s">我的 → 账单 → 右上角 → 开具交易流水证明（Excel / CSV）</text>
      </view>
      <text class="link" @tap="tip('支付宝：账单右上角「开具交易流水证明」，可导出 Excel 或 CSV')">查看</text>
    </view>

    <view class="drop" :class="{ busy }" @tap="chooseFile">
      <text class="drop-ic">⬇</text>
      <text class="dt">{{ busy ? '正在读取…' : '选择账单文件' }}</text>
      <text class="ds">支持 .xlsx / .xls / .csv，只在本地解析</text>
    </view>
    <text class="paste-link" @tap="openPaste">选不到文件？粘贴 CSV 内容导入</text>

    <view class="card" v-if="last">
      <view class="row-between">
        <text class="card-title">上次导入</text>
        <text class="more">{{ last.name }}</text>
      </view>
      <view class="stat-grid">
        <view class="stat"><text class="stat-b">{{ last.added }}</text><text class="stat-s">新增记录</text></view>
        <view class="stat"><text class="stat-b">{{ last.skipped }}</text><text class="stat-s">重复跳过</text></view>
        <view class="stat"><text class="stat-b">{{ last.auto }}%</text><text class="stat-s">自动分类</text></view>
      </view>
      <text class="parse-info" v-if="parseInfo">{{ parseInfo }}</text>
    </view>

    <view class="card-white">
      <view class="sec-head"><text class="card-title">导入历史</text><text class="more">最近 10 次</text></view>
      <view v-for="h in history" :key="h.id" class="list-row">
        <view class="tile">{{ fileKind(h.name) }}</view>
        <view class="li-main">
          <text class="li-t">{{ h.name }}</text>
          <text class="li-s">{{ dayLabel(h.ts) }} {{ timeLabel(h.ts) }} · 新增 {{ h.added }} 笔 / 跳过 {{ h.skipped }} 笔</text>
        </view>
        <text class="done-chip">已完成</text>
      </view>
      <view v-if="!history.length" class="empty">还没有导入过账单</view>
    </view>

    <view class="fineprint">去重规则：优先用交易单号，没有单号时按「来源 + 时间（分钟）+ 金额 + 类型」判断；自动记账与导入的账单也会互相去重。</view>

    <!-- 粘贴 CSV 兜底 -->
    <view v-if="pasteOpen" class="mask" @tap="pasteOpen = false">
      <view class="sheet" @tap.stop>
        <view class="row-between">
          <text class="sheet-t">粘贴 CSV 内容</text>
          <text class="more" @tap="pasteOpen = false">关闭</text>
        </view>
        <textarea class="ta" v-model="pasteText" placeholder="把 CSV 文件内容粘贴到这里（含表头「交易时间,交易对方,收/支,金额」）" maxlength="-1" />
        <view class="btn" @tap="doPasteImport">开始解析</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { min-height: 100vh; padding: 0 32rpx 40rpx; box-sizing: border-box; display: flex; flex-direction: column; gap: 16rpx; padding-top: 16rpx; }
.sb-space { height: var(--status-bar-height, 88rpx); }
/* #ifdef H5 */
/* 浏览器没有状态栏，去掉顶部空白 */
.page { padding-top: 0; }
.sb-space { height: 0; }
/* #endif */
.top-bar { display: flex; align-items: center; justify-content: space-between; height: 80rpx; }
.top-nav { font-size: 28rpx; color: #5C4B3A; }
.top-title { font-size: 34rpx; font-weight: 600; }
.top-spacer { width: 88rpx; }
.pf-card { display: flex; align-items: center; gap: 20rpx; padding: 24rpx 26rpx; border-radius: 32rpx; background: #fff; border: 1rpx solid rgba(60,40,18,.05); box-shadow: 0 10rpx 30rpx rgba(60,40,18,.06); }
.pf-logo { width: 72rpx; height: 72rpx; border-radius: 22rpx; display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 700; color: #fff; flex: 0 0 72rpx; }
.pf-logo.wx { background: linear-gradient(140deg, #22D06F, #07A94C); }
.pf-logo.ali { background: linear-gradient(140deg, #4C9BFF, #1450C8); }
.pf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.pf-t { font-size: 26rpx; font-weight: 600; }
.pf-s { font-size: 20rpx; color: #9C8C79; }
.drop { border: 3rpx dashed #F0CF96; border-radius: 32rpx; height: 210rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10rpx; background: #FFF9EC; }
.drop.busy { opacity: .6; }
.drop-ic { width: 72rpx; height: 72rpx; border-radius: 999rpx; background: #FFF2DC; color: #D2760F; display: flex; align-items: center; justify-content: center; font-size: 36rpx; }
.dt { font-size: 26rpx; font-weight: 600; }
.ds { font-size: 22rpx; color: #9C8C79; }
.paste-link { text-align: center; font-size: 22rpx; color: #D2760F; font-weight: 600; padding: 4rpx 0 8rpx; }
.card-white { background: #fff; border: 1rpx solid rgba(60,40,18,.05); border-radius: 32rpx; padding: 28rpx; box-shadow: 0 10rpx 30rpx rgba(60,40,18,.06); }
.sec-head { margin-bottom: 6rpx; }
.done-chip { font-size: 20rpx; padding: 4rpx 14rpx; border-radius: 999rpx; background: #FFF2DC; color: #A55A08; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; margin-top: 20rpx; }
.stat { text-align: center; }
.stat-b { display: block; font-size: 34rpx; font-weight: 700; margin-bottom: 6rpx; font-variant-numeric: tabular-nums; }
.stat-s { font-size: 20rpx; color: #9C8C79; }
.parse-info { display: block; margin-top: 16rpx; font-size: 20rpx; color: #9C8C79; }
.list-row { display: flex; align-items: center; gap: 20rpx; padding: 10rpx 0; }
.tile { width: 68rpx; height: 68rpx; border-radius: 22rpx; display: flex; align-items: center; justify-content: center; font-size: 20rpx; font-weight: 700; flex: 0 0 68rpx; background: rgba(7,193,96,.12); color: #07934C; }
.li-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.li-t { font-size: 26rpx; font-weight: 500; }
.li-s { font-size: 20rpx; color: #9C8C79; }
.empty { padding: 40rpx 0; text-align: center; font-size: 24rpx; color: #9C8C79; }
.mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(60,40,18,.45); display: flex; align-items: flex-end; z-index: 99; }
.sheet { width: 100%; background: #fff; border-radius: 40rpx 40rpx 0 0; padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom)); box-sizing: border-box; display: flex; flex-direction: column; gap: 20rpx; }
.sheet-t { font-size: 30rpx; font-weight: 600; }
.ta { width: 100%; height: 340rpx; background: #FFFBF1; border-radius: 20rpx; padding: 20rpx; box-sizing: border-box; font-size: 22rpx; line-height: 1.5; }
</style>

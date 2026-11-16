<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'
import { watch } from 'vue'
import { useAppStore } from './store/app'
import {
  checkPermission,
  setNativeForeground, pullPendingRecords, consumeLaunchPage,
  postSystemAlert, alertCopy, requestNotifyPermission
} from './utils/notify'
import { bindAutoRecord, ingestPendingList } from './utils/autorecord'

let pollTimer: any = null
/** 前台轮询：原生事件广播若失败，靠这里兜底，1.5 秒内入库 */
function startPendingPoll(store: any) {
  // #ifdef APP-PLUS
  stopPendingPoll()
  pollTimer = setInterval(async () => {
    const list = await pullPendingRecords()
    if (list.length) ingestPendingList(store, list)
  }, 1500)
  // #endif
}
function stopPendingPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onLaunch(async () => {
  const store = useAppStore()
  await store.init()

  // 任何来源的阈值告警 → 系统通知；超支档额外震动
  watch(() => store.s.lastAlert, (a) => {
    if (!a) return
    const { title, body, pct } = alertCopy(a)
    postSystemAlert(title, body, a.level)
    // #ifdef APP-PLUS
    if (pct >= 100) uni.vibrateLong()
    // #endif
  })

  // #ifdef APP-PLUS
  // 状态栏文字用深色，配合浅金背景；沉浸式由 manifest app-plus.statusbar 开启
  plus.navigator.setStatusBarStyle('dark')
  requestNotifyPermission()
  setNativeForeground(true)
  store.syncNative()

  // 点击系统通知启动 → 定位到阈值页
  const page = await consumeLaunchPage()
  if (page === 'threshold' && store.s.onboarded) {
    setTimeout(() => { uni.navigateTo({ url: '/pages/threshold/threshold' }) }, 400)
  }

  // 后台监听期间暂存在原生的账单，启动后补录（不重复告警）
  const pending = await pullPendingRecords()
  const added = ingestPendingList(store, pending)
  if (added > 0) uni.showToast({ title: `已补录 ${added} 笔后台账单`, icon: 'none' })
  startPendingPoll(store)

  const granted = await checkPermission()
  store.s.permission = granted
  if (granted) bindAutoRecord(store)
  // #endif
})

onShow(async () => {
  // #ifdef APP-PLUS
  // 从后台/其他应用返回时状态栏样式可能被系统重置，重新声明一次
  plus.navigator.setStatusBarStyle('dark')
  setNativeForeground(true)
  const store = useAppStore()
  store.syncNative()

  // 后台暂存的账单：从系统设置返回、或从系统通知拉起时都可能有
  const pending = await pullPendingRecords()
  ingestPendingList(store, pending)
  startPendingPoll(store)

  // 从系统通知点击 App（SINGLE_TOP 走 onShow 不走 onLaunch）时，定位阈值页
  const page = await consumeLaunchPage()
  if (page === 'threshold' && store.s.onboarded) {
    setTimeout(() => { uni.navigateTo({ url: '/pages/threshold/threshold' }) }, 400)
  }

  // 从系统设置返回后可能刚授权，重新检查并绑定监听
  checkPermission().then(granted => {
    store.s.permission = granted
    if (granted) bindAutoRecord(store)
  })
  // #endif
})
onHide(() => {
  // #ifdef APP-PLUS
  stopPendingPoll()
  // 保持监听服务运行，后台才能继续记账并发系统通知
  setNativeForeground(false)
  // #endif
})
</script>

<style lang="scss">
/* 全局样式：统一设计 token */
page {
  background: #FFF9EE;
  color: #2A1D10;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
}
.card,
.card-white {
  background: #FFFFFF;
  border: 1rpx solid rgba(60, 40, 18, 0.05);
  border-radius: 32rpx;
  padding: 28rpx;
  box-shadow: 0 10rpx 30rpx rgba(60, 40, 18, 0.06);
}
.card { background: #FFFFFF; }
.card-title { font-size: 26rpx; font-weight: 600; letter-spacing: 0.5rpx; }
.row-between { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.more { font-size: 22rpx; color: #9C8C79; }
.link { font-size: 22rpx; color: #D2760F; font-weight: 600; }
.kpi-label { font-size: 24rpx; color: #5C4B3A; }
.kpi { font-size: 60rpx; font-weight: 700; letter-spacing: -1rpx; line-height: 1.25; font-variant-numeric: tabular-nums; }
.kpi small { font-size: 34rpx; font-weight: 600; }
.kpi-sub { font-size: 24rpx; color: #5C4B3A; margin-top: 4rpx; }
.fineprint { font-size: 22rpx; color: #9C8C79; line-height: 1.5; }
.sec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rpx; }
.btn {
  height: 92rpx;
  border-radius: 24rpx;
  background: #D2760F;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
  box-shadow: 0 10rpx 24rpx rgba(210, 118, 15, 0.20);
}
.btn:active { opacity: 0.9; }
.btn.ghost { background: #FFFFFF; border: 2rpx solid #F0E4CE; color: #5C4B3A; font-weight: 500; box-shadow: none; }
.btn.mini { height: 72rpx; font-size: 26rpx; border-radius: 20rpx; }
.btn.disabled { background: #D9C9B4; box-shadow: none; }

@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
</style>

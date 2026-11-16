<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAppStore } from '../../store/app'
import { checkPermissionDetail, openSettings, ensureListenerBinding } from '../../utils/notify'
import { bindAutoRecord } from '../../utils/autorecord'

const store = useAppStore()

/** 未授权时展示原生读到的原始值，便于排查机型差异 */
const diag = ref('')

/** 状态来自系统「通知使用权」，不是本地开关 */
async function refresh() {
  const d = await checkPermissionDetail()
  store.s.permission = d.granted
  diag.value = d.granted ? '' : [d.raw, d.self].filter(Boolean).join('  |  ')
  if (d.granted) { ensureListenerBinding(); bindAutoRecord(store) }
}

function toggle() {
  openSettings()
  if (store.s.permission) return
  uni.showToast({ title: '打开「通知使用权」后返回，状态会自动刷新', icon: 'none' })
}

onMounted(() => { refresh() })
// 从系统设置页返回时重新检测授权结果
onShow(() => { refresh() })
</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-nav" @tap="uni.navigateBack()">‹ 返回</text>
      <text class="top-title">自动记账</text>
      <text class="top-spacer"></text>
    </view>

    <view class="perm-hero">
      <view class="perm-ico">🔔</view>
      <text class="h4">{{ store.s.permission ? '正在监听支付通知' : '开启通知使用权' }}</text>
      <text class="desc">{{ store.s.permission
        ? '微信与支付宝的支付通知会被解析成账单，金额较低的自动归入常用分类。'
        : '读取微信与支付宝的支付通知，识别金额和商户后自动生成账单，无需每次手动输入。' }}</text>
    </view>
    <view class="status-chip" :class="{ on: store.s.permission }">
      当前状态 · {{ store.s.permission ? '已授权' : '未授权' }}
    </view>

    <view class="card">
      <text class="card-title">三步开启</text>
      <view class="step-row">
        <text class="step-num">1</text>
        <view class="step-main"><text class="step-t">打开系统「设置」</text><text class="step-d">进入通知与状态栏，或直接搜索「通知使用权」</text></view>
      </view>
      <view class="step-row">
        <text class="step-num">2</text>
        <view class="step-main"><text class="step-t">找到「通知使用权」列表</text><text class="step-d">部分机型路径为：设置 → 应用 → 特殊权限</text></view>
      </view>
      <view class="step-row">
        <text class="step-num">3</text>
        <view class="step-main"><text class="step-t">允许「楠楠记账本」访问通知</text><text class="step-d">开启后返回 APP，状态会自动变为「监听中」</text></view>
      </view>
    </view>

    <view class="card">
      <text class="card-title">后台稳定运行建议</text>
      <view class="keep-row">
        <text class="keep-t">建议允许自启动</text>
        <text class="keep-d">在「设置 → 应用管理 → 楠楠记账本」中允许自启动，减少重启手机后监听服务被系统断开。</text>
      </view>
      <view class="keep-row">
        <text class="keep-t">建议电池策略设为无限制</text>
        <text class="keep-d">在「设置 → 电池 → 应用耗电管理 → 楠楠记账本」中选择「无限制」，避免后台监听被系统清理。通知使用权仍需保持开启。</text>
      </view>
    </view>

    <view class="card">
      <view class="os-item">
        <text>楠楠记账本</text>
        <text class="state" :class="{ on: store.s.permission }">{{ store.s.permission ? '允许' : '未授权' }}</text>
      </view>
      <view class="os-item">
        <text>其他应用</text>
        <text class="state off">关闭</text>
      </view>
    </view>

    <view class="btn" @tap="toggle">{{ store.s.permission ? '已授权 · 去系统设置管理' : '去开启通知使用权' }}</view>
    <view class="btn ghost" @tap="uni.navigateTo({ url: '/pages/import/import' })">不用自动记账，改用导入</view>

    <view class="fineprint">iPhone 不允许读取其他 App 的通知，iOS 端请使用 CSV 导入或手动记账。</view>
    <view v-if="!store.s.permission && diag" class="fineprint">诊断：{{ diag }}</view>
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
.perm-hero { text-align: center; padding: 24rpx 0 4rpx; }
.perm-ico { width: 132rpx; height: 132rpx; border-radius: 42rpx; background: linear-gradient(140deg, #FFF6E4, #FFEECB); display: flex; align-items: center; justify-content: center; margin: 0 auto 24rpx; font-size: 60rpx; color: #D2760F; box-shadow: 0 10rpx 26rpx rgba(210,118,15,.14); }
.h4 { display: block; font-size: 34rpx; font-weight: 600; }
.desc { display: block; margin-top: 12rpx; font-size: 22rpx; line-height: 1.7; color: #5C4B3A; }
.status-chip { display: flex; align-items: center; justify-content: center; gap: 12rpx; height: 56rpx; border-radius: 999rpx; background: #FEF4E6; color: #B45309; font-size: 22rpx; font-weight: 600; margin: 8rpx auto; width: 300rpx; }
.status-chip.on { background: #FFF2DC; color: #8A4A0E; }
.step-row { display: flex; align-items: flex-start; gap: 20rpx; padding: 20rpx 0; border-bottom: 1rpx solid #F8F1E5; }
.step-row:last-child { border-bottom: 0; }
.step-main { flex: 1; min-width: 0; }
.step-num { width: 44rpx; height: 44rpx; border-radius: 50%; background: #FFF2DC; color: #8A4A0E; font-size: 22rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: 0 0 44rpx; }
.step-t { display: block; font-size: 26rpx; font-weight: 600; }
.step-d { display: block; font-size: 22rpx; color: #9C8C79; margin-top: 6rpx; line-height: 1.5; }
.keep-row { padding: 18rpx 0 0; }
.keep-t { display: block; font-size: 26rpx; font-weight: 600; color: #5C4B3A; }
.keep-d { display: block; margin-top: 6rpx; font-size: 22rpx; color: #9C8C79; line-height: 1.6; }
.os-item { display: flex; align-items: center; justify-content: space-between; padding: 22rpx 4rpx; font-size: 26rpx; border-bottom: 1rpx solid #F8F1E5; }
.os-item:last-child { border-bottom: 0; }
.state { font-size: 22rpx; padding: 4rpx 14rpx; border-radius: 10rpx; font-weight: 600; }
.state.on { background: #FFF2DC; color: #8A4A0E; }
.state.off { background: #F4EADA; color: #9C8C79; }
</style>

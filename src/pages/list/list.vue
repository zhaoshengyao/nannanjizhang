<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '../../store/app'
import { money, num, srcName, dayLabel, timeLabel, monthKey } from '../../utils/money'

const store = useAppStore()
const filter = ref<'all' | 'wx' | 'ali' | 'manual'>('all')

const list = computed(() => {
  return store.api.recordsOfMonth(store.s.viewMonth).slice().sort((a, b) => b.ts - a.ts)
    .filter(r => filter.value === 'all' || r.source === filter.value)
})
const groups = computed(() => {
  const g: Record<string, any[]> = {}
  list.value.forEach(r => { const k = dayLabel(r.ts); (g[k] = g[k] || []).push(r) })
  return g
})
const keys = computed(() => Object.keys(groups.value))
const sumLabel = computed(() => (store.s.viewMonth === monthKey() ? '本月' : '该月'))

/** 当天支出合计（收入不计） */
function dayTotal(arr: any[]): number {
  return arr.filter(r => r.type !== 'income').reduce((a, r) => a + r.amount, 0)
}

function openRecord(id: string) { uni.navigateTo({ url: '/pages/record/record?id=' + id }) }

</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-spacer"></text>
      <text class="top-title">账单明细</text>
      <text class="top-spacer"></text>
    </view>
    <month-bar :model="store.s.viewMonth" @update:model="store.s.viewMonth = $event" />
    <view class="chips">
      <text class="chip" :class="{ on: filter === 'all' }" @tap="filter = 'all'">全部</text>
      <text class="chip" :class="{ on: filter === 'wx' }" @tap="filter = 'wx'">微信</text>
      <text class="chip" :class="{ on: filter === 'ali' }" @tap="filter = 'ali'">支付宝</text>
      <text class="chip" :class="{ on: filter === 'manual' }" @tap="filter = 'manual'">手动</text>
    </view>
    <view class="card-white sum">
      <view class="sum-item">
        <text class="kpi-label">{{ sumLabel }}支出</text>
        <text class="sum-amt">{{ money(store.api.spentOfMonth(store.s.viewMonth)) }}</text>
      </view>
      <view class="sum-divider"></view>
      <view class="sum-item">
        <text class="kpi-label">{{ sumLabel }}收入</text>
        <text class="sum-amt income">{{ money(store.api.incomeOfMonth(store.s.viewMonth)) }}</text>
      </view>
    </view>
    <view v-if="keys.length" class="groups">
      <view v-for="k in keys" :key="k" class="card-white day-card">
        <view class="sec-head">
          <text class="card-title">{{ k }}</text>
          <text class="more">{{ groups[k].length }} 笔 · 支出 {{ money(dayTotal(groups[k])) }}</text>
        </view>
        <view class="list-row" v-for="r in groups[k]" :key="r.id" @tap="openRecord(r.id)">
          <view class="tile" :class="r.source">{{ store.catOf(r.catId).icon }}</view>
          <view class="li-main">
            <text class="li-t">{{ r.note || store.catOf(r.catId).name }}</text>
            <text class="li-s"><text class="src src-{{ r.source }}">{{ srcName(r.source) }}</text> {{ timeLabel(r.ts) }} · {{ store.catOf(r.catId).name }}</text>
          </view>
          <text class="li-amt" :class="{ income: r.type === 'income' }">{{ r.type === 'income' ? '+' : '-' }}{{ num(r.amount) }}</text>
        </view>
      </view>
    </view>
    <view v-else class="card-white empty-card">这个月还没有记录，可在首页记一笔或从「导入账单」批量导入</view>
  </view>
</template>

<style lang="scss" scoped>
.page { min-height: 100vh; padding: 0 32rpx 40rpx; box-sizing: border-box; display: flex; flex-direction: column; gap: 16rpx; padding-top: 16rpx; }
.sb-space { height: var(--status-bar-height, 88rpx); }
/* #ifdef H5 */
/* 浏览器没有状态栏，去掉顶部预留；并扣除 tabBar 高度避免多出一屏空白 */
.page { min-height: calc(100vh - 58px); padding-top: 0; }
.sb-space { height: 0; }
/* #endif */
.top-bar { display: flex; align-items: center; justify-content: space-between; height: 80rpx; }
.top-title { font-size: 34rpx; font-weight: 600; }
.top-spacer { width: 88rpx; }
.chips { display: flex; gap: 14rpx; flex-wrap: wrap; }
.chip { height: 60rpx; padding: 0 26rpx; border-radius: 999rpx; background: #FFFFFF; border: 1rpx solid rgba(60,40,18,.06); font-size: 24rpx; color: #5C4B3A; display: inline-flex; align-items: center; box-shadow: 0 4rpx 12rpx rgba(60,40,18,.04); }
.chip.on { background: #D2760F; border-color: #D2760F; color: #FFFFFF; font-weight: 600; box-shadow: 0 8rpx 18rpx rgba(210,118,15,.24); }
.sum { display: flex; align-items: center; padding: 30rpx 28rpx; }
.sum-item { flex: 1; display: flex; flex-direction: column; gap: 8rpx; }
.sum-amt { font-size: 36rpx; font-weight: 700; font-variant-numeric: tabular-nums; }
.sum-amt.income { color: #1E9D63; }
.sum-divider { width: 1rpx; height: 56rpx; background: #F0E4CE; margin: 0 28rpx; }
.groups { display: flex; flex-direction: column; gap: 16rpx; }
.day-card { padding-bottom: 12rpx; }
.day-card .sec-head { margin-bottom: 4rpx; }
.list-row { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; border-bottom: 1rpx solid #F8F1E5; }
.list-row:last-child { border-bottom: 0; }
.tile { width: 68rpx; height: 68rpx; border-radius: 22rpx; background: #F4EBDA; display: flex; align-items: center; justify-content: center; font-size: 26rpx; font-weight: 600; color: #5C4B3A; }
.tile.wx { background: rgba(7,193,96,.12); color: #07934C; }
.tile.ali { background: rgba(22,119,255,.12); color: #1463D6; }
.li-main { flex: 1; min-width: 0; }
.li-t { font-size: 26rpx; font-weight: 500; }
.li-s { font-size: 20rpx; color: #9C8C79; margin-top: 6rpx; display: flex; gap: 8rpx; align-items: center; }
.li-amt { font-size: 28rpx; font-weight: 600; font-variant-numeric: tabular-nums; }
.li-amt.income { color: #1E9D63; }
.src { padding: 2rpx 12rpx; border-radius: 10rpx; font-size: 20rpx; font-weight: 600; }
.src-wx { background: rgba(7,193,96,.10); color: #07934C; }
.src-ali { background: rgba(22,119,255,.10); color: #1463D6; }
.src-manual { background: #F4EADA; color: #7A6956; }
.card-white { background: #fff; border: 1rpx solid rgba(60,40,18,.05); border-radius: 32rpx; padding: 28rpx; box-shadow: 0 10rpx 30rpx rgba(60,40,18,.06); }
.empty-card { padding: 56rpx 0; text-align: center; font-size: 24rpx; color: #9C8C79; }
</style>

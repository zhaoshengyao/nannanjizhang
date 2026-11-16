<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../../store/app'
import { money, monthKey, monthLabel } from '../../utils/money'

const store = useAppStore()

const viewRecords = computed(() => store.api.recordsOfMonth(store.s.viewMonth))
const catsArr = computed(() => {
  const m = store.api.catSpendOfMonth(store.s.viewMonth)
  const arr = store.s.cats.map(c => ({ cat: c, amt: m[c.id] || 0 })).filter(x => x.amt > 0)
  arr.sort((a, b) => b.amt - a.amt)
  return arr
})
const total = computed(() => store.api.spentOfMonth(store.s.viewMonth))
const maxCat = computed(() => catsArr.value[0]?.amt || 1)
const biggest = computed(() => {
  const recs = viewRecords.value.filter(r => r.type !== 'income')
  return recs.slice().sort((a, b) => b.amount - a.amount)[0]
})
/** 日均：当月按已过天数，历史月份按整月天数 */
const dayCount = computed(() => {
  const [y, m] = store.s.viewMonth.split('-').map(Number)
  if (store.s.viewMonth === monthKey()) return new Date().getDate()
  return new Date(y, m, 0).getDate()
})
const avg = computed(() => total.value / Math.max(dayCount.value, 1))
const heroLabel = computed(() => `${monthLabel(store.s.viewMonth)}支出`)

</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-spacer"></text>
      <text class="top-title">统计</text>
      <text class="top-spacer"></text>
    </view>
    <month-bar :model="store.s.viewMonth" @update:model="store.s.viewMonth = $event" />
    <view class="hero">
      <text class="hero-label">{{ heroLabel }}</text>
      <view class="hero-kpi">{{ money(total) }}</view>
      <view class="stat-grid">
        <view class="stat"><text class="stat-b">{{ money(avg) }}</text><text class="stat-s">日均</text></view>
        <view class="stat"><text class="stat-b">{{ biggest ? money(biggest.amount) : '—' }}</text><text class="stat-s">最大单笔</text></view>
        <view class="stat"><text class="stat-b">{{ viewRecords.length }}</text><text class="stat-s">笔数</text></view>
      </view>
    </view>
    <view class="card">
      <view class="row-between" style="margin-bottom:12rpx;">
        <text class="card-title">分类占比</text>
        <text class="more">共 {{ catsArr.length }} 类</text>
      </view>
      <view v-if="catsArr.length">
        <view class="cat-row" v-for="x in catsArr" :key="x.cat.id">
          <view class="cat-ico">{{ x.cat.icon }}</view>
          <view class="cat-main">
            <view class="row-between">
              <text class="cat-name">{{ x.cat.name }}</text>
              <text class="cat-amt">{{ money(x.amt) }} · {{ total ? Math.round(x.amt / total * 100) : 0 }}%</text>
            </view>
            <view class="mini-bar"><view class="mb-fill" :style="{ width: Math.max(6, x.amt / maxCat * 100) + '%' }"></view></view>
          </view>
        </view>
      </view>
      <view v-else class="empty">这个月还没有支出</view>
    </view>
    <view class="fineprint">统计只算所选月份的支出，收入单独记录，不参与预算告警。</view>
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
.hero {
  background: linear-gradient(140deg, #FFF0BE 0%, #FFC93C 46%, #F0A32E 100%);
  border-radius: 32rpx;
  padding: 32rpx 32rpx 24rpx;
  color: #5C2C05;
  box-shadow: 0 14rpx 36rpx rgba(210,118,15,.20);
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  width: 240rpx; height: 240rpx;
  right: -80rpx; top: -120rpx;
  border-radius: 50%;
  background: rgba(255,255,255,.45);
}
.hero-label { font-size: 24rpx; color: rgba(92,44,5,.75); position: relative; z-index: 1; }
.hero-kpi { font-size: 60rpx; font-weight: 700; letter-spacing: -1rpx; line-height: 1.25; font-variant-numeric: tabular-nums; position: relative; z-index: 1; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; margin-top: 24rpx; padding-top: 24rpx; border-top: 1rpx solid rgba(92,44,5,.22); position: relative; z-index: 1; }
.stat { text-align: center; }
.stat-b { display: block; font-size: 32rpx; font-weight: 700; margin-bottom: 6rpx; font-variant-numeric: tabular-nums; color: #5C2C05; }
.stat-s { font-size: 20rpx; color: rgba(92,44,5,.70); }
.cat-row { display: flex; align-items: center; gap: 18rpx; padding: 16rpx 0; }
.cat-ico { width: 60rpx; height: 60rpx; border-radius: 20rpx; background: #FFF6E4; display: flex; align-items: center; justify-content: center; font-size: 28rpx; flex: 0 0 60rpx; }
.cat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10rpx; }
.cat-name { font-size: 24rpx; font-weight: 500; }
.cat-amt { font-size: 22rpx; color: #5C4B3A; font-variant-numeric: tabular-nums; }
.mini-bar { width: 100%; height: 12rpx; border-radius: 999rpx; background: #F4EADA; overflow: hidden; display: flex; }
.mb-fill { height: 100%; border-radius: 999rpx; background: linear-gradient(90deg, #FFC93C, #D2760F); }
.empty { padding: 48rpx 0; text-align: center; font-size: 24rpx; color: #9C8C79; }
</style>

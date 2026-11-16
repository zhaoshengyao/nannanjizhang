<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAppStore } from '../../store/app'
import { money, srcName } from '../../utils/money'
import type { Record as Bill, Source } from '../../utils/threshold'

const store = useAppStore()
const rec = ref<Bill | null>(null)

const amount = ref('')
const type = ref<'expense' | 'income'>('expense')
const catId = ref('')
const source = ref<Source>('manual')
const note = ref('')
const dateStr = ref('')
const timeStr = ref('')

const cats = computed(() => store.api.orderedCats())
const sourceList: { v: Source; n: string }[] = [
  { v: 'wx', n: '微信' }, { v: 'ali', n: '支付宝' }, { v: 'manual', n: '手动' }
]

const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const toTime = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onLoad((q: any) => {
  const id = q?.id ? String(q.id) : ''
  const r = store.s.records.find(x => x.id === id) || null
  if (!r) {
    uni.showToast({ title: '账单不存在或已删除', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  rec.value = r
  amount.value = r.amount.toFixed(2)
  type.value = r.type
  catId.value = r.catId
  source.value = r.source
  note.value = r.note || ''
  dateStr.value = toDate(r.ts)
  timeStr.value = toTime(r.ts)
})

function onDate(e: any) { dateStr.value = e.detail.value }
function onTime(e: any) { timeStr.value = e.detail.value }

function save() {
  if (!rec.value) return
  const amt = Math.round((parseFloat(amount.value) || 0) * 100) / 100
  if (!(amt > 0)) { uni.showToast({ title: '请输入大于 0 的金额', icon: 'none' }); return }
  if (!catId.value) { uni.showToast({ title: '请选择分类', icon: 'none' }); return }
  const ts = new Date(`${dateStr.value} ${timeStr.value}:00`).getTime()
  if (!isFinite(ts)) { uni.showToast({ title: '日期格式不正确', icon: 'none' }); return }
  store.updateRecord(rec.value.id, {
    amount: amt, type: type.value, catId: catId.value,
    source: source.value, note: note.value.trim(), ts
  })
  uni.showToast({ title: '已保存', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 400)
}

function remove() {
  if (!rec.value) return
  uni.showModal({
    title: '删除这笔账单',
    content: `删除后不可恢复：${money(rec.value.amount)} · ${rec.value.note || '未填写备注'}`,
    confirmText: '删除',
    confirmColor: '#D92D20',
    success: (res) => {
      if (!res.confirm || !rec.value) return
      store.deleteRecord(rec.value.id)
      uni.showToast({ title: '已删除', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 400)
    }
  })
}
</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-nav" @tap="uni.navigateBack()">‹ 返回</text>
      <text class="top-title">编辑账单</text>
      <text class="top-spacer"></text>
    </view>

    <view class="card" v-if="rec">
      <view class="seg">
        <text class="seg-i" :class="{ on: type === 'expense' }" @tap="type = 'expense'">支出</text>
        <text class="seg-i" :class="{ on: type === 'income' }" @tap="type = 'income'">收入</text>
      </view>

      <view class="amount-row">
        <text class="cny">¥</text>
        <input class="amount" type="digit" v-model="amount" placeholder="0.00" />
      </view>

      <view class="f-label">分类</view>
      <view class="cat-wrap">
        <view
          v-for="c in cats" :key="c.id"
          class="cat"
          :class="{ on: catId === c.id }"
          @tap="catId = c.id"
        >
          <text class="cat-ico">{{ c.icon }}</text>
          <text class="cat-name">{{ c.name }}</text>
        </view>
      </view>

      <view class="f-label">来源</view>
      <view class="chips">
        <text
          v-for="s in sourceList" :key="s.v"
          class="chip" :class="{ on: source === s.v }"
          @tap="source = s.v"
        >{{ s.n }}</text>
      </view>

      <view class="f-label">时间</view>
      <view class="time-row">
        <picker mode="date" :value="dateStr" @change="onDate">
          <view class="picker">{{ dateStr || '选择日期' }}</view>
        </picker>
        <picker mode="time" :value="timeStr" @change="onTime">
          <view class="picker">{{ timeStr || '选择时间' }}</view>
        </picker>
      </view>

      <view class="f-label">备注</view>
      <input class="inp" v-model="note" maxlength="40" placeholder="比如：公司楼下咖啡" />

      <view class="btn" style="margin-top:24rpx;" @tap="save">保存修改</view>
      <view class="del-btn" @tap="remove">删除这笔账单</view>
    </view>

    <view class="fineprint" v-if="rec">当前来源：{{ srcName(rec.source) }}<text v-if="rec.extId"> · 导入账单</text></view>
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
.seg { display: flex; background: #F4EBDB; border-radius: 20rpx; padding: 6rpx; }
.seg-i { flex: 1; text-align: center; height: 68rpx; line-height: 68rpx; font-size: 26rpx; color: #5C4B3A; border-radius: 16rpx; }
.seg-i.on { background: #FFFFFF; color: #D2760F; font-weight: 600; box-shadow: 0 4rpx 12rpx rgba(60,40,18,.08); }
.amount-row { display: flex; align-items: center; gap: 12rpx; padding: 30rpx 0 10rpx; }
.cny { font-size: 44rpx; font-weight: 700; color: #2A1D10; }
.amount { flex: 1; font-size: 64rpx; font-weight: 700; letter-spacing: -1rpx; font-variant-numeric: tabular-nums; }
.f-label { display: block; margin: 24rpx 0 12rpx; font-size: 24rpx; color: #5C4B3A; font-weight: 600; }
.cat-wrap { display: flex; flex-wrap: wrap; gap: 12rpx; }
.cat { display: flex; align-items: center; gap: 8rpx; padding: 10rpx 18rpx; border-radius: 999rpx; background: #F4EBDB; }
.cat.on { background: #FFF2DC; }
.cat-ico { font-size: 22rpx; font-weight: 600; color: #5C4B3A; }
.cat.on .cat-ico, .cat.on .cat-name { color: #A55A08; }
.cat-name { font-size: 24rpx; color: #5C4B3A; }
.chips { display: flex; gap: 12rpx; }
.chip { padding: 10rpx 24rpx; border-radius: 999rpx; background: #F4EBDB; font-size: 24rpx; color: #5C4B3A; }
.chip.on { background: #D2760F; color: #fff; font-weight: 600; }
.time-row { display: flex; gap: 16rpx; }
.picker { flex: 1; height: 76rpx; line-height: 76rpx; text-align: center; border-radius: 16rpx; background: #FFFBF1; font-size: 26rpx; color: #2A1D10; }
.inp { height: 84rpx; background: #FFFBF1; border-radius: 16rpx; padding: 0 20rpx; font-size: 26rpx; }
.del-btn { margin-top: 20rpx; height: 88rpx; line-height: 88rpx; text-align: center; font-size: 26rpx; color: #D92D20; font-weight: 600; }
</style>

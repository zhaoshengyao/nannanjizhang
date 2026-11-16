<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '../../store/app'
import { money, daysInMonth } from '../../utils/money'

const store = useAppStore()
const editing = ref(false)
const budgetDraft = ref('')
const cbEditor = ref(false)
const cbCat = ref('')
const cbAmt = ref('')
// 告警档位编辑
const editingLevels = ref(false)
const levelDraft = ref<{ pct: string; on: boolean }[]>([])

function editBudget() {
  editing.value = true
  budgetDraft.value = store.s.budget ? String(store.s.budget) : ''
}
function saveBudget() {
  const v = parseFloat(budgetDraft.value)
  if (!(v > 0)) { uni.showToast({ title: '请输入有效金额', icon: 'none' }); return }
  store.updateBudget(v)
  editing.value = false
  uni.showToast({ title: '预算已更新', icon: 'none' })
}
function toggleThr(pct: number) { store.toggleLevel(pct) }
function editLevels() {
  levelDraft.value = store.s.thr.map(l => ({ pct: String(l.pct), on: l.on }))
  editingLevels.value = true
}
function cancelLevels() { editingLevels.value = false }
function toggleDraft(i: number) { levelDraft.value[i].on = !levelDraft.value[i].on }
function saveLevels() {
  const arr = levelDraft.value.map(x => ({ pct: parseFloat(x.pct), on: x.on }))
  if (arr.some(x => !isFinite(x.pct))) { uni.showToast({ title: '请输入百分比数字', icon: 'none' }); return }
  if (arr.some(x => x.pct < 1 || x.pct > 200)) { uni.showToast({ title: '百分比需在 1–200 之间', icon: 'none' }); return }
  if (!(arr[0].pct < arr[1].pct && arr[1].pct < arr[2].pct)) { uni.showToast({ title: '三档需从低到高递增', icon: 'none' }); return }
  if (!store.updateLevels(arr)) { uni.showToast({ title: '保存失败，请检查档位', icon: 'none' }); return }
  editingLevels.value = false
  uni.showToast({ title: '告警档位已更新', icon: 'none' })
}
function setRemind(v: 'each' | 'daily' | 'first') { store.setReminder(v) }
function addCbEditor() {
  cbEditor.value = true
  cbCat.value = store.s.cats[0]?.id || ''
  cbAmt.value = ''
}
function saveCb() {
  const v = parseFloat(cbAmt.value)
  if (!cbCat.value) { uni.showToast({ title: '请选择分类', icon: 'none' }); return }
  if (!(v > 0)) { uni.showToast({ title: '请输入金额', icon: 'none' }); return }
  store.s.catBudgets[cbCat.value] = Math.round(v * 100) / 100
  cbEditor.value = false
  uni.showToast({ title: '分类阈值已保存', icon: 'none' })
}
function delCb(id: string) {
  delete store.s.catBudgets[id]
  uni.showToast({ title: '已移除', icon: 'none' })
}

const budgetInfo = computed(() => {
  const b = store.s.budget
  const s = store.api.monthSpent()
  if (!b) return null
  const d = new Date()
  return {
    budget: b, spent: s,
    remain: Math.max(b - s, 0),
    pct: s / b * 100,
    daily: b / daysInMonth(d)
  }
})

</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-nav" @tap="uni.navigateBack()">‹ 返回</text>
      <text class="top-title">阈值与告警</text>
      <text class="top-spacer"></text>
    </view>

    <view class="card-white" v-if="!editing">
      <view class="row-between">
        <text class="card-title">月度总预算</text>
        <text class="link" @tap="editBudget">修改</text>
      </view>
      <view class="row-between" style="align-items:flex-end;margin-top:16rpx;">
        <text class="big-num">{{ budgetInfo ? money(budgetInfo.budget) : '未设置' }}</text>
        <text class="kpi-sub" v-if="budgetInfo">本月日均可用 {{ money(budgetInfo.daily) }}</text>
      </view>
      <template v-if="budgetInfo">
        <view class="mini-bar" style="margin-top:20rpx;"><view class="mb-fill" :class="{ gray: budgetInfo.pct < 70, warn: budgetInfo.pct >= 70 }" :style="{ width: Math.min(budgetInfo.pct, 100) + '%' }"></view></view>
        <view class="row-between" style="margin-top:12rpx;font-size:22rpx;color:#9C8C79;">
          <text>已用 {{ money(budgetInfo.spent) }}</text><text>剩余 {{ money(budgetInfo.remain) }}</text>
        </view>
      </template>
    </view>
    <view class="card" v-else>
      <view class="row-between">
        <text class="card-title">月度总预算</text>
        <text class="more" @tap="editing = false">取消</text>
      </view>
      <view class="row-between" style="margin-top:16rpx;gap:16rpx;">
        <text class="cur">¥</text>
        <input class="inp" type="digit" placeholder="请输入金额" v-model="budgetDraft" />
        <view class="btn mini" @tap="saveBudget">保存</view>
      </view>
    </view>

    <view class="card">
      <view class="row-between" style="margin-bottom:4rpx;">
        <text class="card-title">告警档位</text>
        <text v-if="!editingLevels" class="link" @tap="editLevels">修改百分比</text>
        <text v-else class="more">编辑中</text>
      </view>

      <template v-if="!editingLevels">
        <view v-for="(l, i) in store.s.thr" :key="l.pct" class="lev-row">
          <text class="lev-pct" :class="['p70b', 'p90b', 'p100b'][i]">{{ l.pct }}%</text>
          <view class="lev-main">
            <text class="lev-t">{{ ['提醒', '警告', '超支'][i] }}</text>
            <text class="lev-d">{{ ['轻弹窗，可一键关闭', '弹窗 + 系统通知', '弹窗 + 通知 + 震动'][i] }}</text>
          </view>
          <view class="switch" :class="{ on: l.on }" @tap="toggleThr(l.pct)"></view>
        </view>
        <view class="fineprint" style="margin-top:12rpx;">按月度总预算计算，可点「修改百分比」自定义三档。</view>
      </template>

      <template v-else>
        <view v-for="(d, i) in levelDraft" :key="i" class="lev-edit-row">
          <text class="lev-t">{{ ['提醒档', '警告档', '超支档'][i] }}</text>
          <view class="lev-input-box">
            <input class="lev-inp" type="digit" maxlength="3" v-model="d.pct" />
            <text class="lev-unit">%</text>
          </view>
          <view class="switch" :class="{ on: d.on }" @tap="toggleDraft(i)"></view>
        </view>
        <view class="fineprint" style="margin-top:12rpx;">三档需严格递增，范围 1–200%；可超过 100% 作为超支线。</view>
        <view class="row-between" style="margin-top:16rpx;gap:16rpx;">
          <view class="btn ghost" style="flex:1;height:76rpx;" @tap="cancelLevels">取消</view>
          <view class="btn" style="flex:1;height:76rpx;" @tap="saveLevels">保存</view>
        </view>
      </template>
    </view>

    <view class="card">
      <view class="row-between" style="margin-bottom:4rpx;">
        <text class="card-title">分类阈值</text>
        <text class="link" @tap="uni.navigateTo({ url: '/pages/categories/categories' })">管理分类 ›</text>
      </view>
      <view v-if="Object.keys(store.s.catBudgets).length">
        <view v-for="(lim, id) in store.s.catBudgets" :key="id" class="thr-row">
          <view class="thr-top">
            <text>{{ store.catOf(id).name }}</text>
            <text class="now">{{ money(store.api.spentOf(id)) }} / {{ money(lim) }}
              <text class="link" style="margin-left:16rpx;" @tap="delCb(id)">移除</text>
            </text>
          </view>
          <view class="mini-bar">
            <view class="mb-fill" :class="{ warn: store.api.spentOf(id) >= lim }" :style="{ width: Math.min(store.api.spentOf(id) / lim * 100, 100) + '%' }"></view>
          </view>
        </view>
      </view>
      <view v-else class="empty" style="padding:28rpx 0;">还没有分类阈值，添加后按分类单独提醒</view>
      <view v-if="!cbEditor" class="add-row" @tap="addCbEditor">＋ 为自定义分类设置阈值</view>
      <view v-else class="card" style="margin-top:12rpx;">
        <view class="row-between">
          <text class="card-title">设置分类阈值</text>
          <text class="more" @tap="cbEditor = false">取消</text>
        </view>
        <view class="row-between" style="margin-top:16rpx;gap:16rpx;">
          <picker class="inp" :range="store.s.cats.map(c => c.name)" @change="e => cbCat = store.s.cats[e.detail.value].id">
            <view class="inp-picker">{{ store.catOf(cbCat).name || '选择分类' }}</view>
          </picker>
          <input class="inp" type="digit" placeholder="金额" v-model="cbAmt" />
        </view>
        <view class="btn" style="height:76rpx;margin-top:16rpx;" @tap="saveCb">保存阈值</view>
      </view>
    </view>

    <view class="card">
      <view class="row-between" style="margin-bottom:16rpx;">
        <text class="card-title">提醒频率</text>
        <text class="more">可单次，可多次</text>
      </view>
      <view class="seg3">
        <text class="seg-btn-3" :class="{ on: store.s.reminder === 'each' }" @tap="setRemind('each')">每次触发</text>
        <text class="seg-btn-3" :class="{ on: store.s.reminder === 'daily' }" @tap="setRemind('daily')">每日合并</text>
        <text class="seg-btn-3" :class="{ on: store.s.reminder === 'first' }" @tap="setRemind('first')">仅首次</text>
      </view>
      <view class="hint">
        {{ store.s.reminder === 'daily' ? '每日合并：同一档位每天只提醒一次，第二天会重新计算；预算不跨月结转。' :
           store.s.reminder === 'each' ? '每笔账单入库后检查，越线立即弹窗；可能同一天多次提醒。' :
           '同一档位每自然月只弹一次，之后只记录不打扰。' }}
      </view>
    </view>
    <view class="fineprint">预算每月 1 日 00:00 重置，未花完的额度不做结转。</view>
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
.big-num { font-size: 48rpx; font-weight: 700; letter-spacing: -0.6rpx; }
.lev-row { display: flex; align-items: center; gap: 20rpx; padding: 14rpx 0; border-bottom: 1rpx solid #F4EBDB; }
.lev-row:last-child { border-bottom: 0; }
.lev-main { flex: 1; display: flex; flex-direction: column; gap: 4rpx; }
.lev-t { font-size: 26rpx; font-weight: 500; }
.lev-d { font-size: 22rpx; color: #9C8C79; }
.lev-pct { font-size: 22rpx; font-weight: 600; padding: 4rpx 14rpx; border-radius: 10rpx; }
.p70b { background: #FEF4E6; color: #B45309; }
.p90b { background: #FDECEC; color: #B42318; }
.p100b { background: #F4EADA; color: #5C4B3A; }
.switch { width: 76rpx; height: 44rpx; border-radius: 999rpx; background: #E3D7C6; position: relative; }
.switch::after { content: ''; position: absolute; top: 4rpx; left: 4rpx; width: 36rpx; height: 36rpx; border-radius: 50%; background: #fff; box-shadow: 0 2rpx 4rpx rgba(0,0,0,.15); transition: left .15s; }
.switch.on { background: #D2760F; }
.switch.on::after { left: 36rpx; }
.seg3 { display: flex; background: #F4EADA; border-radius: 20rpx; padding: 10rpx; gap: 12rpx; }
.seg-btn-3 { flex: 1; height: 52rpx; border-radius: 16rpx; display: flex; align-items: center; justify-content: center; font-size: 24rpx; color: #5C4B3A; }
.seg-btn-3.on { background: #fff; color: #8A4A0E; font-weight: 600; box-shadow: 0 2rpx 4rpx rgba(60,40,18,.06); }
.hint { font-size: 22rpx; line-height: 1.6; color: #9C8C79; margin-top: 16rpx; }
.inp-picker { height: 72rpx; border-radius: 20rpx; border: 1rpx solid #F0E4CE; background: #FFFCF5; padding: 0 24rpx; font-size: 28rpx; display: flex; align-items: center; color: #2A1D10; }
.add-row { height: 68rpx; border: 2rpx dashed #D9C9B4; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 24rpx; color: #D2760F; margin-top: 12rpx; }
.thr-row { padding: 10rpx 0; border-bottom: 1rpx solid #F4EBDB; }
.thr-row:last-child { border-bottom: 0; }
.thr-top { display: flex; justify-content: space-between; font-size: 24rpx; margin-bottom: 12rpx; }
.thr-top .now { color: #9C8C79; font-size: 22rpx; }
.cur { font-size: 40rpx; font-weight: 600; }
.mb-fill.warn { background: #F79009; }
.mb-fill.gray { background: #CBBAA5; }
.mini-bar { height: 12rpx; border-radius: 999rpx; background: #F4EADA; overflow: hidden; display: flex; }
.empty { padding: 48rpx 0; text-align: center; font-size: 24rpx; color: #9C8C79; }
.btn { height: 92rpx; border-radius: 24rpx; background: #D2760F; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 600; }
.btn.ghost { background: #fff; border: 2rpx solid #F0E4CE; color: #5C4B3A; font-weight: 500; }
.btn.mini { width: 176rpx; flex: 0 0 176rpx; height: 84rpx; font-size: 28rpx; }
.lev-edit-row { display: flex; align-items: center; gap: 20rpx; padding: 14rpx 0; border-bottom: 1rpx solid #F4EBDB; }
.lev-edit-row:last-of-type { border-bottom: 0; }
.lev-edit-row .lev-t { flex: 1; }
.lev-input-box { display: flex; align-items: center; gap: 6rpx; height: 68rpx; padding: 0 18rpx; border-radius: 16rpx; border: 1rpx solid #F0E4CE; background: #FFFCF5; }
.lev-inp { width: 88rpx; text-align: right; font-size: 30rpx; font-weight: 600; color: #2A1D10; }
.lev-unit { font-size: 26rpx; color: #5C4B3A; }
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../../store/app'

const store = useAppStore()
const step = ref(1)
const budget = ref('')
const favIds = ref<string[]>([])
const newCatInput = ref('')
const showingNew = ref(false)
// 告警档位草稿（引导页可直接编辑三档百分比）
const pctDraft = ref<string[]>(store.s.thr.map(l => String(l.pct)))

const canNext = computed(() => parseFloat(budget.value) > 0)

/** 进度条上可显示的刻度（1–100% 范围内） */
const trackPcts = computed(() =>
  pctDraft.value.map(v => parseFloat(v)).filter(v => isFinite(v) && v >= 1 && v <= 100)
)

/** 校验并提交三档百分比：1–200、严格递增；非法则回滚 */
function commitPcts() {
  const arr = pctDraft.value.map((p, i) => ({ pct: parseFloat(p), on: store.s.thr[i]?.on ?? true }))
  const revert = (msg: string) => {
    pctDraft.value = store.s.thr.map(l => String(l.pct))
    uni.showToast({ title: msg, icon: 'none' })
  }
  if (arr.some(x => !isFinite(x.pct))) return revert('请输入百分比数字')
  if (arr.some(x => x.pct < 1 || x.pct > 200)) return revert('百分比需在 1–200 之间')
  if (!(arr[0].pct < arr[1].pct && arr[1].pct < arr[2].pct)) return revert('三档需从低到高递增')
  store.updateLevels(arr)
  pctDraft.value = store.s.thr.map(l => String(l.pct))
}

function toggleCat(id: string) {
  const i = favIds.value.indexOf(id)
  if (i >= 0) favIds.value.splice(i, 1)
  else favIds.value.push(id)
}
function toggleNewCat() {
  showingNew.value = !showingNew.value
  newCatInput.value = ''
}
function addNewCat() {
  const c = store.addCategory(newCatInput.value)
  if (c) {
    favIds.value.push(c.id)
    showingNew.value = false
    newCatInput.value = ''
    uni.showToast({ title: '已添加 ' + c.name, icon: 'none' })
  } else {
    uni.showToast({ title: '请输入分类名称', icon: 'none' })
  }
}
function finish() {
  store.finishOnboarding(parseFloat(budget.value) || null, favIds.value)
  uni.switchTab({ url: '/pages/home/home' })
}
function skip() {
  // 重置后的页面切换可能带入残留点击。跳过必须再次明确确认，
  // 不能因一次穿透 tap 直接写入 onboarded=true 并返回首页。
  uni.showModal({
    title: '跳过初始设置？',
    content: '可以稍后在「阈值与告警」中设置预算，确定返回首页吗？',
    confirmText: '跳过',
    success: (r) => {
      if (!r.confirm) return
      store.skipOnboarding()
      uni.switchTab({ url: '/pages/home/home' })
    }
  })
}

onMounted(() => {
  // 状态可能异步加载完成，进页面时同步一次档位草稿
  pctDraft.value = store.s.thr.map(l => String(l.pct))
})
</script>

<template>
  <view class="page">
    <!-- 状态栏占位 -->
    <view class="sb-space"></view>
    <view v-if="step === 1" class="step">
      <view class="row-between">
        <text class="skip" @tap="skip">跳过</text>
        <text class="step-num">1 / 2</text>
      </view>
      <view class="title">先定一个月度预算</view>
      <view class="sub">我们不预设金额，由你来定每月可花多少。之后可随时在「阈值与告警」里修改。</view>
      <view class="budget-box">
        <text class="cur">¥</text>
        <input class="inp" type="digit" placeholder="请输入金额" v-model="budget" />
        <view class="caret"></view>
      </view>
      <view class="chips">
        <text class="chip" v-for="v in [3000, 5000, 8000]" :key="v" @tap="budget = String(v)">¥{{ v.toLocaleString('zh-CN') }}</text>
      </view>
      <view class="fineprint">不给默认值；上方仅作输入参考。建议从月收入的 30%–50% 起，跑一个月再调。</view>
      <view class="card">
        <view class="row-between">
          <text class="card-title">告警线按比例自动生成</text>
          <text class="more">点数字可改</text>
        </view>
        <view class="track">
          <view class="fill" style="width:0"></view>
          <view
            v-for="(p, i) in trackPcts"
            :key="i"
            class="tick"
            :class="i === 0 ? 't70' : 't90'"
            :style="{ left: p + '%' }"
          ></view>
        </view>
        <view class="thr-edit">
          <view v-for="(d, i) in pctDraft" :key="i" class="thr-item">
            <view class="thr-input">
              <input type="digit" maxlength="3" v-model="pctDraft[i]" @blur="commitPcts" @confirm="commitPcts" />
              <text class="thr-unit">%</text>
            </view>
            <text class="thr-name" :class="i === 0 ? 't70c' : 't90c'">{{ ['提醒', '警告', '超支'][i] }}</text>
          </view>
        </view>
        <view class="fineprint" style="margin-top:12rpx;">三档需从低到高递增，范围 1–200%；可超过 100% 作为超支线。</view>
      </view>
      <view class="btn" :class="{ disabled: !canNext }" @tap="canNext && (step = 2)">下一步</view>
      <view class="btn ghost" @tap="skip">稍后设置，先记一笔</view>
      <view class="fineprint">不填预算也能记账，首页会显示「去设置预算」入口，但不会触发预算类告警。</view>
    </view>

    <view v-else class="step">
      <view class="row-between">
        <text class="back" @tap="step = 1">‹ 上一步</text>
        <text class="step-num">2 / 2</text>
      </view>
      <view class="title">选择常用分类</view>
      <view class="sub">预置 8 类只是起点，随时可以新增、改名或删除。</view>
      <view class="cat-grid">
        <view v-for="c in store.s.cats" :key="c.id" class="cat-cell" :class="{ on: favIds.indexOf(c.id) >= 0 }" @tap="toggleCat(c.id)">
          <view class="ci">{{ c.icon }}</view>
          <text>{{ c.name }}</text>
        </view>
      </view>
      <view v-if="!showingNew" class="add-row" @tap="toggleNewCat">＋ 新建自定义分类</view>
      <view v-else class="card">
        <view class="row-between">
          <text class="card-title">新建分类</text>
          <text class="more" @tap="toggleNewCat">取消</text>
        </view>
        <view class="row-between" style="margin-top:16rpx; gap:16rpx;">
          <input class="inp" placeholder="分类名称，如 宠物" v-model="newCatInput" maxlength="6" />
          <view class="btn mini" @tap="addNewCat">添加</view>
        </view>
      </view>
      <view class="hint-line">已选 {{ favIds.length }} 个分类，记账时会排在最前面。</view>
      <view class="btn" @tap="finish">开始记账</view>
      <view class="fineprint">账单只包含你自己记录或导入的数据；预算可以稍后在设置里调整。</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { min-height: 100vh; padding: 0 32rpx 60rpx; box-sizing: border-box; display: flex; flex-direction: column; padding-top: 24rpx; }
.sb-space { height: var(--status-bar-height, 88rpx); }
/* #ifdef H5 */
/* 浏览器没有状态栏，去掉顶部空白 */
.page { padding-top: 0; }
.sb-space { height: 0; }
/* #endif */
.step { display: flex; flex-direction: column; gap: 20rpx; }
.skip { font-size: 26rpx; color: #5C4B3A; }
.back { font-size: 28rpx; color: #5C4B3A; }
.step-num { font-size: 24rpx; color: #9C8C79; }
.title { font-size: 44rpx; font-weight: 700; letter-spacing: -0.6rpx; line-height: 1.3; margin-top: 16rpx; }
.sub { margin-top: 16rpx; font-size: 24rpx; line-height: 1.6; color: #5C4B3A; }
.budget-box { height: 168rpx; border-radius: 32rpx; background: #FFFCF5; border: 2rpx solid #F0E4CE; display: flex; align-items: center; gap: 16rpx; padding: 0 32rpx; margin-top: 20rpx; }
.budget-box .cur { font-size: 48rpx; font-weight: 600; }
.budget-box .inp { flex: 1; border: 0; background: transparent; outline: none; font-size: 56rpx; font-weight: 600; letter-spacing: -0.6rpx; color: #2A1D10; }
.budget-box .caret { width: 4rpx; height: 64rpx; background: #D2760F; margin-bottom: 10rpx; }
.chips { display: flex; gap: 16rpx; flex-wrap: wrap; }
.chip { height: 64rpx; padding: 0 24rpx; border-radius: 999rpx; background: #FFFCF5; border: 1rpx solid #F0E4CE; font-size: 24rpx; display: inline-flex; align-items: center; color: #5C4B3A; }
.btn { height: 92rpx; border-radius: 24rpx; background: #D2760F; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 600; }
.btn.disabled { background: #D9C9B4; }
.btn.ghost { background: #fff; border: 2rpx solid #F0E4CE; color: #5C4B3A; font-weight: 500; }
.btn.mini { height: 84rpx; flex: 0 0 176rpx; font-size: 28rpx; }
.track { height: 16rpx; border-radius: 999rpx; background: #F4EADA; margin: 24rpx 0 24rpx; position: relative; }
.fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999rpx; background: #D2760F; }
.tick { position: absolute; top: -8rpx; bottom: -8rpx; width: 4rpx; border-radius: 2rpx; }
.t70 { background: #F79009; }
.t90 { background: #E5484D; }
.t70c { color: #B45309; }
.t90c { color: #B42318; }
.thr-edit { display: flex; gap: 16rpx; }
.thr-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.thr-input { display: flex; align-items: center; justify-content: center; gap: 2rpx; height: 72rpx; width: 100%; border-radius: 16rpx; border: 1rpx solid #F0E4CE; background: #FFFCF5; }
.thr-input input { width: 70rpx; text-align: center; font-size: 30rpx; font-weight: 600; color: #2A1D10; }
.thr-unit { font-size: 24rpx; color: #5C4B3A; }
.thr-name { font-size: 22rpx; }
.cat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16rpx; }
.cat-cell { height: 108rpx; border-radius: 20rpx; background: #FFFCF5; border: 1rpx solid #F0E4CE; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8rpx; font-size: 22rpx; color: #5C4B3A; }
.cat-cell.on { background: #FFF2DC; border-color: #F0CF96; color: #8A4A0E; font-weight: 600; }
.cat-cell .ci { width: 44rpx; height: 44rpx; border-radius: 12rpx; background: #F4EBDA; display: flex; align-items: center; justify-content: center; font-size: 22rpx; font-weight: 600; color: #5C4B3A; }
.cat-cell.on .ci { background: #D2760F; color: #fff; }
.add-row { height: 68rpx; border: 2rpx dashed #D9C9B4; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 24rpx; color: #D2760F; margin-top: 12rpx; }
.hint-line { font-size: 22rpx; color: #9C8C79; margin-top: 16rpx; }
.inp { height: 84rpx; border-radius: 20rpx; border: 2rpx solid #F0E4CE; background: #FFFCF5; padding: 0 24rpx; font-size: 28rpx; }
</style>

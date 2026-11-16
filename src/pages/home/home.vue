<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAppStore } from '../../store/app'
import { money, num, srcName, dayLabel, timeLabel } from '../../utils/money'
import type { Category, Record } from '../../utils/threshold'

const store = useAppStore()

// —— 查询 helpers ——
const records = computed(() => store.api.monthRecords())
const catsSorted = computed(() => {
  const map = store.api.catSpendMap()
  const arr = store.s.cats.map(c => ({ cat: c, amt: map[c.id] || 0 })).filter(x => x.amt > 0)
  arr.sort((a, b) => b.amt - a.amt)
  return arr
})
const topCats = computed(() => catsSorted.value.slice(0, 2))
const topRecs = computed(() => records.value.slice().sort((a, b) => b.ts - a.ts).slice(0, 3))

const spent = computed(() => store.api.monthSpent())
const income = computed(() => store.api.monthIncome())

const enabledLevels = computed(() =>
  store.s.thr.filter(x => x.on).map(x => x.pct).sort((a, b) => a - b)
)
// 最低档作为「提醒线」，次低档用于配色
const warnPct = computed(() => enabledLevels.value[0] ?? 70)
const dangerPct = computed(() => enabledLevels.value[1] ?? enabledLevels.value[0] ?? 90)

const budgetInfo = computed(() => {
  const b = store.s.budget
  if (!b) return { has: false } as any
  const pct = spent.value / b * 100
  return {
    has: true, budget: b, spent: spent.value, pct,
    over: spent.value >= b,
    remain: Math.max(b - spent.value, 0),
    cls: pct >= dangerPct.value ? 'danger' : pct >= warnPct.value ? 'warn' : ''
  }
})
const header = `${new Date().getFullYear()}年${new Date().getMonth() + 1}月 · 第 ${new Date().getDate()} 天`

// —— 底部 sheet（记一笔）——
const sheetOpen = ref(false)
const tx = ref<'expense' | 'income'>('expense')
const amount = ref('')
const catId = ref('')
const source = ref<'wx' | 'ali' | 'manual'>('manual')
const note = ref('')
const amtFocus = ref(false)
/** 记账时间：默认当前时间，可手动修改 */
const recDate = ref('')
const recTime = ref('')

function pad2(n: number) { return String(n).padStart(2, '0') }
function resetRecTime() {
  const d = new Date()
  recDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  recTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function onDateChange(e: any) { recDate.value = e.detail.value }
function onTimeChange(e: any) { recTime.value = e.detail.value }

function openAddSheet() {
  const fav = store.api.orderedCats()
  catId.value = fav[0]?.id || store.s.cats[0]?.id || ''
  amount.value = ''
  note.value = ''
  tx.value = 'expense'
  source.value = 'manual'
  amtFocus.value = false
  resetRecTime()
  sheetOpen.value = true
  // sheet 挂载完成后自动聚焦金额输入框，拉起系统数字键盘
  nextTick(() => {
    setTimeout(() => { amtFocus.value = true }, 120)
  })
}

/** 金额输入框：限制数字 + 一位小数点 + 两位小数 + 最多 7 位整数 */
function normalizeAmount() {
  let v = (amount.value || '').replace(/[^\d.]/g, '')
  const parts = v.split('.')
  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('')
  if (parts[1] != null) v = parts[0].slice(0, 7) + '.' + parts[1].slice(0, 2)
  else v = parts[0].slice(0, 7)
  // 前导零：允许 "0" 和 "0."，禁止 "012"
  if (v.length > 1 && v[0] === '0' && v[1] !== '.') v = v.replace(/^0+/, '') || '0'
  amount.value = v
}
function saveRecord() {
  const amt = parseFloat(amount.value)
  if (!(amt > 0)) { uni.showToast({ title: '请输入金额', icon: 'none' }); return }
  // 用本地时间构造，避免字符串解析在不同引擎上出现时区偏差
  const [y, mo, dd] = recDate.value.split('-').map(Number)
  const [hh, mi] = recTime.value.split(':').map(Number)
  const ts = new Date(y, (mo || 1) - 1, dd || 1, hh || 0, mi || 0, 0, 0).getTime()
  if (!Number.isFinite(ts)) { uni.showToast({ title: '时间无效', icon: 'none' }); return }
  const info = store.addRecord({
    amount: Math.round(amt * 100) / 100, catId: catId.value,
    source: source.value, note: note.value.trim(), type: tx.value, ts
  })
  sheetOpen.value = false
  if (info) {
    store.s.lastAlert = info
  } else {
    uni.showToast({ title: '已记一笔 ' + money(amt), icon: 'none' })
  }
}

// —— 路由跳转 ——
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url }) }

onMounted(() => {
  // 唯一的引导入口判断：首页是启动首屏，此时 store 已同步还原完成。
  // 放在页面的 onMounted 而不是 App.onLaunch，是因为 App 端在 onLaunch 里调用
  // reLaunch 时首屏可能还没创建，跳转会失效。
  if (!store.s.onboarded) {
    uni.reLaunch({ url: '/pages/onboard/onboard' })
  }
})


// —— 告警弹窗 ——
const alertVisible = computed(() => !!store.s.lastAlert)
const alertTitle = computed(() => {
  const a = store.s.lastAlert
  if (!a) return ''
  const pct = a.spent / a.limit * 100
  if (pct >= 100) return '已超支'
  if (pct >= 90) return '即将超支'
  return `已用 ${Math.round(pct)}%`
})
const alertSub = computed(() => {
  const a = store.s.lastAlert
  if (!a) return ''
  const pct = a.spent / a.limit * 100
  if (a.scope === 'cat') return `${a.catName || ''} 分类超 ${a.level}% 线`
  if (pct >= 100) return `本月预算已用完`
  return `${a.level}% 档位告警，剩余 ${money(Math.max(a.limit - a.spent, 0))}`
})
function dismissAlert() { store.dismissAlert() }
function adjustFromAlert() {
  store.dismissAlert()
  uni.navigateTo({ url: '/pages/threshold/threshold' })
}</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero-bar">
        <text class="hero-date">{{ header }}</text>
        <text class="hero-nav" @tap="go('/pages/threshold/threshold')">设置</text>
      </view>
      <text class="hero-label">本月支出</text>
      <view class="hero-kpi">
        <text>¥{{ num(budgetInfo.has ? budgetInfo.spent : spent) }}</text>
      </view>
      <view class="hero-sub">
        总预算 {{ budgetInfo.has ? money(budgetInfo.budget) : '未设置' }}
        <text v-if="budgetInfo.has"> · 剩余 {{ money(budgetInfo.remain) }}</text>
      </view>
    </view>

    <view class="card budget" v-if="budgetInfo.has">
      <view class="row-between">
        <text class="card-title">预算使用</text>
        <text class="pct" :class="budgetInfo.cls">{{ budgetInfo.pct.toFixed(1) }}%</text>
      </view>
      <view class="track">
        <view class="fill" :class="{ over: budgetInfo.over }" :style="{ width: Math.min(budgetInfo.pct, 100) + '%' }"></view>
        <view
          v-for="(l, i) in enabledLevels.filter(p => p <= 100)"
          :key="l"
          class="tick"
          :class="i === 0 ? 't70' : 't90'"
          :style="{ left: l + '%' }"
        ></view>
      </view>
      <view class="tick-labels">
        <text>{{ money(budgetInfo.spent) }} / {{ money(budgetInfo.budget) }}</text>
        <text class="warn-fg">{{ budgetInfo.pct >= warnPct ? '已过提醒线' : '距提醒线 ' + money(Math.max(budgetInfo.budget * (warnPct / 100) - budgetInfo.spent, 0)) }}</text>
      </view>
    </view>
    <view class="card budget" v-else>
      <view class="row-between">
        <text class="card-title">还没设置本月预算</text>
        <text class="link" @tap="go('/pages/threshold/threshold')">去设置 ›</text>
      </view>
      <view class="fineprint" style="margin-top:12rpx;">设置后可看到使用进度，并在越线时收到弹窗提醒。</view>
    </view>

    <view class="card">
      <view class="auto-row" @tap="go('/pages/permission/permission')">
        <view class="tile wx">微</view>
        <text class="flex-1 font13">微信支付</text>
        <text class="muted-2">{{ store.s.permission ? '监听中' : '未授权' }}</text>
        <text class="chevron">›</text>
      </view>
      <view class="auto-row" @tap="go('/pages/permission/permission')">
        <view class="tile ali">支</view>
        <text class="flex-1 font13">支付宝</text>
        <text class="muted-2">{{ store.s.permission ? '监听中' : '未授权' }}</text>
        <text class="chevron">›</text>
      </view>
    </view>

    <view class="quick">
      <view class="qbtn" @tap="openAddSheet"><text class="qi">＋</text><text>记一笔</text></view>
      <view class="qbtn" @tap="go('/pages/import/import')"><text class="qi">⬆</text><text>导入账单</text></view>
      <view class="qbtn" @tap="go('/pages/threshold/threshold')"><text class="qi">◉</text><text>阈值设置</text></view>
    </view>

    <view class="card-white">
      <view class="sec-head">
        <text class="card-title">分类支出</text>
        <text class="more" @tap="goTab('/pages/stats/stats')">查看全部 ›</text>
      </view>
      <view v-if="topCats.length">
        <view class="cat-row" v-for="(x, i) in topCats" :key="x.cat.id">
          <text class="cat-name">{{ x.cat.name }}</text>
          <view class="mini-bar"><view class="mb-fill" :class="{ gray: i > 0 }" :style="{ width: Math.max(8, x.amt / topCats[0].amt * 100) + '%' }"></view></view>
          <text class="cat-amt">{{ money(x.amt) }}</text>
        </view>
      </view>
      <view v-else class="empty">本月还没有支出记录</view>
    </view>

    <view class="card-white">
      <view class="sec-head">
        <text class="card-title">最近记录</text>
        <text class="more" @tap="goTab('/pages/list/list')">全部 ›</text>
      </view>
      <view v-if="topRecs.length">
        <view class="list-row" v-for="r in topRecs" :key="r.id" @tap="go('/pages/record/record?id=' + r.id)">
          <view class="tile" :class="r.source">{{ store.catOf(r.catId).icon }}</view>
          <view class="li-main">
            <text class="li-t">{{ r.note || store.catOf(r.catId).name }}</text>
            <text class="li-s">
              <text class="src src-{{ r.source }}">{{ srcName(r.source) }}</text>
              {{ timeLabel(r.ts) }} · {{ store.catOf(r.catId).name }}
            </text>
          </view>
          <text class="li-amt" :class="{ income: r.type === 'income' }">{{ r.type === 'income' ? '+' : '-' }}{{ num(r.amount) }}</text>
        </view>
      </view>
      <view v-else class="empty">点击「记一笔」开始</view>
    </view>

    <!-- 记一笔 modal（上下居中） -->
    <view v-if="sheetOpen" class="overlay mid" @tap.self="sheetOpen = false">
      <view class="sheet">
        <view class="sheet-head">
          <text class="sheet-nav" @tap="sheetOpen = false">取消</text>
          <text class="sheet-title">记一笔</text>
          <view class="sheet-nav sheet-sub"></view>
        </view>
        <view class="seg">
          <text class="seg-btn" :class="{ on: tx === 'expense' }" @tap="tx = 'expense'">支出</text>
          <text class="seg-btn" :class="{ on: tx === 'income' }" @tap="tx = 'income'">收入</text>
        </view>
        <view class="amt-card" @tap="amtFocus = true">
          <text class="cur">¥</text>
          <input
            class="amt-input"
            type="digit"
            :focus="amtFocus"
            v-model="amount"
            placeholder="0.00"
            placeholder-class="amt-ph"
            @input="normalizeAmount"
          />
        </view>
        <view class="sheet-sec">
          <text class="sec-label">分类</text>
          <view class="cat-grid">
            <view v-for="c in store.api.orderedCats()" :key="c.id" class="cat-cell" :class="{ on: catId === c.id }" @tap="catId = c.id">
              <view class="ci">{{ c.icon }}</view>
              <text>{{ c.name }}</text>
            </view>
          </view>
        </view>
        <view class="sheet-sec">
          <text class="sec-label">来源</text>
          <view class="chips">
            <text class="chip" :class="{ on: source === 'wx' }" @tap="source = 'wx'">微信</text>
            <text class="chip" :class="{ on: source === 'ali' }" @tap="source = 'ali'">支付宝</text>
            <text class="chip" :class="{ on: source === 'manual' }" @tap="source = 'manual'">手动</text>
          </view>
        </view>
        <view class="sheet-sec">
          <text class="sec-label">时间</text>
          <view class="time-row">
            <picker mode="date" :value="recDate" @change="onDateChange">
              <view class="time-box">{{ recDate }}</view>
            </picker>
            <picker mode="time" :value="recTime" @change="onTimeChange">
              <view class="time-box">{{ recTime }}</view>
            </picker>
            <text class="time-reset" @tap="resetRecTime">现在</text>
          </view>
        </view>
        <view class="sheet-sec">
          <text class="sec-label">备注</text>
          <input class="inp" placeholder="可空，选填" v-model="note" />
        </view>
        <view class="save-btn" @tap="saveRecord">保存</view>
      </view>
    </view>

    <!-- 告警弹窗 -->
    <view v-if="alertVisible" class="overlay mid" @tap.self="dismissAlert">
      <view class="modal">
        <view class="alarm-ico">⚠</view>
        <text class="m-title">{{ alertTitle }}</text>
        <text class="m-sub">{{ alertSub }}</text>
        <view class="m-amt"><b>{{ money(store.s.lastAlert!.spent) }}</b><text> / {{ money(store.s.lastAlert!.limit) }}</text></view>
        <view class="m-bar">
          <view class="mb-fill" style="width:{{ Math.min(store.s.lastAlert!.spent / store.s.lastAlert!.limit * 100, 100) }}%"></view>
          <view class="tick tk" :style="{ left: store.s.lastAlert!.level + '%' }"></view>
        </view>
        <view class="m-txt">本月支出已用 {{ (store.s.lastAlert!.spent / store.s.lastAlert!.limit * 100).toFixed(1) }}%，越过 {{ store.s.lastAlert!.level }}% 线，距上限还剩 {{ money(Math.max(store.s.lastAlert!.limit - store.s.lastAlert!.spent, 0)) }}。</view>
        <view class="m-btns">
          <view class="btn ghost flex1" @tap="adjustFromAlert">调整预算</view>
          <view class="btn flex1" @tap="dismissAlert">我知道了</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { min-height: 100vh; padding: 0 32rpx 40rpx; box-sizing: border-box; display: flex; flex-direction: column; gap: 16rpx; }
/* #ifdef H5 */
/* 浏览器没有状态栏，扣除 tabBar 高度避免多出一屏空白 */
.page { min-height: calc(100vh - 58px); }
/* #endif */

/* —— 顶部品牌渐变头图（沉浸式延伸到状态栏）—— */
.hero {
  margin: 0 -32rpx;
  padding: calc(var(--status-bar-height, 0px) + 16rpx) 32rpx 72rpx;
  border-radius: 0 0 44rpx 44rpx;
  background: linear-gradient(140deg, #FFF0BE 0%, #FFC93C 46%, #F0A32E 100%);
  box-shadow: 0 14rpx 36rpx rgba(210, 118, 15, 0.20);
  position: relative;
  overflow: hidden;
  z-index: 0;
}
.hero::before,
.hero::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.40);
}
.hero::before { width: 260rpx; height: 260rpx; right: -70rpx; top: -110rpx; }
.hero::after { width: 160rpx; height: 160rpx; right: 90rpx; bottom: -80rpx; background: rgba(255, 255, 255, 0.28); }
.hero-bar { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1; }
.hero-date { font-size: 24rpx; color: rgba(92, 44, 5, 0.72); }
.hero-nav {
  font-size: 22rpx;
  color: #6B3406;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.55);
}
.hero-label { display: block; margin-top: 26rpx; font-size: 24rpx; color: rgba(92, 44, 5, 0.75); position: relative; z-index: 1; }
.hero-kpi { font-size: 68rpx; font-weight: 700; color: #5C2C05; letter-spacing: -1rpx; line-height: 1.2; font-variant-numeric: tabular-nums; position: relative; z-index: 1; }
.hero-sub { font-size: 24rpx; color: rgba(92, 44, 5, 0.80); margin-top: 6rpx; position: relative; z-index: 1; }
.budget { margin-top: -48rpx; position: relative; z-index: 1; }

.track { height: 16rpx; border-radius: 999rpx; background: #F4EADA; position: relative; margin-top: 20rpx; }
.fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999rpx; background: linear-gradient(90deg, #FFC93C, #D2760F); }
.fill.over { background: linear-gradient(90deg, #FBBF24, #F79009); }
.tick { position: absolute; top: -8rpx; bottom: -8rpx; width: 4rpx; border-radius: 2rpx; }
.t70 { background: #F79009; }
.t90 { background: #E5484D; }
.tick-labels { display: flex; justify-content: space-between; font-size: 22rpx; color: #9C8C79; margin-top: 14rpx; }
.warn-fg { color: #B45309; }
.pct { font-size: 26rpx; font-weight: 700; color: #D2760F; }
.pct.warn { color: #B45309; }
.pct.danger { color: #B42318; }
.auto-row { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; border-bottom: 1rpx solid #F8F1E5; }
.auto-row:last-child { border-bottom: 0; }
.tile { width: 68rpx; height: 68rpx; border-radius: 22rpx; background: #F4EBDA; display: flex; align-items: center; justify-content: center; font-size: 26rpx; font-weight: 600; color: #5C4B3A; }
.tile.wx { background: rgba(7, 193, 96, 0.12); color: #07934C; }
.tile.ali { background: rgba(22, 119, 255, 0.12); color: #1463D6; }
.font13 { font-size: 26rpx; }
.flex-1 { flex: 1; }
.muted-2 { font-size: 22rpx; color: #9C8C79; }
.chevron { color: #CBBAA5; }
.quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; }
.time-row { display: flex; align-items: center; gap: 12rpx; }
.time-box {
  height: 68rpx;
  padding: 0 20rpx;
  border-radius: 18rpx;
  background: #FFFCF5;
  border: 1rpx solid #F0E4CE;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: #2A1D10;
  font-variant-numeric: tabular-nums;
}
.time-reset { font-size: 22rpx; color: #D2760F; font-weight: 600; }
.qbtn {
  height: 128rpx;
  border-radius: 28rpx;
  background: #FFFFFF;
  border: 1rpx solid rgba(60, 40, 18, 0.05);
  box-shadow: 0 8rpx 24rpx rgba(60, 40, 18, 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  font-size: 22rpx;
  color: #5C4B3A;
}
.qi {
  width: 52rpx;
  height: 52rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  background: #FFF2DC;
  color: #D2760F;
}
.qbtn:nth-child(2) .qi { background: #F4EBDA; color: #8A4A0E; }
.qbtn:nth-child(3) .qi { background: #FFF4E5; color: #B45309; }
.sec-head { margin-bottom: 10rpx; }
.cat-row { display: flex; align-items: center; gap: 20rpx; padding: 12rpx 0; }
.cat-name { font-size: 24rpx; width: 104rpx; flex: 0 0 104rpx; }
.cat-amt { font-size: 24rpx; color: #5C4B3A; width: 124rpx; text-align: right; font-variant-numeric: tabular-nums; }
.mini-bar { display: flex; flex: 1; height: 10rpx; border-radius: 999rpx; background: #F4EADA; overflow: hidden; }
.mb-fill { height: 100%; border-radius: 999rpx; background: linear-gradient(90deg, #FFC93C, #D2760F); }
.mb-fill.gray { background: #CBBAA5; }
.list-row { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; border-bottom: 1rpx solid #F8F1E5; }
.list-row:last-child { border-bottom: 0; }
.li-main { flex: 1; min-width: 0; }
.li-t { font-size: 26rpx; font-weight: 500; }
.li-s { font-size: 20rpx; color: #9C8C79; margin-top: 6rpx; display: flex; align-items: center; gap: 8rpx; }
.li-amt { font-size: 28rpx; font-weight: 600; font-variant-numeric: tabular-nums; }
.li-amt.income { color: #1E9D63; }
.src { padding: 2rpx 12rpx; border-radius: 10rpx; font-size: 20rpx; font-weight: 600; }
.src-wx { background: rgba(7, 193, 96, 0.10); color: #07934C; }
.src-ali { background: rgba(22, 119, 255, 0.10); color: #1463D6; }
.src-manual { background: #F4EADA; color: #7A6956; }
.empty { padding: 40rpx 0; text-align: center; font-size: 24rpx; color: #9C8C79; }
.inp { height: 64rpx; border-radius: 20rpx; border: 1rpx solid #F0E4CE; background: #FFFCF5; padding: 0 20rpx; font-size: 22rpx; }

/* Sheet（居中 modal 样式） */
.overlay { position: fixed; inset: 0; z-index: 50; }
.overlay.mid { display: flex; align-items: center; justify-content: center; padding: 0 40rpx; }
.overlay::before { content: ''; position: absolute; inset: 0; background: rgba(60,40,18,.44); }
.sheet {
  position: relative; background: #fff;
  width: 100%; max-width: 680rpx;
  border-radius: 36rpx;
  padding: 26rpx 24rpx 24rpx;
  display: flex; flex-direction: column; gap: 12rpx;
  max-height: 88vh; overflow-y: auto;
  box-shadow: 0 32rpx 80rpx rgba(60,40,18,.20);
}
.sheet-head { display: flex; justify-content: space-between; align-items: center; height: 52rpx; padding-bottom: 2rpx; }
.sheet-nav { font-size: 24rpx; color: #5C4B3A; }
.sheet-nav.sheet-sub { width: 60rpx; } /* 占位宽度，让标题真正居中 */
.sheet-title { font-size: 28rpx; font-weight: 600; }

.seg { display: flex; background: #F4EADA; border-radius: 20rpx; padding: 6rpx; gap: 8rpx; }
.seg-btn { flex: 1; height: 52rpx; border-radius: 16rpx; display: flex; align-items: center; justify-content: center; font-size: 24rpx; color: #5C4B3A; transition: all .15s; }
.seg-btn.on { background: #fff; color: #D2760F; font-weight: 600; box-shadow: 0 4rpx 12rpx rgba(210,118,15,.12); }

.amt-card {
  background: linear-gradient(140deg, #FFF0BE 0%, #FFC93C 55%, #F0A32E 100%);
  border-radius: 28rpx;
  padding: 20rpx 24rpx;
  display: flex; align-items: center; gap: 12rpx;
  box-shadow: 0 12rpx 28rpx rgba(210,118,15,.20);
  color: #5C2C05;
}
.amt-card .cur { font-size: 40rpx; font-weight: 600; opacity: .9; padding-bottom: 4rpx; }
.amt-input {
  flex: 1;
  font-size: 64rpx; font-weight: 700; letter-spacing: -2rpx; font-variant-numeric: tabular-nums;
  color: #5C2C05; background: transparent; border: 0; padding: 0; line-height: 1;
  caret-color: #5C2C05;
}
.amt-ph { color: rgba(92,44,5,.45); font-size: 52rpx; font-weight: 600; }
@keyframes blink { 50% { opacity: 0 } }

.sheet-sec {
  background: #FFFCF5;
  border-radius: 24rpx;
  padding: 12rpx 16rpx;
  display: flex; flex-direction: column; gap: 10rpx;
}
.sec-label { font-size: 20rpx; color: #9C8C79; font-weight: 500; }

.cat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10rpx; }
.cat-cell {
  height: 112rpx; border-radius: 20rpx; background: #fff; border: 1rpx solid #E5E7EB;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6rpx;
  font-size: 20rpx; color: #5C4B3A; transition: all .15s;
}
.cat-cell.on { background: #FFF2DC; border-color: #D2760F; color: #8A4A0E; font-weight: 600; }
.cat-cell .ci {
  width: 46rpx; height: 46rpx; border-radius: 14rpx; background: #F4EADA;
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx; font-weight: 700; color: #5C4B3A;
}
.cat-cell.on .ci { background: #D2760F; color: #fff; }

.chips { display: flex; gap: 12rpx; flex-wrap: wrap; }
.chip {
  padding: 8rpx 24rpx; border-radius: 999rpx;
  background: #fff; border: 1rpx solid #E5E7EB;
  font-size: 22rpx; color: #5C4B3A;
}
.chip.on { background: #D2760F; border-color: #D2760F; color: #fff; font-weight: 600; }

.save-btn {
  width: 100%;
  height: 128rpx;
  flex-shrink: 0;
  border-radius: 28rpx;
  background: linear-gradient(140deg, #F7A62B 0%, #D2760F 60%, #9C5208 100%);
  color: #fff;
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 28rpx rgba(210,118,15,.28);
}
.save-btn:active { opacity: .92; transform: translateY(2rpx); }

/* Alert modal */
.modal { position: relative; background: #fff; border-radius: 40rpx; padding: 44rpx 40rpx 36rpx; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.alarm-ico { width: 92rpx; height: 92rpx; border-radius: 50%; background: #FEF4E6; display: flex; align-items: center; justify-content: center; font-size: 44rpx; color: #F79009; }
.m-title { font-size: 34rpx; font-weight: 600; text-align: center; margin-top: 8rpx; }
.m-sub { font-size: 22rpx; color: #9C8C79; }
.m-amt { display: flex; align-items: baseline; gap: 12rpx; margin: 24rpx 0 4rpx; }
.m-amt b { font-size: 56rpx; font-weight: 700; letter-spacing: -1rpx; }
.m-amt text { font-size: 24rpx; color: #9C8C79; }
.m-bar { height: 14rpx; border-radius: 999rpx; background: #F4EADA; margin: 20rpx 0; position: relative; width: 100%; }
.tick.tk { position: absolute; top: -6rpx; bottom: -6rpx; width: 4rpx; background: #E5484D; }
.m-txt { font-size: 24rpx; line-height: 1.7; color: #5C4B3A; text-align: center; }
.m-btns { display: flex; gap: 20rpx; margin-top: 24rpx; width: 100%; }
.flex1 { flex: 1; }
</style>

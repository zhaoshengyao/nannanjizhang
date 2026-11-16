<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { money } from '../../utils/money'
import { buildExportCsv } from '../../utils/csv'
import { saveCsvFile } from '../../utils/file'

const store = useAppStore()
const exporting = ref(false)

/** 昵称编辑弹层 */
const editingName = ref(false)
const draftName = ref('')

/** 头像文件失效时仅做显示降级，不清空用户设置，避免误删 */
const avatarBroken = ref(false)
watch(() => store.s.avatar, () => { avatarBroken.value = false })

/** 选择头像：相册或拍照 */
function chooseAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res: any) => {
      const temp = Array.isArray(res?.tempFilePaths) ? res.tempFilePaths[0] : ''
      if (temp) saveAvatar(temp)
    }
  })
}

/** 临时文件会被系统清理，App 端另存到应用目录再记录路径 */
function saveAvatar(temp: string) {
  const old = store.s.avatar
  const apply = (p: string) => {
    store.setAvatar(p)
    // 换头像后删掉旧文件，避免应用目录里堆积无用图片
    if (old && old !== p) {
      try { uni.removeSavedFile({ filePath: old, fail: () => {} }) } catch (e) {}
    }
  }
  // #ifdef APP-PLUS
  try {
    uni.saveFile({
      tempFilePath: temp,
      success: (r: any) => apply(r.savedFilePath || temp),
      fail: () => apply(temp)
    })
  } catch (e) {
    apply(temp)
  }
  // #endif
  // #ifndef APP-PLUS
  apply(temp)
  // #endif
}

function editName() {
  draftName.value = store.s.name
  editingName.value = true
}

function confirmName() {
  const n = draftName.value.trim()
  if (!n) {
    uni.showToast({ title: '名称不能为空', icon: 'none' })
    return
  }
  store.setName(n)
  editingName.value = false
}

function menu(t: string, v: string, r: string, icon: string, tone: string) {
  const tap = () => uni.navigateTo({ url: r })
  return { t, v, icon, tone, tap }
}

const items = computed(() => [
  menu('阈值与告警', store.s.budget ? money(store.s.budget) : '未设置', '/pages/threshold/threshold', '🎯', 'green'),
  menu('分类管理', store.s.cats.length + ' 类', '/pages/categories/categories', '🏷', 'blue'),
  menu('自动记账', store.s.permission ? '监听中' : '未授权', '/pages/permission/permission', '🔔', 'amber'),
  menu('导入账单', store.s.importStats ? '上次新增 ' + store.s.importStats.added + ' 笔' : '未导入', '/pages/import/import', '📥', 'violet')
])

/** 导出全部账单为 CSV（微信/支付宝/Excel 均可打开） */
async function exportCsv() {
  if (!store.s.records.length) {
    uni.showToast({ title: '还没有账单可导出', icon: 'none' })
    return
  }
  if (exporting.value) return
  exporting.value = true
  try {
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const name = `楠楠记账本-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${store.s.records.length}笔.csv`
    const where = await saveCsvFile(name, buildExportCsv(store.s.records, id => store.catOf(id).name))
    if (!where) throw new Error('文件保存失败')
    uni.showModal({ title: '导出成功', content: `${where}\n共 ${store.s.records.length} 笔账单`, showCancel: false, confirmText: '知道了' })
  } catch (e: any) {
    uni.showModal({
      title: '导出失败',
      content: `文件保存失败：${String(e?.message || e || '未知错误')}`,
      showCancel: false,
      confirmText: '知道了'
    })
  } finally {
    exporting.value = false
  }
}

function clearBills() {
  if (!store.s.records.length) {
    uni.showToast({ title: '当前没有账单', icon: 'none' })
    return
  }
  uni.showModal({
    title: '清空全部账单？',
    content: `共 ${store.s.records.length} 笔，清空后不可恢复。预算、分类和告警设置会保留。`,
    confirmText: '清空',
    confirmColor: '#D92D20',
    success: (r) => {
      if (!r.confirm) return
      store.clearRecords()
      uni.showToast({ title: '已清空账单', icon: 'none' })
    }
  })
}

function resetAll() {
  uni.showModal({
    title: '恢复初始状态？',
    content: '会清空账单、预算、分类与告警设置，回到首次启动流程。',
    confirmText: '重置',
    confirmColor: '#D92D20',
    success: (r) => {
      if (!r.confirm) return
      store.resetAll()
      uni.reLaunch({ url: '/pages/onboard/onboard' })
    }
  })
}

</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-spacer"></text>
      <text class="top-title">我的</text>
      <text class="top-spacer"></text>
    </view>
    <view class="hero">
      <view class="pf">
        <image class="avatar" :src="(!avatarBroken && store.s.avatar) || '/static/logo.jpg'" mode="aspectFill"
          @tap="chooseAvatar" @error="avatarBroken = true" />
        <view class="pf-main" @tap="editName">
          <view class="pf-name-row">
            <text class="pf-name">{{ store.s.name }}</text>
            <text class="pf-edit">✎</text>
          </view>
          <text class="pf-sub">记录 {{ store.api.monthRecords().length }} 笔 · 分类 {{ store.s.cats.length }} 个</text>
        </view>
        <view class="pf-chip" :class="{ on: store.s.permission }">{{ store.s.permission ? '自动记账中' : '监听未开启' }}</view>
      </view>
      <view class="pf-spend">
        <text class="pf-spend-label">本月支出</text>
        <text class="pf-spend-val">{{ money(store.api.monthSpent()) }}</text>
      </view>
    </view>
    <view class="card">
      <view class="menu-row" v-for="m in items" :key="m.t" @tap="m.tap">
        <view class="menu-ico" :class="m.tone">{{ m.icon }}</view>
        <text class="menu-t">{{ m.t }}</text>
        <text class="menu-v">{{ m.v }}</text>
        <text class="chevron">›</text>
      </view>
    </view>
    <view class="card">
      <view class="row-between">
        <text class="card-title">数据管理</text>
        <text class="more">{{ store.s.records.length }} 笔账单</text>
      </view>
      <view class="menu-row" @tap="exportCsv">
        <view class="menu-ico blue">⤓</view>
        <text class="menu-t">{{ exporting ? '正在导出…' : '导出账单 CSV' }}</text>
        <text class="menu-v">备份 / Excel</text>
        <text class="chevron">›</text>
      </view>
      <view class="menu-row" @tap="clearBills">
        <view class="menu-ico gray">⌫</view>
        <text class="menu-t">清空全部账单</text>
        <text class="menu-v">保留设置</text>
        <text class="chevron">›</text>
      </view>
      <view class="menu-row" @tap="resetAll">
        <view class="menu-ico amber">⟲</view>
        <text class="menu-t">恢复初始状态</text>
        <text class="menu-v">全部重置</text>
        <text class="chevron">›</text>
      </view>
    </view>

    <!-- 修改昵称 -->
    <view v-if="editingName" class="mask" @tap="editingName = false">
      <view class="dialog" @tap.stop>
        <text class="dlg-title">修改名称</text>
        <input class="dlg-input" v-model="draftName" :focus="editingName" maxlength="12"
          placeholder="最多 12 个字" confirm-type="done" @confirm="confirmName" />
        <view class="dlg-actions">
          <text class="dlg-btn" @tap="editingName = false">取消</text>
          <text class="dlg-btn primary" @tap="confirmName">保存</text>
        </view>
      </view>
    </view>
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
  padding: 32rpx;
  color: #5C2C05;
  box-shadow: 0 14rpx 36rpx rgba(210,118,15,.20);
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  width: 260rpx; height: 260rpx;
  right: -90rpx; top: -130rpx;
  border-radius: 50%;
  background: rgba(255,255,255,.45);
}
.pf { display: flex; align-items: center; gap: 20rpx; position: relative; z-index: 1; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 50%; background: #FFFFFF; box-shadow: 0 6rpx 18rpx rgba(0,0,0,.12); }
.pf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.pf-name-row { display: flex; align-items: center; gap: 10rpx; }
.pf-name { font-size: 34rpx; font-weight: 700; }
.pf-edit { font-size: 22rpx; color: rgba(92,44,5,.55); }
.pf-sub { font-size: 22rpx; color: rgba(92,44,5,.72); }
.pf-chip { font-size: 20rpx; padding: 6rpx 16rpx; border-radius: 999rpx; background: rgba(255,255,255,.55); color: #6B3406; }
.pf-chip.on { background: rgba(255,255,255,.92); color: #A55A08; font-weight: 600; }
.pf-spend { display: flex; align-items: baseline; gap: 14rpx; margin-top: 28rpx; padding-top: 24rpx; border-top: 1rpx solid rgba(92,44,5,.22); position: relative; z-index: 1; }
.pf-spend-label { font-size: 22rpx; color: rgba(92,44,5,.72); }
.pf-spend-val { font-size: 48rpx; font-weight: 700; letter-spacing: -1rpx; font-variant-numeric: tabular-nums; }
.menu-row { display: flex; align-items: center; gap: 20rpx; padding: 22rpx 0; border-bottom: 1rpx solid #F8F1E5; }
.menu-row:last-child { border-bottom: 0; }
.menu-ico { width: 64rpx; height: 64rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 30rpx; flex: 0 0 64rpx; }
.menu-ico.green { background: #FFEFD2; }
.menu-ico.blue { background: #F6EDDE; }
.menu-ico.amber { background: #FFF4E5; }
.menu-ico.violet { background: #F2E8DC; }
.menu-ico.gray { background: #F4EBDB; }
.menu-t { font-size: 26rpx; font-weight: 500; flex: 1; }
.menu-v { font-size: 22rpx; color: #9C8C79; }
.chevron { color: #CBBAA5; }
.mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(30,20,8,.42); display: flex; align-items: center; justify-content: center; z-index: 99; }
.dialog { width: 560rpx; background: #FFFFFF; border-radius: 28rpx; padding: 36rpx 32rpx 24rpx; box-shadow: 0 20rpx 60rpx rgba(60,40,18,.25); }
.dlg-title { display: block; font-size: 30rpx; font-weight: 600; text-align: center; }
.dlg-input { margin-top: 28rpx; height: 84rpx; padding: 0 24rpx; border-radius: 18rpx; background: #FDF7EC; border: 1rpx solid #F0E4CE; font-size: 28rpx; }
.dlg-actions { display: flex; gap: 20rpx; margin-top: 28rpx; }
.dlg-btn { flex: 1; height: 80rpx; border-radius: 18rpx; display: flex; align-items: center; justify-content: center; font-size: 28rpx; color: #5C4B3A; background: #F7F1E6; }
.dlg-btn.primary { background: #D2760F; color: #FFFFFF; font-weight: 600; }
</style>

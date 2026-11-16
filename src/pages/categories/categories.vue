<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '../../store/app'

const store = useAppStore()
const editor = ref(false)
const newName = ref('')

function add() {
  const c = store.addCategory(newName.value)
  if (c) { editor.value = false; newName.value = ''; uni.showToast({ title: '已添加', icon: 'none' }) }
  else uni.showToast({ title: '请输入分类名称', icon: 'none' })
}
function del(id: string) {
  if (!store.deleteCategory(id)) {
    uni.showToast({ title: '已有账单，不能删除', icon: 'none' })
    return
  }
  uni.showToast({ title: '已删除', icon: 'none' })
}
</script>

<template>
  <view class="page">
    <view class="sb-space"></view>
    <view class="top-bar">
      <text class="top-nav" @tap="uni.navigateBack()">‹ 返回</text>
      <text class="top-title">分类管理</text>
      <text class="top-spacer"></text>
    </view>
    <view class="card">
      <view class="list-row" v-for="c in store.s.cats" :key="c.id">
        <view class="tile">{{ c.icon }}</view>
        <view class="li-main">
          <text class="li-t">{{ c.name }}</text>
          <text class="li-s">{{ store.s.records.filter(r => r.catId === c.id).length }} 笔记录</text>
        </view>
        <text class="link del" @tap="del(c.id)">删除</text>
      </view>
    </view>
    <view v-if="!editor" class="add-row" @tap="editor = true">＋ 新建分类</view>
    <view v-else class="card">
      <view class="row-between">
        <text class="card-title">新建分类</text>
        <text class="more" @tap="editor = false">取消</text>
      </view>
      <view class="row-between" style="margin-top:16rpx;gap:16rpx;">
        <input class="inp" placeholder="分类名称，如 宠物" v-model="newName" maxlength="6" />
        <view class="btn mini" @tap="add">添加</view>
      </view>
    </view>
    <view class="fineprint">已产生账单的分类不能直接删除，先把记录改到其他分类。</view>
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
.list-row { display: flex; align-items: center; gap: 20rpx; padding: 22rpx 0; border-bottom: 1rpx solid #F4EBDB; }
.list-row:last-child { border-bottom: 0; }
.tile { width: 68rpx; height: 68rpx; border-radius: 22rpx; background: #F4EBDA; display: flex; align-items: center; justify-content: center; font-size: 26rpx; font-weight: 600; flex: 0 0 68rpx; }
.li-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.li-t { font-size: 26rpx; font-weight: 500; }
.li-s { font-size: 22rpx; color: #9C8C79; margin-top: 0; }
.add-row { height: 84rpx; border: 2rpx dashed #F0CF96; border-radius: 24rpx; background: #FFF9EC; display: flex; align-items: center; justify-content: center; font-size: 26rpx; font-weight: 600; color: #D2760F; }
.btn.mini { width: 176rpx; flex: 0 0 176rpx; height: 84rpx; font-size: 28rpx; }
.del { color: #D92D20; }
</style>

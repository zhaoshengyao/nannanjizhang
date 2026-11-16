<script setup lang="ts">
import { computed } from 'vue'
import { monthKey, monthLabel, shiftMonth } from '../../utils/money'

const props = defineProps<{ model: string }>()
const emit = defineEmits<{ (e: 'update:model', v: string): void }>()

const label = computed(() => monthLabel(props.model))
const canNext = computed(() => props.model < monthKey())

function go(delta: number) {
  if (delta > 0 && !canNext.value) return
  emit('update:model', shiftMonth(props.model, delta))
}
</script>

<template>
  <view class="mb">
    <text class="arr" @tap="go(-1)">‹</text>
    <text class="lab">{{ label }}</text>
    <text class="arr" :class="{ off: !canNext }" @tap="go(1)">›</text>
  </view>
</template>

<style lang="scss" scoped>
.mb { display: flex; align-items: center; justify-content: center; gap: 24rpx; }
.arr { width: 56rpx; height: 56rpx; line-height: 56rpx; text-align: center; border-radius: 50%; background: #FFFFFF; color: #5C4B3A; font-size: 30rpx; box-shadow: 0 6rpx 16rpx rgba(60,40,18,.06); }
.arr.off { color: #D9C9B4; }
.lab { font-size: 28rpx; font-weight: 600; min-width: 200rpx; text-align: center; }
</style>

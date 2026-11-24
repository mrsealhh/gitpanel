<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { MenuItem } from '../types/ui'

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'close'): void }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ x: props.x, y: props.y })

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  // 贴边修正，避免菜单超出视口
  const w = 220
  const h = props.items.length * 28 + 16
  pos.value = {
    x: Math.min(props.x, window.innerWidth - w - 8),
    y: Math.min(props.y, window.innerHeight - h - 8),
  }
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0)
})

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div
    ref="el"
    class="modal animate-pop fixed z-50 w-[220px] overflow-hidden py-1"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
  >
    <template v-for="item in items" :key="item.id">
      <div v-if="item.divider" class="my-1 h-px" :style="{ background: 'var(--border)' }" />
      <button
        v-else
        class="flex w-full items-center gap-2 px-3 py-[5px] text-left text-[12px] transition-colors"
        :style="{ color: item.danger ? '#f87171' : 'var(--text)' }"
        @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--hover)'"
        @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
        @click="emit('select', item.id)"
      >
        <span class="truncate">{{ item.label }}</span>
        <span v-if="item.hint" class="ml-auto shrink-0 font-mono text-[10px] t3">{{ item.hint }}</span>
      </button>
    </template>
  </div>
</template>

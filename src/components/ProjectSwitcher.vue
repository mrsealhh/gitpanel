<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import Icon from './Icon.vue'

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'rename', path: string): void
  (e: 'clone'): void
  (e: 'browse'): void
}>()

const repo = useRepoStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const current = computed(() => {
  const path = repo.info?.path
  const hit = repo.recents.find((r) => r.path === path)
  return hit?.alias || hit?.name || repo.info?.name || '未打开项目'
})

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button class="btn flex max-w-[190px] items-center gap-1" :title="repo.info?.path || '选择项目'" @click="open = !open">
      <Icon name="folder" :size="13" class="shrink-0" />
      <span class="truncate">{{ current }}</span>
      <span class="shrink-0 text-[9px] t3">▾</span>
    </button>

    <div
      v-if="open"
      class="modal animate-pop absolute left-0 top-[calc(100%+4px)] z-50 w-[320px] overflow-hidden py-1"
    >
      <div class="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wider t3">项目（{{ repo.recents.length }}）</div>
      <div class="max-h-[46vh] overflow-y-auto">
        <div
          v-for="r in repo.recents"
          :key="r.path"
          class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-1.5"
          @click="emit('open', r.path); open = false"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12px]" :style="{ color: r.path === repo.info?.path ? 'var(--accent)' : 'var(--text)' }">
              {{ r.alias || r.name }}
            </span>
            <span class="block truncate font-mono text-[10px] t3">{{ r.path }}</span>
          </span>
          <button
            class="shrink-0 text-[10px] t3 opacity-0 hover:opacity-100 group-hover:opacity-100"
            title="重命名"
            @click.stop="emit('rename', r.path); open = false"
          >
            改名
          </button>
        </div>
        <div v-if="!repo.recents.length" class="px-3 py-2 text-[11px] t3">还没有记录</div>
      </div>

      <div class="line-t mt-1 flex gap-1 px-2 pt-2">
        <button class="btn flex-1 px-2 py-1 text-[11px]" @click="emit('browse'); open = false">打开文件夹…</button>
        <button class="btn flex-1 px-2 py-1 text-[11px]" @click="emit('clone'); open = false">克隆仓库…</button>
      </div>
    </div>
  </div>
</template>

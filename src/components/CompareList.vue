<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'

const repo = useRepoStore()

const activeFile = computed(
  () =>
    repo.diffTabs.find((t) => `d:${t.key}` === repo.activeTab && t.kind === 'compare')?.file ?? '',
)

function statusColor(s: string) {
  if (s === 'A') return 'var(--badge-head-fg)'
  if (s === 'D') return '#f87171'
  if (s === 'R' || s === 'C') return '#fb923c'
  return 'var(--accent)'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" :style="{ background: 'var(--bg)' }">
    <div class="line-b flex h-9 shrink-0 items-center gap-2 px-3 text-[11px]" :style="{ background: 'var(--panel)' }">
      <span class="shrink-0" :style="{ color: 'var(--accent)' }">对比</span>
      <span class="shrink-0 font-mono t2">{{ repo.compareA.slice(0, 7) }}</span>
      <span class="shrink-0 t3">↔</span>
      <span class="shrink-0 font-mono t2">{{ repo.compareB.slice(0, 7) }}</span>
      <span class="shrink-0 t3">{{ repo.compareFiles.length }} 个文件</span>
      <button class="btn ml-auto shrink-0 px-2 py-0 text-[10px]" @click="repo.closeCompare()">关闭对比 (Esc)</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="f in repo.compareFiles"
        :key="f.path"
        class="flex w-full items-center gap-2 px-3 py-[4px] text-left text-[12px] row-hover"
        :style="activeFile === f.path ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
        @click="repo.openCompareFile(f.path)"
      >
        <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
        <span class="min-w-0 flex-1 truncate font-mono">{{ f.path }}</span>
      </button>
      <div v-if="!repo.compareFiles.length" class="p-3 text-[12px] t3">这两个提交之间没有文件差异</div>
    </div>
  </div>
</template>

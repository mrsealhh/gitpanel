<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'

const repo = useRepoStore()

const lines = computed(() => (repo.stashDiff?.patch || '').split('\n'))

function lineClass(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return { color: 'var(--text-mute)' }
  if (line.startsWith('+')) return { color: 'var(--badge-head-fg)', background: 'var(--diff-insert)' }
  if (line.startsWith('-')) return { color: '#f87171', background: 'var(--diff-delete)' }
  if (line.startsWith('@@')) return { color: 'var(--accent)' }
  if (line.startsWith('diff ') || line.startsWith('index ')) return { color: 'var(--text-mute)' }
  return { color: 'var(--text-dim)' }
}
</script>

<template>
  <div v-if="repo.stashDiff" class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="repo.closeStashDiff()">
    <div class="modal animate-pop flex max-h-[80vh] w-[860px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">暂存内容</span>
        <span class="font-mono text-[11px] t3">{{ repo.stashDiff.ref }}</span>
        <span class="text-[11px] t3">{{ repo.stashDiff.files.length }} 个文件</span>
        <button class="btn ml-auto" @click="repo.closeStashDiff()">关闭</button>
      </header>

      <div class="line-b flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 text-[11px] t3">
        <span v-for="f in repo.stashDiff.files" :key="f.path" class="font-mono">
          {{ f.path }}
          <span style="color: var(--badge-head-fg)">+{{ f.additions }}</span>
          <span style="color: #f87171">-{{ f.deletions }}</span>
        </span>
      </div>

      <pre
        class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed"
        :style="{ background: 'var(--panel-2)' }"
      ><div v-for="(l, i) in lines" :key="i" :style="lineClass(l)">{{ l || ' ' }}</div></pre>
    </div>
  </div>
</template>

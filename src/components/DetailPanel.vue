<script setup lang="ts">
import type { CommitDetail } from '../api/types'
import { formatDate } from '../utils/time'

defineProps<{
  detail: CommitDetail | null
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-file', file: string): void
  (e: 'file-context', payload: { file: string; x: number; y: number }): void
}>()

function onCtx(e: MouseEvent, file: string) {
  e.preventDefault()
  emit('file-context', { file, x: e.clientX, y: e.clientY })
}

function statusColor(s: string) {
  if (s === 'A') return 'var(--badge-head-fg)'
  if (s === 'D') return '#f87171'
  return 'var(--text-dim)'
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col" :style="{ background: 'var(--panel)' }">
    <div v-if="loading" class="p-4 text-sm t3">加载提交详情…</div>
    <div v-else-if="!detail" class="p-4 text-sm t3">选择一条提交查看详情</div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="line-b p-4">
        <div class="mb-2 flex items-center gap-2">
          <span class="rounded px-1.5 py-0.5 font-mono text-[11px] t3" :style="{ background: 'var(--panel-3)' }">{{ detail.short }}</span>
          <span class="text-[11px] t3">{{ formatDate(detail.time) }}</span>
        </div>
        <h2 class="text-[15px] font-semibold leading-snug t1">{{ detail.summary }}</h2>
        <p v-if="detail.body" class="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed t2">
          {{ detail.body }}
        </p>
        <div class="mt-3 flex items-center gap-2 text-[12px] t2">
          <div class="flex h-6 w-6 items-center justify-center rounded-full text-[11px]" :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }">
            {{ detail.author.slice(0, 1) }}
          </div>
          <span>{{ detail.author }}</span>
          <span class="truncate t3">&lt;{{ detail.email }}&gt;</span>
        </div>
        <div v-if="detail.parents.length" class="mt-2 text-[11px] t3">
          父提交：<span class="font-mono">{{ detail.parents.map((p) => p.slice(0, 7)).join(', ') }}</span>
        </div>
      </div>

      <div class="line-b flex items-center justify-between px-4 py-2 text-[11px] t3">
        <span>{{ detail.files.length }} 个文件变更</span>
        <span>
          <span style="color: var(--badge-head-fg)">+{{ detail.additions }}</span>
          <span class="mx-1 opacity-50">/</span>
          <span class="text-rose-400">-{{ detail.deletions }}</span>
        </span>
      </div>

      <ul class="py-1">
        <li
          v-for="f in detail.files"
          :key="f.path"
          class="row-hover flex cursor-pointer items-center gap-2 px-4 py-[5px] text-[12px]"
          @click="emit('open-file', f.path)"
          @contextmenu="onCtx($event, f.path)"
        >
          <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
          <span class="min-w-0 flex-1 truncate font-mono t2">{{ f.path }}</span>
          <span class="shrink-0" style="color: var(--badge-head-fg)">+{{ f.additions }}</span>
          <span class="shrink-0 text-rose-400">-{{ f.deletions }}</span>
        </li>
      </ul>
    </div>
  </aside>
</template>

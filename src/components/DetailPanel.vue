<script setup lang="ts">
import type { CommitDetail } from '../api/types'
import { formatDate } from '../utils/time'

defineProps<{
  detail: CommitDetail | null
  loading?: boolean
}>()

const emit = defineEmits<{ (e: 'open-file', file: string): void }>()

function statusColor(p: string) {
  return p.includes('新增') ? 'text-emerald-400' : 'text-slate-400'
}
</script>

<template>
  <aside class="flex h-full w-[340px] shrink-0 flex-col border-l border-white/5 bg-[#12151d]">
    <div v-if="loading" class="p-4 text-sm text-slate-500">加载提交详情…</div>
    <div v-else-if="!detail" class="p-4 text-sm text-slate-600">选择一条提交查看详情</div>
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-white/5 p-4">
        <div class="mb-2 flex items-center gap-2">
          <span class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">{{ detail.short }}</span>
          <span class="text-[11px] text-slate-500">{{ formatDate(detail.time) }}</span>
        </div>
        <h2 class="text-[15px] font-semibold leading-snug text-slate-100">{{ detail.summary }}</h2>
        <p v-if="detail.body" class="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-400">
          {{ detail.body }}
        </p>
        <div class="mt-3 flex items-center gap-2 text-[12px] text-slate-400">
          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/20 text-[11px] text-sky-300">
            {{ detail.author.slice(0, 1) }}
          </div>
          <span>{{ detail.author }}</span>
          <span class="text-slate-600">&lt;{{ detail.email }}&gt;</span>
        </div>
        <div v-if="detail.parents.length" class="mt-2 text-[11px] text-slate-500">
          父提交：<span class="font-mono">{{ detail.parents.map((p) => p.slice(0, 7)).join(', ') }}</span>
        </div>
      </div>

      <div class="flex items-center justify-between border-b border-white/5 px-4 py-2 text-[11px] text-slate-500">
        <span>{{ detail.files.length }} 个文件变更</span>
        <span>
          <span class="text-emerald-400">+{{ detail.additions }}</span>
          <span class="mx-1 text-slate-600">/</span>
          <span class="text-rose-400">-{{ detail.deletions }}</span>
        </span>
      </div>

      <ul class="min-h-0 flex-1 overflow-y-auto py-1">
        <li
          v-for="f in detail.files"
          :key="f.path"
          class="flex cursor-pointer items-center gap-2 px-4 py-[5px] text-[12px] hover:bg-white/[0.05]"
          @click="emit('open-file', f.path)"
        >
          <span class="min-w-0 flex-1 truncate font-mono" :class="statusColor(f.status)">{{ f.path }}</span>
          <span class="shrink-0 text-emerald-400">+{{ f.additions }}</span>
          <span class="shrink-0 text-rose-400">-{{ f.deletions }}</span>
        </li>
      </ul>
    </div>
  </aside>
</template>

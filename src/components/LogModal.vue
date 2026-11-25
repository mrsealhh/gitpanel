<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { formatDate } from '../utils/time'
import { copyText } from '../lib/clipboard'

const emit = defineEmits<{ (e: 'close'): void }>()
const repo = useRepoStore()

const filter = ref<'all' | 'err'>('all')
const opened = ref<Set<number>>(new Set())

const list = computed(() =>
  filter.value === 'err' ? repo.logs.filter((l) => l.kind === 'err') : repo.logs,
)
const errCount = computed(() => repo.logs.filter((l) => l.kind === 'err').length)

function toggle(time: number) {
  const next = new Set(opened.value)
  if (next.has(time)) next.delete(time)
  else next.add(time)
  opened.value = next
}

function kindColor(kind: string) {
  if (kind === 'err') return '#f87171'
  if (kind === 'ok') return 'var(--badge-head-fg)'
  return 'var(--text-mute)'
}

function kindLabel(kind: string) {
  if (kind === 'err') return '错误'
  if (kind === 'ok') return '完成'
  return '提示'
}

async function copyOne(summary: string, detail: string) {
  const ok = await copyText(`${summary}\n\n${detail}`)
  repo.notify(ok ? 'ok' : 'err', ok ? '已复制这条日志' : '复制失败')
}

async function copyAll() {
  const text = list.value
    .map((l) => `[${formatDate(Math.floor(l.time / 1000))}] ${kindLabel(l.kind)} ${l.summary}\n${l.detail}`)
    .join('\n\n')
  const ok = await copyText(text)
  repo.notify(ok ? 'ok' : 'err', ok ? `已复制 ${list.value.length} 条日志` : '复制失败')
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[82vh] w-[860px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">操作日志</span>
        <span class="text-[11px] t3">{{ repo.logs.length }} 条 · {{ errCount }} 个错误</span>
        <div class="ml-3 flex items-center gap-1">
          <button
            class="btn px-2 py-0 text-[10px]"
            :style="filter === 'all' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
            @click="filter = 'all'"
          >
            全部
          </button>
          <button
            class="btn px-2 py-0 text-[10px]"
            :style="filter === 'err' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
            @click="filter = 'err'"
          >
            只看错误
          </button>
        </div>
        <button class="btn ml-auto" @click="copyAll">复制全部</button>
        <button class="btn" @click="repo.clearLogs()">清空</button>
        <button class="btn" @click="emit('close')">关闭 (Esc)</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!list.length" class="p-4 text-[12px] t3">
          还没有记录。之后每次操作失败都会把「原因 + 原始输出」记在这里，方便复盘。
        </div>
        <div v-for="l in list" :key="l.time + l.summary" class="line-b">
          <button class="flex w-full items-center gap-2 px-4 py-1.5 text-left" @click="toggle(l.time)">
            <span class="shrink-0 rounded px-1 text-[10px]" :style="{ color: kindColor(l.kind), border: '1px solid var(--border)' }">
              {{ kindLabel(l.kind) }}
            </span>
            <span class="shrink-0 font-mono text-[10px] t3">{{ formatDate(Math.floor(l.time / 1000)) }}</span>
            <span class="min-w-0 flex-1 truncate text-[12px]" :style="{ color: l.kind === 'err' ? '#f87171' : 'var(--text-dim)' }">
              {{ l.summary }}
            </span>
            <span class="shrink-0 text-[10px] t3">{{ opened.has(l.time) ? '收起' : '详情' }}</span>
          </button>
          <div v-if="opened.has(l.time)" class="px-4 pb-2">
            <pre
              class="max-h-[220px] overflow-auto rounded border p-2 font-mono text-[11px] leading-relaxed"
              :style="{ borderColor: 'var(--border)', background: 'var(--panel-2)', color: 'var(--text-dim)' }"
            >{{ l.detail }}</pre>
            <div class="mt-1 flex justify-end">
              <button class="btn px-2 py-0 text-[10px]" @click="copyOne(l.summary, l.detail)">复制这条</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

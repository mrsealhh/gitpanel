<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/git'
import { useRepoStore } from '../stores/repo'
import type { FileHunks } from '../api/types'

const props = defineProps<{ file: string; staged: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const repo = useRepoStore()
const data = ref<FileHunks | null>(null)
const loading = ref(false)
const busy = ref(false)
const selected = ref<Set<number>>(new Set())

const total = computed(() => data.value?.hunks.length ?? 0)
const allSelected = computed(() => total.value > 0 && selected.value.size === total.value)

async function load() {
  if (!repo.path) return
  loading.value = true
  try {
    data.value = await api.fileHunks(repo.path, props.file, props.staged)
    // 默认全选，符合「要么整文件、要么挑几块」的习惯
    selected.value = new Set(data.value.hunks.map((_, i) => i))
  } catch (e) {
    repo.notify('err', String((e as Error).message || e))
  } finally {
    loading.value = false
  }
}

function toggle(i: number) {
  const next = new Set(selected.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  selected.value = next
}

function toggleAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set((data.value?.hunks ?? []).map((_, i) => i))
}

async function run(mode: 'stage' | 'unstage' | 'discard') {
  if (!repo.path || !data.value || busy.value) return
  if (mode === 'discard' && !window.confirm(`丢弃选中的 ${selected.value.size} 个改动块？\n不可恢复（可以用「安全网」快照兜底）`)) return
  busy.value = true
  try {
    await api.applyHunks(repo.path, props.file, props.staged, [...selected.value], mode)
    const label = mode === 'stage' ? '已暂存所选块' : mode === 'unstage' ? '已取消暂存所选块' : '已丢弃所选块'
    repo.notify('ok', label)
    await repo.refreshStatus()
    await repo.reload()
    emit('close')
  } catch (e) {
    repo.notify('err', String((e as Error).message || e))
  } finally {
    busy.value = false
  }
}

function lineStyle(line: string) {
  if (line.startsWith('+')) return { background: 'var(--diff-insert)', color: 'var(--badge-head-fg)' }
  if (line.startsWith('-')) return { background: 'var(--diff-delete)', color: '#f87171' }
  if (line.startsWith('@@')) return { color: 'var(--accent)' }
  return { color: 'var(--text-dim)' }
}

onMounted(load)
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[82vh] w-[860px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">按块{{ staged ? '取消暂存' : '暂存 / 丢弃' }}</span>
        <span class="truncate font-mono text-[11px] t3">{{ file }}</span>
        <span class="shrink-0 text-[11px] t3">{{ total }} 个块</span>
        <button class="btn ml-auto" @click="emit('close')">关闭 (Esc)</button>
      </header>

      <div class="line-b flex items-center gap-2 px-4 py-1.5 text-[11px]">
        <button class="btn px-2 py-0.5 text-[10px]" @click="toggleAll">
          {{ allSelected ? '全不选' : '全选' }}
        </button>
        <span class="t3">已选 {{ selected.size }} / {{ total }}</span>
        <div class="ml-auto flex items-center gap-1">
          <template v-if="!staged">
            <button class="btn btn-primary px-2 py-0.5 text-[11px]" :disabled="!selected.size || busy" @click="run('stage')">
              暂存所选
            </button>
            <button
              class="btn px-2 py-0.5 text-[11px]"
              style="color: #f87171"
              :disabled="!selected.size || busy"
              @click="run('discard')"
            >
              丢弃所选
            </button>
          </template>
          <button v-else class="btn btn-primary px-2 py-0.5 text-[11px]" :disabled="!selected.size || busy" @click="run('unstage')">
            取消暂存所选
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="loading" class="p-4 text-[12px] t3">读取 diff 块…</div>
        <div v-else-if="data?.isBinary" class="p-4 text-[12px] t3">二进制文件不支持按块操作</div>
        <div v-else-if="!total" class="p-4 text-[12px] t3">
          没有可操作的 diff 块（新文件或二进制文件请直接整文件暂存）
        </div>
        <div v-for="(h, i) in data?.hunks ?? []" :key="i" class="line-b">
          <label class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px]" :style="{ background: 'var(--panel-2)' }">
            <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" :checked="selected.has(i)" @change="toggle(i)" />
            <span class="truncate font-mono t2">{{ h.header }}</span>
            <span class="ml-auto shrink-0 t3">{{ h.lines.length }} 行</span>
          </label>
          <pre class="overflow-x-auto px-0 py-1 font-mono text-[11px] leading-[1.5]"><div
            v-for="(l, li) in h.lines"
            :key="li"
            class="px-3"
            :style="lineStyle(l)"
          >{{ l || ' ' }}</div></pre>
        </div>
      </div>
    </div>
  </div>
</template>

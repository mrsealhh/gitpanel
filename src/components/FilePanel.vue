<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/git'
import { useRepoStore } from '../stores/repo'
import type { FsEntry } from '../api/types'
import Icon from './Icon.vue'

const repo = useRepoStore()

const rootEntries = ref<FsEntry[]>([])
const children = ref<Record<string, FsEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const loading = ref(false)
const q = ref('')
const allFiles = ref<string[]>([])

/** 搜索命中（用 git ls-files 的全量文件列表，不用逐层展开） */
const matches = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return []
  return allFiles.value.filter((f) => f.toLowerCase().includes(kw)).slice(0, 300)
})

interface Row {
  entry: FsEntry
  depth: number
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (list: FsEntry[], depth: number) => {
    for (const entry of list) {
      out.push({ entry, depth })
      if (entry.isDir && expanded.value.has(entry.path)) {
        walk(children.value[entry.path] ?? [], depth + 1)
      }
    }
  }
  walk(rootEntries.value, 0)
  return out
})

function sizeLabel(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function loadDir(dir: string) {
  if (!repo.path) return
  loading.value = true
  try {
    const r = await api.fsList(repo.path, dir)
    if (dir === '') rootEntries.value = r.entries
    else children.value = { ...children.value, [dir]: r.entries }
  } catch (e) {
    repo.notify('err', String((e as Error).message || e))
  } finally {
    loading.value = false
  }
}

async function loadAllFiles() {
  if (!repo.path) return
  try {
    allFiles.value = (await api.fsFiles(repo.path)).files
  } catch {
    allFiles.value = []
  }
}

async function toggle(entry: FsEntry) {
  if (!entry.isDir) {
    await repo.openEditor(entry.path)
    return
  }
  const next = new Set(expanded.value)
  if (next.has(entry.path)) {
    next.delete(entry.path)
  } else {
    next.add(entry.path)
    if (!children.value[entry.path]) await loadDir(entry.path)
  }
  expanded.value = next
}

function openFile(path: string) {
  void repo.openEditor(path)
}

function reset() {
  rootEntries.value = []
  children.value = {}
  expanded.value = new Set()
  void loadDir('')
  void loadAllFiles()
}

watch(
  () => repo.path,
  () => reset(),
)
onMounted(reset)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-1 p-2">
      <input v-model="q" placeholder="搜索文件 / 过滤" class="field min-w-0 flex-1 px-2 py-1 text-[12px]" />
      <button class="btn shrink-0 px-1.5 py-1 text-[10px]" title="刷新文件列表" @click="reset">刷新</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <!-- 搜索命中：直接平铺 -->
      <template v-if="q.trim()">
        <div class="px-3 py-1 text-[10px] uppercase tracking-wider t3">
          匹配文件 <span class="opacity-60">{{ matches.length }}</span>
        </div>
        <button
          v-for="f in matches"
          :key="f"
          class="flex w-full items-center gap-1.5 truncate px-3 py-[3px] text-left text-[12px] row-hover"
          :style="repo.editorFile === f ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
          :title="f"
          @click="openFile(f)"
        >
          <Icon name="file" :size="12" class="shrink-0 t3" />
          <span class="truncate">{{ f }}</span>
        </button>
        <div v-if="!matches.length" class="px-3 py-2 text-[11px] t3">没有匹配的文件</div>
      </template>

      <!-- 目录树 -->
      <template v-else>
        <div class="px-3 py-1 text-[10px] uppercase tracking-wider t3">
          项目文件
          <span v-if="loading" class="ml-1 opacity-60">加载中…</span>
        </div>
        <div
          v-for="row in rows"
          :key="row.entry.path"
          class="flex w-full cursor-pointer items-center gap-1.5 truncate py-[3px] pr-2 text-[12px] row-hover"
          :style="{
            paddingLeft: `${8 + row.depth * 12}px`,
            color: repo.editorFile === row.entry.path ? 'var(--accent)' : 'var(--text-dim)',
          }"
          :title="row.entry.path"
          @click="toggle(row.entry)"
        >
          <span class="w-3 shrink-0 text-[9px] t3">
            {{ row.entry.isDir ? (expanded.has(row.entry.path) ? '▾' : '▸') : '' }}
          </span>
          <Icon :name="row.entry.isDir ? 'folder' : 'file'" :size="12" class="shrink-0 t3" />
          <span class="truncate">{{ row.entry.name }}</span>
          <span v-if="!row.entry.isDir" class="ml-auto shrink-0 pl-2 text-[10px] t3">
            {{ sizeLabel(row.entry.size) }}
          </span>
        </div>
        <div v-if="!rows.length && !loading" class="px-3 py-2 text-[11px] t3">没有可显示的文件</div>
      </template>
    </div>
  </div>
</template>

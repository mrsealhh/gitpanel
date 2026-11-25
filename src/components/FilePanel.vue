<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

/** 搜索模式：按文件名 / 按文件内容 */
const mode = ref<'name' | 'content'>('name')
const hits = ref<{ file: string; line: number; text: string }[]>([])
const hitsLoading = ref(false)
const hitLimit = ref(false)

/** 名称搜索命中（用 git ls-files 的全量文件列表） */
const matches = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw || mode.value !== 'name') return []
  return allFiles.value.filter((f) => f.toLowerCase().includes(kw)).slice(0, 300)
})

/** 内容搜索命中：按目录分组，呈现成树状 */
interface HitGroup {
  dir: string
  items: { file: string; name: string; line: number; text: string }[]
}
const hitGroups = computed<HitGroup[]>(() => {
  const map = new Map<string, HitGroup>()
  for (const h of hits.value) {
    const idx = h.file.lastIndexOf('/')
    const dir = idx >= 0 ? h.file.slice(0, idx) : ''
    const name = idx >= 0 ? h.file.slice(idx + 1) : h.file
    if (!map.has(dir)) map.set(dir, { dir, items: [] })
    map.get(dir)!.items.push({ file: h.file, name, line: h.line, text: h.text })
  }
  return [...map.values()].sort((a, b) => a.dir.localeCompare(b.dir))
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

/** 文件内容搜索（防抖） */
let grepTimer: number | undefined
function scheduleGrep() {
  if (grepTimer) window.clearTimeout(grepTimer)
  const query = q.value.trim()
  if (mode.value !== 'content' || !query) {
    hits.value = []
    hitLimit.value = false
    return
  }
  grepTimer = window.setTimeout(async () => {
    if (!repo.path) return
    hitsLoading.value = true
    try {
      const r = await api.fsGrep(repo.path, query, 300)
      hits.value = r.hits
      hitLimit.value = r.limitReached
    } catch (e) {
      hits.value = []
      repo.notify('err', String((e as Error).message || e))
    } finally {
      hitsLoading.value = false
    }
  }, 280)
}

watch(q, scheduleGrep)
watch(mode, () => {
  scheduleGrep()
})

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

/** 展开某个文件的所有父目录，便于回到文件页签时自动定位 */
async function reveal(path: string) {
  if (!path) return
  const parts = path.split('/')
  parts.pop()
  let dir = ''
  const next = new Set(expanded.value)
  for (const seg of parts) {
    dir = dir ? `${dir}/${seg}` : seg
    next.add(dir)
    if (!children.value[dir]) await loadDir(dir)
  }
  expanded.value = next
  await nextTick()
  const el = document.querySelector(`[data-fs-path="${CSS.escape(path)}"]`)
  el?.scrollIntoView({ block: 'nearest' })
}

function reset() {
  rootEntries.value = []
  children.value = {}
  expanded.value = new Set()
  hits.value = []
  void loadDir('')
  void loadAllFiles()
}

watch(
  () => repo.path,
  () => reset(),
)
watch(
  () => repo.activeFile(),
  (file) => {
    if (file) void reveal(file)
  },
)
onMounted(() => {
  reset()
  const active = repo.activeFile()
  if (active) void reveal(active)
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-1 p-2">
      <input
        v-model="q"
        :placeholder="mode === 'name' ? '搜索文件名 / 过滤' : '搜索文件内容（git grep）'"
        class="field min-w-0 flex-1 px-2 py-1 text-[12px]"
      />
      <button
        class="btn shrink-0 px-1.5 py-1 text-[10px]"
        :title="mode === 'name' ? '切换到按内容搜索' : '切换到按文件名搜索'"
        @click="mode = mode === 'name' ? 'content' : 'name'"
      >
        {{ mode === 'name' ? '按名称' : '按内容' }}
      </button>
      <button class="btn shrink-0 px-1.5 py-1 text-[10px]" title="刷新文件列表" @click="reset">刷新</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <!-- 内容搜索：按目录分组的结果树 -->
      <template v-if="mode === 'content' && q.trim()">
        <div class="px-3 py-1 text-[10px] uppercase tracking-wider t3">
          内容匹配
          <span class="opacity-60">{{ hits.length }}{{ hitLimit ? '+' : '' }}</span>
          <span v-if="hitsLoading" class="ml-1 opacity-60">搜索中…</span>
        </div>
        <div v-for="g in hitGroups" :key="g.dir" class="mb-1">
          <div class="flex items-center gap-1 px-3 py-[2px] text-[11px] t3">
            <Icon name="folder" :size="11" class="shrink-0" />
            <span class="truncate">{{ g.dir || '（根目录）' }}</span>
            <span class="opacity-60">{{ g.items.length }}</span>
          </div>
          <button
            v-for="h in g.items"
            :key="`${h.file}:${h.line}`"
            class="flex w-full items-center gap-2 py-[2px] pl-7 pr-3 text-left text-[11px] row-hover"
            :style="repo.activeFile() === h.file ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
            :title="`${h.file}:${h.line}`"
            @click="openFile(h.file)"
          >
            <span class="shrink-0 font-mono text-[10px] opacity-70">{{ h.name }}:{{ h.line }}</span>
            <span class="min-w-0 flex-1 truncate font-mono">{{ h.text }}</span>
          </button>
        </div>
        <div v-if="!hits.length && !hitsLoading" class="px-3 py-2 text-[11px] t3">没有匹配的文件内容</div>
      </template>

      <!-- 名称搜索：平铺 -->
      <template v-else-if="mode === 'name' && q.trim()">
        <div class="px-3 py-1 text-[10px] uppercase tracking-wider t3">
          匹配文件 <span class="opacity-60">{{ matches.length }}</span>
        </div>
        <button
          v-for="f in matches"
          :key="f"
          class="flex w-full items-center gap-1.5 truncate px-3 py-[3px] text-left text-[12px] row-hover"
          :style="repo.activeFile() === f ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
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
          :data-fs-path="row.entry.isDir ? undefined : row.entry.path"
          class="flex w-full cursor-pointer items-center gap-1.5 truncate py-[3px] pr-2 text-[12px] row-hover"
          :style="{
            paddingLeft: `${8 + row.depth * 12}px`,
            color: repo.activeFile() === row.entry.path ? 'var(--accent)' : 'var(--text-dim)',
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

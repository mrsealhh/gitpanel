<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '../api/git'
import { useRepoStore } from '../stores/repo'
import type { FsEntry } from '../api/types'
import Icon from './Icon.vue'
import IconButton from './IconButton.vue'

const repo = useRepoStore()
const emit = defineEmits<{
  (e: 'file-context', payload: { file: string; isDir: boolean; x: number; y: number }): void
}>()

const rootEntries = ref<FsEntry[]>([])
const children = ref<Record<string, FsEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const loading = ref(false)
const filesLoading = ref(false)
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
  filesLoading.value = true
  try {
    allFiles.value = (await api.fsFiles(repo.path)).files
  } catch {
    allFiles.value = []
  } finally {
    filesLoading.value = false
  }
}

/** 刷新：根目录 + 所有已展开目录 + 全量文件列表 */
async function refresh() {
  if (!repo.path) return
  await loadDir('')
  for (const dir of [...expanded.value]) await loadDir(dir)
  await loadAllFiles()
  repo.notify('ok', '文件列表已刷新')
}

/** 文件内容搜索：按文件批次循环搜索，逐步追加结果，避免单次 git grep 卡死 */
let grepTimer: number | undefined
let grepSeq = 0
const searchProgress = ref({ done: 0, total: 0 })
const GREP_BATCH = 40

async function runContentSearch(query: string, mine: number) {
  if (!repo.path) return
  try {
    if (!allFiles.value.length) await loadAllFiles()
    if (mine !== grepSeq) return
    const files = allFiles.value
    searchProgress.value = { done: 0, total: files.length }
    for (let i = 0; i < files.length; i += GREP_BATCH) {
      if (mine !== grepSeq) return
      const chunk = files.slice(i, i + GREP_BATCH)
      const r = await api.fsGrepBatch(repo.path, query, chunk, Math.max(1, 300 - hits.value.length))
      if (mine !== grepSeq) return
      if (r.hits.length) hits.value = hits.value.concat(r.hits)
      searchProgress.value = { done: Math.min(files.length, i + chunk.length), total: files.length }
      if (hits.value.length >= 300 || r.limitReached) {
        hitLimit.value = true
        break
      }
    }
  } catch (e) {
    if (mine !== grepSeq) return
    repo.notify('err', String((e as Error).message || e))
  } finally {
    if (mine === grepSeq) hitsLoading.value = false
  }
}

function scheduleGrep() {
  if (grepTimer) window.clearTimeout(grepTimer)
  const query = q.value.trim()
  if (mode.value !== 'content' || !query) {
    grepSeq++
    hits.value = []
    hitLimit.value = false
    hitsLoading.value = false
    searchProgress.value = { done: 0, total: 0 }
    return
  }
  // 立即给出反馈，避免大仓库搜索还没返回时看起来没响应
  const mine = ++grepSeq
  hitsLoading.value = true
  hitLimit.value = false
  hits.value = []
  searchProgress.value = { done: 0, total: allFiles.value.length }
  grepTimer = window.setTimeout(() => void runContentSearch(query, mine), 280)
}

watch(q, scheduleGrep)
watch(mode, () => scheduleGrep())

function clearQuery() {
  grepSeq++
  q.value = ''
  hits.value = []
  hitLimit.value = false
  hitsLoading.value = false
  searchProgress.value = { done: 0, total: 0 }
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

function onCtx(e: MouseEvent, file: string, isDir = false) {
  e.preventDefault()
  emit('file-context', { file, isDir, x: e.clientX, y: e.clientY })
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
    <!-- 名称 / 内容 两个明确的搜索模式 -->
    <div class="flex items-center gap-1 p-2 pb-1">
      <div class="flex flex-1 overflow-hidden rounded border" :style="{ borderColor: 'var(--border)' }">
        <button
          class="flex-1 py-1 text-[11px]"
          :style="
            mode === 'name'
              ? { background: 'var(--accent-weak)', color: 'var(--accent)' }
              : { color: 'var(--text-mute)' }
          "
          title="按文件名搜索"
          @click="mode = 'name'"
        >
          名称
        </button>
        <button
          class="flex-1 py-1 text-[11px]"
          :style="
            mode === 'content'
              ? { background: 'var(--accent-weak)', color: 'var(--accent)' }
              : { color: 'var(--text-mute)' }
          "
          title="按文件内容搜索（git grep）"
          @click="mode = 'content'"
        >
          内容
        </button>
      </div>
      <IconButton class="shrink-0" name="refresh" title="刷新文件列表" compact :size="13" @click="refresh" />
    </div>

    <div class="px-2 pb-2">
      <div class="relative">
        <input
          v-model="q"
          :placeholder="mode === 'name' ? '查找文件' : '查找文件内容'"
          class="field w-full py-1 pl-7 pr-7 text-[12px]"
        />
        <span class="pointer-events-none absolute left-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center t3">
          <Icon name="search" :size="13" />
        </span>
        <button
          v-if="q"
          class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded t3 hover:bg-[var(--hover)] hover:opacity-100"
          title="清除搜索，回到文件树"
          @click="clearQuery"
        >
          <Icon name="close" :size="13" />
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <!-- 搜索结果（不清空也能继续看下面的文件树） -->
      <template v-if="q.trim()">
        <div class="px-3 py-1 text-[10px] uppercase tracking-wider t3">
          {{ mode === 'name' ? '按名称匹配' : '按内容匹配' }}
          <span class="opacity-60">{{ mode === 'name' ? matches.length : hits.length }}{{ hitLimit ? '+' : '' }}</span>
          <span v-if="filesLoading && mode === 'name'" class="ml-1 inline-flex items-center gap-1 opacity-60">
            <span class="inline-block h-2 w-2 animate-spin rounded-full border border-current border-r-transparent" />索引中…
          </span>
          <span v-if="hitsLoading" class="ml-1 inline-flex items-center gap-1 opacity-60">
            <span class="inline-block h-2 w-2 animate-spin rounded-full border border-current border-r-transparent" />
            搜索中{{ searchProgress.total ? ` ${searchProgress.done}/${searchProgress.total}` : '…' }}
          </span>
        </div>

        <template v-if="mode === 'name'">
          <button
            v-for="f in matches"
            :key="f"
            class="flex w-full items-center gap-1.5 truncate px-3 py-[3px] text-left text-[12px] row-hover"
            :style="repo.activeFile() === f ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
            :title="f"
            @click="openFile(f)"
            @contextmenu="onCtx($event, f)"
          >
            <Icon name="file" :size="12" class="shrink-0 t3" />
            <span class="truncate">{{ f }}</span>
          </button>
          <div v-if="!matches.length" class="px-3 py-2 text-[11px] t3">没有匹配的文件名</div>
        </template>

        <template v-else>
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
              @contextmenu="onCtx($event, h.file)"
            >
              <span class="shrink-0 font-mono text-[10px] opacity-70">{{ h.name }}:{{ h.line }}</span>
              <span class="min-w-0 flex-1 truncate font-mono">{{ h.text }}</span>
            </button>
          </div>
          <div v-if="!hits.length && !hitsLoading" class="px-3 py-2 text-[11px] t3">没有匹配的文件内容</div>
        </template>

        <div class="line-t mx-3 my-2" />
      </template>

      <!-- 文件树：始终在下面，随时可以继续浏览 -->
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
        @contextmenu="onCtx($event, row.entry.path, row.entry.isDir)"
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
    </div>
  </div>
</template>

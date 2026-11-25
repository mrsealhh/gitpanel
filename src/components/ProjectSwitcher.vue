<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import { pickFolder } from '../api/desktop'
import type { RecentRepo } from '../api/desktop'
import Icon from './Icon.vue'

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'rename', path: string): void
  (e: 'clone', url: string): void
  (e: 'browse'): void
  (e: 'manage'): void
}>()

const repo = useRepoStore()
const settings = useSettingsStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLElement | null>(null)
const search = ref('')
const url = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const collapsed = ref<Set<string>>(new Set())

/** 下拉用 fixed 定位，避免被标题栏的 overflow-hidden 裁掉 */
const pos = ref({ left: 0, top: 0, maxHeight: 560 })

const current = computed(() => {
  const path = repo.info?.path
  const hit = repo.recents.find((r) => r.path === path)
  return hit?.alias || hit?.name || repo.info?.name || '未打开项目'
})

interface GroupNode {
  name: string
  path: string
  children: Map<string, GroupNode>
  repos: RecentRepo[]
}

interface Row {
  kind: 'group' | 'repo'
  key: string
  label: string
  depth: number
  groupPath: string
  count?: number
  repo?: RecentRepo
}

function repoName(r: RecentRepo) {
  return r.alias || r.name
}

function sortRepos(list: RecentRepo[]) {
  const mode = settings.repoSort
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (mode === 'name') return repoName(a).localeCompare(repoName(b), 'zh-CN')
    if (mode === 'recent') return b.openedAt - a.openedAt
    return a.sortOrder - b.sortOrder || repoName(a).localeCompare(repoName(b), 'zh-CN')
  })
}

const filteredRepos = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return repo.recents
  return repo.recents.filter(
    (r) =>
      repoName(r).toLowerCase().includes(kw) ||
      r.name.toLowerCase().includes(kw) ||
      r.path.toLowerCase().includes(kw) ||
      r.groupPath.toLowerCase().includes(kw),
  )
})

const rows = computed<Row[]>(() => {
  const tree: GroupNode = { name: '', path: '', children: new Map(), repos: [] }
  for (const r of filteredRepos.value) {
    const parts = r.groupPath.split('/').filter(Boolean).slice(0, 3)
    let node = tree
    for (const part of parts) {
      const p = node.path ? `${node.path}/${part}` : part
      if (!node.children.has(part)) node.children.set(part, { name: part, path: p, children: new Map(), repos: [] })
      node = node.children.get(part)!
    }
    node.repos.push(r)
  }

  const countAll = (n: GroupNode): number =>
    n.repos.length + [...n.children.values()].reduce((sum, c) => sum + countAll(c), 0)

  const out: Row[] = []
  const searching = !!search.value.trim()
  const walk = (node: GroupNode, depth: number) => {
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const child of children) {
      out.push({
        kind: 'group',
        key: `g:${child.path}`,
        label: child.name,
        depth,
        groupPath: child.path,
        count: countAll(child),
      })
      if (searching || !collapsed.value.has(child.path)) walk(child, depth + 1)
    }
    for (const r of sortRepos(node.repos)) {
      out.push({
        kind: 'repo',
        key: `r:${r.path}`,
        label: repoName(r),
        depth,
        groupPath: node.path,
        repo: r,
      })
    }
  }
  walk(tree, 0)
  return out
})

const firstRepo = computed(() => rows.value.find((r) => r.kind === 'repo')?.repo)

const canClone = computed(() => /^(https?:\/\/|git@|ssh:\/\/)/.test(url.value.trim()))

/** 粘贴的是本地路径（盘符 / UNC）时，直接当「打开本地仓库」 */
const isLocalPath = computed(
  () => /^[a-zA-Z]:[\\/]/.test(url.value.trim()) || url.value.trim().startsWith('\\\\'),
)

const canSubmit = computed(() => canClone.value || isLocalPath.value)

function place() {
  const r = btn.value?.getBoundingClientRect()
  if (!r) return
  pos.value = {
    left: Math.max(8, Math.min(r.left, window.innerWidth - 460)),
    top: r.bottom + 6,
    maxHeight: Math.max(260, window.innerHeight - r.bottom - 24),
  }
}

async function toggle() {
  if (!open.value) {
    search.value = ''
    url.value = ''
    place()
    open.value = true
    await nextTick()
    searchInput.value?.focus()
  } else {
    open.value = false
  }
}

function pick(path: string) {
  emit('open', path)
  open.value = false
}

function toggleGroup(path: string) {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}

function doClone() {
  if (!canSubmit.value) return
  if (isLocalPath.value) {
    emit('open', url.value.trim())
  } else {
    emit('clone', url.value.trim())
  }
  open.value = false
}

async function scanAndImport() {
  const dir = await pickFolder('选择包含 Git 项目的文件夹')
  if (!dir) return
  try {
    await repo.scanAndImport(dir)
    open.value = false
  } catch (e) {
    repo.notify('err', String((e as Error).message || e))
  }
}

function onSortChange() {
  settings.save()
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('keydown', onEsc)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div ref="root" class="shrink-0">
    <button
      ref="btn"
      class="btn flex max-w-[240px] items-center gap-1.5"
      :title="repo.info?.path || '选择 / 打开项目'"
      @click="toggle"
    >
      <Icon name="folder" :size="13" class="shrink-0" />
      <span class="truncate">{{ current }}</span>
      <span class="shrink-0 text-[9px] t3">▾</span>
    </button>

    <div
      v-if="open"
      class="modal animate-pop fixed z-[60] flex w-[440px] flex-col overflow-hidden"
      :style="{ left: pos.left + 'px', top: pos.top + 'px', maxHeight: pos.maxHeight + 'px' }"
    >
      <!-- 搜索已保存项目 -->
      <div class="line-b px-2 py-2">
        <div class="relative">
          <input
            ref="searchInput"
            v-model="search"
            class="field w-full py-1 pl-7 pr-7 text-[12px]"
            placeholder="搜索项目 / 路径 / 分组"
            @keydown.enter="firstRepo && pick(firstRepo.path)"
          />
          <span class="pointer-events-none absolute left-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center t3">
            <Icon name="search" :size="13" />
          </span>
          <button
            v-if="search"
            class="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded t3 hover:bg-[var(--hover)]"
            title="清除搜索"
            @click="search = ''"
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
      </div>

      <div class="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wider t3">
        <span>全部项目（{{ repo.recents.length }}）</span>
        <select
          v-model="settings.repoSort"
          class="field ml-auto px-1 py-0.5 text-[10px] normal-case tracking-normal"
          title="仓库排序方式"
          @change="onSortChange"
        >
          <option value="manual">手动排序</option>
          <option value="name">按名称</option>
          <option value="recent">最近打开</option>
        </select>
        <button class="btn px-1.5 py-0.5 text-[10px] normal-case tracking-normal" @click="emit('manage'); open = false">
          整理
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-for="row in rows" :key="row.key">
          <button
            v-if="row.kind === 'group'"
            class="row-hover flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[12px]"
            :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
            :title="row.groupPath"
            @click="toggleGroup(row.groupPath)"
          >
            <span class="w-3 shrink-0 text-[9px] t3">{{ collapsed.has(row.groupPath) ? '▸' : '▾' }}</span>
            <Icon name="folder" :size="13" class="shrink-0" :style="{ color: 'var(--accent)' }" />
            <span class="min-w-0 flex-1 truncate t2">{{ row.label }}</span>
            <span class="shrink-0 text-[10px] t3">{{ row.count }}</span>
          </button>
          <div
            v-else-if="row.repo"
            class="row-hover group flex cursor-pointer items-center gap-2 py-1.5 pr-2"
            :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
            :title="row.repo.path"
            @click="pick(row.repo.path)"
          >
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              :style="{ background: row.repo.path === repo.info?.path ? 'var(--accent)' : 'transparent' }"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-[12px]"
                :style="{ color: row.repo.path === repo.info?.path ? 'var(--accent)' : 'var(--text)' }"
              >
                {{ row.label }}
                <span v-if="row.repo.pinned" class="ml-1 text-[10px] t3">📌</span>
              </span>
              <span class="block truncate font-mono text-[10px] t3">
                {{ row.repo.groupPath ? row.repo.groupPath + ' / ' : '' }}{{ row.repo.name }}
              </span>
            </span>
            <button
              class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:opacity-100 group-hover:opacity-100"
              :title="row.repo.pinned ? '取消置顶' : '置顶'"
              @click.stop="repo.pinRecent(row.repo.path, !row.repo.pinned)"
            >
              {{ row.repo.pinned ? '取消置顶' : '置顶' }}
            </button>
            <button
              class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:opacity-100 group-hover:opacity-100"
              title="重命名"
              @click.stop="emit('rename', row.repo.path); open = false"
            >
              改名
            </button>
            <button
              class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:text-rose-400 group-hover:opacity-100"
              title="从列表移除（不删除磁盘文件）"
              @click.stop="repo.forget(row.repo.path)"
            >
              移除
            </button>
          </div>
        </template>
        <div v-if="!rows.length" class="px-3 py-3 text-[11px] t3">
          {{ repo.recents.length ? '没有匹配的项目' : '还没有打开过项目，可以扫描文件夹批量导入' }}
        </div>
      </div>

      <!-- 打开本地 / 粘贴地址克隆 -->
      <div class="line-t px-2 py-2">
        <div class="mb-2 flex gap-1">
          <button class="btn flex-1 px-2 py-1 text-[11px]" @click="emit('browse'); open = false">
            打开本地仓库…
          </button>
          <button class="btn flex-1 px-2 py-1 text-[11px]" title="扫描文件夹内的 Git 项目并自动分组导入" @click="scanAndImport">
            扫描文件夹导入…
          </button>
        </div>
        <div class="flex gap-1">
          <input
            v-model="url"
            class="field min-w-0 flex-1 px-2 py-1 font-mono text-[11px]"
            placeholder="粘贴 .git 地址或本地路径，例如 https://github.com/o/r.git"
            @keydown.enter="doClone"
          />
          <button
            class="btn btn-primary shrink-0 px-2 py-1 text-[11px]"
            :disabled="!canSubmit"
            :style="!canSubmit ? { opacity: 0.45 } : {}"
            @click="doClone"
          >
            {{ isLocalPath ? '打开' : '克隆' }}
          </button>
        </div>
        <div class="mt-1 text-[10px] t3">
          支持 https / ssh / git@ 地址，也可以直接粘贴本机仓库路径
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BranchStatus, RepoRef } from '../api/types'
import { useRepoStore } from '../stores/repo'
import IconButton from './IconButton.vue'
import { buildBranchTree, filterTree, flattenTree, type FlatRow, type TreeNode } from '../lib/branchTree'

const props = defineProps<{
  refs: RepoRef[]
  branch: string
  tip: string
  name: string
  statuses?: BranchStatus[]
}>()

const emit = defineEmits<{
  (e: 'filter', tip: string): void
  (e: 'context', payload: { ref: RepoRef; x: number; y: number }): void
  (e: 'create-tag'): void
  (e: 'sync', kind: 'fetch' | 'pull' | 'push'): void
  (e: 'compare', name: string): void
  (e: 'checkout', name: string): void
  (e: 'delete-remote', name: string): void
  (e: 'manage-remotes'): void
}>()

/** 分支名 → 上游/领先/落后 */
const statusMap = computed(() => {
  const map: Record<string, BranchStatus> = {}
  for (const s of props.statuses ?? []) map[s.name] = s
  return map
})

/** 当前分支的改动统计，方便一眼看出工作区状态 */
const repo = useRepoStore()
const changeStats = computed(() => {
  const s = repo.status
  if (!s) return null
  return {
    staged: s.staged.length,
    unstaged: s.unstaged.length,
    untracked: s.untracked.length,
    conflicted: s.conflicted.length,
    total: s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length,
  }
})

const q = ref('')
const kw = computed(() => q.value.trim().toLowerCase())

/** 折叠状态：默认全展开（空集合 = 没有折叠的节点） */
const collapsed = {
  local: ref<Set<string>>(new Set()),
  remote: ref<Set<string>>(new Set()),
  tag: ref<Set<string>>(new Set()),
}
type BucketKey = keyof typeof collapsed

const open = ref({ local: true, remote: true, tag: true })

const localRefs = computed(() => props.refs.filter((r) => r.kind === 'branch' || r.kind === 'head'))
const remoteRefs = computed(() => props.refs.filter((r) => r.kind === 'remote'))
const tagRefs = computed(() => props.refs.filter((r) => r.kind === 'tag'))

/** origin/feature/x → feature/x */
function remoteShort(name: string) {
  const i = name.indexOf('/')
  return i < 0 ? name : name.slice(i + 1)
}

/** 本地分支树：每个叶子分支下挂它的远端跟踪分支 */
const localTree = computed<TreeNode[]>(() =>
  buildBranchTree(
    localRefs.value.map((ref) => ({ name: ref.name, ref })),
    (name) => remoteRefs.value.filter((r) => remoteShort(r.name) === name),
  ),
)

/** 远端分支树：origin 作为根节点，下面是它的分支路径 */
const remoteTree = computed<TreeNode[]>(() =>
  buildBranchTree(remoteRefs.value.map((ref) => ({ name: ref.name, ref }))),
)

/** 标签树：v1.2/rc 这种也会分层 */
const tagTree = computed<TreeNode[]>(() =>
  buildBranchTree(tagRefs.value.map((ref) => ({ name: ref.name, ref }))),
)

/** 过滤时临时全展开，方便直接看到命中路径 */
function rowsOf(tree: TreeNode[], key: BucketKey): FlatRow[] {
  const filtered = kw.value ? filterTree(tree, kw.value) : tree
  return flattenTree(filtered, kw.value ? new Set() : collapsed[key].value)
}

const localRows = computed(() => rowsOf(localTree.value, 'local'))
const remoteRows = computed(() => rowsOf(remoteTree.value, 'remote'))
const tagRows = computed(() => rowsOf(tagTree.value, 'tag'))

const localCount = computed(() => localRefs.value.length)
const remoteCount = computed(() => remoteRefs.value.length)
const tagCount = computed(() => tagRefs.value.length)

function toggle(key: BucketKey, path: string) {
  const next = new Set(collapsed[key].value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed[key].value = next
}

/** 点名字 = 筛选；点箭头 = 折叠；中间目录只折叠 */
function onNode(row: FlatRow, key: BucketKey) {
  if (row.node.ref) emit('filter', row.node.ref.name)
  else if (row.hasChildren) toggle(key, row.node.path)
}

function onArrow(e: MouseEvent, row: FlatRow, key: BucketKey) {
  e.stopPropagation()
  if (row.hasChildren) toggle(key, row.node.path)
}

function expandAll() {
  for (const key of Object.keys(collapsed) as BucketKey[]) collapsed[key].value = new Set()
}

function collectPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length) {
      out.push(n.path)
      collectPaths(n.children, out)
    }
  }
  return out
}

function collapseAll() {
  collapsed.local.value = new Set(collectPaths(localTree.value))
  collapsed.remote.value = new Set(collectPaths(remoteTree.value))
  collapsed.tag.value = new Set(collectPaths(tagTree.value))
}

function onCtx(e: MouseEvent, r?: RepoRef) {
  if (!r) return
  e.preventDefault()
  emit('context', { ref: r, x: e.clientX, y: e.clientY })
}

function rowStyle(depth: number, selected: boolean, isRef: boolean) {
  return {
    paddingLeft: `${8 + depth * 12}px`,
    paddingRight: '8px',
    color: selected ? 'var(--accent)' : isRef ? 'var(--text-dim)' : 'var(--text-mute)',
    fontWeight: isRef ? 400 : 500,
  }
}
</script>

<template>
  <aside class="flex h-full w-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b px-3 py-2">
      <div class="truncate text-[13px] font-semibold t1">{{ name }}</div>
      <div class="mt-0.5 flex items-center gap-1.5 text-[11px] t3">
        <span class="h-1.5 w-1.5 rounded-full" style="background: var(--accent)" />
        <span class="min-w-0 truncate">{{ branch }}</span>
        <span v-if="statusMap[branch]?.ahead" class="shrink-0" :style="{ color: 'var(--accent)' }">
          ↑{{ statusMap[branch].ahead }}
        </span>
        <span v-if="statusMap[branch]?.behind" class="shrink-0" :style="{ color: 'var(--badge-head-fg)' }">
          ↓{{ statusMap[branch].behind }}
        </span>
        <span class="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton compact name="fetch" :title="'抓取远端更新（fetch）'" :size="12" @click="emit('sync', 'fetch')" />
          <IconButton
            compact
            name="pull"
            :title="`拉取并合并（pull）${statusMap[branch]?.behind ? `，落后 ${statusMap[branch].behind}` : ''}`"
            :size="12"
            @click="emit('sync', 'pull')"
          />
          <IconButton
            compact
            name="push"
            :title="`推送到远端（push）${statusMap[branch]?.ahead ? `，领先 ${statusMap[branch].ahead}` : ''}；没有上游会自动 --set-upstream`"
            :size="12"
            :active="!!statusMap[branch]?.ahead"
            @click="emit('sync', 'push')"
          />
        </span>
      </div>
      <div v-if="changeStats" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] t3">
        <span v-if="changeStats.staged" :style="{ color: 'var(--badge-head-fg)' }">已暂存 {{ changeStats.staged }}</span>
        <span v-if="changeStats.unstaged" :style="{ color: 'var(--accent)' }">未暂存 {{ changeStats.unstaged }}</span>
        <span v-if="changeStats.untracked">未跟踪 {{ changeStats.untracked }}</span>
        <span v-if="changeStats.conflicted" style="color: #fb923c">冲突 {{ changeStats.conflicted }}</span>
        <span v-if="!changeStats.total">工作区干净</span>
      </div>
    </div>

    <div class="flex items-center gap-1 p-2">
      <input v-model="q" placeholder="过滤分支 / 标签" class="field min-w-0 flex-1 px-2 py-1 text-[12px]" />
      <IconButton compact name="chevron-down" title="展开全部" :size="14" @click="expandAll" />
      <IconButton compact name="chevron-up" title="折叠全部" :size="14" @click="collapseAll" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <button
        class="mx-2 mb-1 w-[calc(100%-16px)] rounded px-2 py-1 text-left text-[12px] t2 row-hover"
        :class="tip === '' ? 'row-selected' : ''"
        :style="tip === '' ? { color: 'var(--text)' } : {}"
        @click="emit('filter', '')"
      >
        全部提交
      </button>

      <!-- 本地分支树 -->
      <button
        class="flex w-full items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3"
        @click="open.local = !open.local"
      >
        <span class="text-[9px]">{{ open.local ? '▾' : '▸' }}</span>
        本地分支
        <span class="ml-1 opacity-60">{{ localCount }}</span>
      </button>
      <div v-show="open.local">
        <div v-for="row in localRows" :key="`l:${row.node.path}`">
        <div
          class="flex w-full cursor-pointer items-center gap-1 py-[3px] text-[12px] row-hover"
          :style="rowStyle(row.depth, tip === row.node.ref?.name, !!row.node.ref)"
          :title="row.node.path"
          @click="onNode(row, 'local')"
          @contextmenu="onCtx($event, row.node.ref)"
        >
          <span
            v-if="row.hasChildren"
            class="w-3 shrink-0 text-[9px] t3"
            @click="onArrow($event, row, 'local')"
          >
            {{ row.expanded ? '▾' : '▸' }}
          </span>
          <span v-else class="w-3 shrink-0" />
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{ background: row.node.ref?.name === branch ? 'var(--accent)' : 'transparent' }"
          />
          <span class="min-w-0 flex-1 truncate" :style="row.node.ref?.name === branch ? { color: 'var(--accent)', fontWeight: 500 } : {}">
            {{ row.node.seg }}
          </span>

          <!-- 领先 / 落后：其它分支也能一眼看出有没有未推送 / 未拉取 -->
          <span
            v-if="statusMap[row.node.ref?.name ?? '']?.ahead"
            class="shrink-0 text-[10px]"
            :style="{ color: 'var(--accent)' }"
            :title="`领先上游 ${statusMap[row.node.ref?.name ?? ''].ahead} 个提交`"
          >
            ↑{{ statusMap[row.node.ref?.name ?? ''].ahead }}
          </span>
          <span
            v-if="statusMap[row.node.ref?.name ?? '']?.behind"
            class="shrink-0 text-[10px]"
            :style="{ color: 'var(--badge-head-fg)' }"
            :title="`落后上游 ${statusMap[row.node.ref?.name ?? ''].behind} 个提交`"
          >
            ↓{{ statusMap[row.node.ref?.name ?? ''].behind }}
          </span>

          <span
            v-if="row.node.ref?.name === branch"
            class="ml-auto shrink-0 rounded px-1 text-[9px]"
            :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }"
          >
            当前
          </span>
          <span v-else-if="statusMap[row.node.ref?.name ?? '']" class="ml-auto flex shrink-0 items-center gap-1">
            <IconButton
              compact
              name="compare"
              title="与当前 HEAD 对比"
              :size="12"
              @click.stop="emit('compare', row.node.ref!.name)"
            />
          </span>
        </div>

      </div>
      </div>

      <!-- 远端分支树（按远端分组：origin > feature > x） -->
      <div v-if="remoteCount">
        <div class="flex items-center pr-2">
          <button
            class="flex flex-1 items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3"
            @click="open.remote = !open.remote"
          >
            <span class="text-[9px]">{{ open.remote ? '▾' : '▸' }}</span>
            远端分支
            <span class="ml-1 opacity-60">{{ remoteCount }}</span>
          </button>
          <IconButton compact name="settings" title="管理远端仓库（新增 / 改地址 / 删除）" :size="12" @click="emit('manage-remotes')" />
        </div>
        <div v-show="open.remote">
          <div
            v-for="row in remoteRows"
            :key="`r:${row.node.path}`"
            class="group flex w-full cursor-pointer items-center gap-1 py-[3px] text-[12px] row-hover"
            :style="rowStyle(row.depth, tip === row.node.ref?.name, !!row.node.ref)"
            :title="row.node.path"
            @click="onNode(row, 'remote')"
            @contextmenu="onCtx($event, row.node.ref)"
          >
            <span
              v-if="row.hasChildren"
              class="w-3 shrink-0 text-[9px] t3"
              @click="onArrow($event, row, 'remote')"
            >
              {{ row.expanded ? '▾' : '▸' }}
            </span>
            <span v-else class="w-3 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ row.node.seg }}</span>
            <span
              v-if="row.node.ref"
              class="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100"
            >
              <IconButton
                compact
                name="branch"
                title="签出为本地分支（自动建立跟踪）"
                :size="12"
                @click.stop="emit('checkout', row.node.ref!.name)"
              />
              <IconButton
                compact
                name="trash"
                title="删除远端分支"
                danger
                :size="12"
                @click.stop="emit('delete-remote', row.node.ref!.name)"
              />
            </span>
          </div>
        </div>
      </div>

      <!-- 标签树 -->
      <div v-if="tagCount">
        <div class="flex items-center pr-2">
          <button
            class="flex flex-1 items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3"
            @click="open.tag = !open.tag"
          >
            <span class="text-[9px]">{{ open.tag ? '▾' : '▸' }}</span>
            标签
            <span class="ml-1 opacity-60">{{ tagCount }}</span>
          </button>
          <button class="px-1 text-[12px] t3 hover:opacity-80" title="新建标签" @click="emit('create-tag')">＋</button>
        </div>
        <div v-show="open.tag">
          <div
            v-for="row in tagRows"
            :key="`t:${row.node.path}`"
            class="flex w-full cursor-pointer items-center gap-1 truncate py-[3px] text-[12px] row-hover"
            :style="rowStyle(row.depth, tip === row.node.ref?.name, !!row.node.ref)"
            :title="row.node.path"
            @click="onNode(row, 'tag')"
            @contextmenu="onCtx($event, row.node.ref)"
          >
            <span
              v-if="row.hasChildren"
              class="w-3 shrink-0 text-[9px] t3"
              @click="onArrow($event, row, 'tag')"
            >
              {{ row.expanded ? '▾' : '▸' }}
            </span>
            <span v-else class="w-3 shrink-0" />
            <span class="truncate">{{ row.node.seg }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

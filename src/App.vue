<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CommandOutput from './components/CommandOutput.vue'
import CommandPalette from './components/CommandPalette.vue'
import CommitList from './components/CommitList.vue'
import ConflictResolver from './components/ConflictResolver.vue'
import ContextMenu from './components/ContextMenu.vue'
import DetailPanel from './components/DetailPanel.vue'
import DiffView from './components/DiffView.vue'
import Icon from './components/Icon.vue'
import IconButton from './components/IconButton.vue'
import InputDialog from './components/InputDialog.vue'
import PatchModal from './components/PatchModal.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SidePanel from './components/SidePanel.vue'
import SnapshotPanel from './components/SnapshotPanel.vue'
import StashPanel from './components/StashPanel.vue'
import StatusBar from './components/StatusBar.vue'
import WorkingPanel from './components/WorkingPanel.vue'
import type { CommitRow, RepoRef } from './api/types'
import type { MenuItem } from './types/ui'
import { startupRepo } from './api/env'
import {
  closeWindow,
  hideToTray,
  isMaximized,
  isTauri,
  minimizeWindow,
  openExternal,
  startResize,
  toggleMaximize,
} from './api/desktop'
import type { ResizeDir } from './api/desktop'
import { APP_VERSION, REPO_URL } from './api/update'
import { useRepoStore } from './stores/repo'
import { useSettingsStore } from './stores/settings'
import { useUpdateStore } from './stores/update'

const repo = useRepoStore()
const settings = useSettingsStore()
const update = useUpdateStore()

const pathInput = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const showPalette = ref(false)
const showSettings = ref(false)
const leftTab = ref<'branches' | 'working' | 'stashes' | 'snapshots'>('branches')
const maximized = ref(false)

interface MenuSpec {
  x: number
  y: number
  items: MenuItem[]
  handler: (id: string) => void
}
const menu = ref<MenuSpec | null>(null)

interface PromptSpec {
  title: string
  label?: string
  placeholder?: string
  value?: string
  confirmText?: string
  secondLabel?: string
  secondPlaceholder?: string
  onSubmit: (value: string, second: string) => void
}
const prompt = ref<PromptSpec | null>(null)

async function open() {
  if (!pathInput.value.trim()) return
  await repo.open(pathInput.value)
  await repo.refreshStatus()
  const s = repo.status
  if (s && !s.clean) leftTab.value = 'working'
  await repo.loadRecents()
}

function openPath(p: string) {
  pathInput.value = p
  open()
}

const changeCount = computed(() => {
  const s = repo.status
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length
})

function switchTab(t: 'branches' | 'working' | 'stashes' | 'snapshots') {
  leftTab.value = t
  if (t === 'stashes') repo.loadStashes()
  if (t === 'snapshots') {
    repo.loadSnapshots()
    repo.loadReflog()
  }
}

/* ── 窗口控制 ── */
async function onMinimize() {
  if (settings.minimizeToTray) await hideToTray()
  else await minimizeWindow()
}

async function onMaximize() {
  maximized.value = await toggleMaximize()
}

async function onClose() {
  await closeWindow(settings.closeAction)
}

/* ── 快捷键 ── */
function onKey(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey

  if (ctrl && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    showPalette.value = true
    return
  }
  if (ctrl && e.key === ',') {
    e.preventDefault()
    showSettings.value = true
    return
  }
  if (ctrl && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    searchInput.value?.focus()
    return
  }
  if (e.key === 'Escape') {
    if (menu.value) menu.value = null
    else if (prompt.value) prompt.value = null
    else if (showPalette.value) showPalette.value = false
    else if (showSettings.value) showSettings.value = false
    else if (repo.commandOutput) repo.closeCommandOutput()
    else if (repo.stashDiff) repo.closeStashDiff()
    else if (repo.diffFile) repo.closeDiff()
    else if (repo.conflictFile) repo.closeConflict()
    else if (repo.search) repo.search = ''
    return
  }
  if (showPalette.value || showSettings.value || prompt.value || repo.diffFile || repo.conflictFile) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    repo.selectOffset(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    repo.selectOffset(-1)
  } else if (e.key === 'Enter' && repo.detail?.files.length) {
    e.preventDefault()
    repo.openFileDiff(repo.detail.files[0].path)
  }
}

/* ── 提交右键菜单 ── */
function onCommitContext({ row, x, y }: { row: CommitRow; x: number; y: number }) {
  const items: MenuItem[] = [
    { id: 'copy-sha', label: '复制 SHA', hint: row.short },
    { id: 'copy-summary', label: '复制提交说明' },
    { id: 'open-file', label: '查看变更文件', hint: 'Enter' },
  ]
  if (repo.originWeb) items.push({ id: 'open-web', label: '在远端打开仓库' })
  items.push(
    { id: 'divider1', label: '', divider: true },
    { id: 'new-branch', label: '在此提交上新建分支…' },
    { id: 'new-tag', label: '在此提交上新建标签…' },
    { id: 'focus-here', label: '只看此提交起的历史' },
  )

  menu.value = {
    x,
    y,
    items,
    handler: async (id) => {
      if (id === 'copy-sha') {
        await navigator.clipboard?.writeText(row.oid)
        repo.notify('ok', '已复制 SHA')
      } else if (id === 'copy-summary') {
        await navigator.clipboard?.writeText(row.summary)
        repo.notify('ok', '已复制提交说明')
      } else if (id === 'open-file') {
        if (repo.detail?.files.length) repo.openFileDiff(repo.detail.files[0].path)
        else repo.notify('info', '该提交没有文件变更')
      } else if (id === 'open-web') {
        void openExternal(repo.originWeb)
      } else if (id === 'new-branch') {
        openNewBranch(row.oid)
      } else if (id === 'new-tag') {
        openCreateTag(row.oid)
      } else if (id === 'focus-here') {
        repo.setTip(row.oid)
      }
    },
  }
}

/* ── 分支/标签右键菜单 ── */
function onRefContext({ ref, x, y }: { ref: RepoRef; x: number; y: number }) {
  const isTag = ref.kind === 'tag'
  const items: MenuItem[] = isTag
    ? [
        { id: 'delete-tag', label: '删除标签', danger: true },
        { id: 'copy-name', label: '复制名称' },
      ]
    : [
        { id: 'checkout', label: '检出此分支' },
        { id: 'merge', label: '合并到当前分支' },
        { id: 'divider', label: '', divider: true },
        { id: 'rename', label: '重命名…' },
        { id: 'delete', label: '删除分支', danger: true },
        { id: 'divider2', label: '', divider: true },
        { id: 'copy-name', label: '复制名称' },
      ]

  menu.value = {
    x,
    y,
    items,
    handler: async (id) => {
      if (id === 'checkout') await repo.checkoutRef(ref.name)
      else if (id === 'merge') await repo.mergeBranch(ref.name)
      else if (id === 'copy-name') {
        await navigator.clipboard?.writeText(ref.name)
        repo.notify('ok', '已复制名称')
      } else if (id === 'rename') {
        prompt.value = {
          title: '重命名分支',
          label: `当前名称：${ref.name}`,
          value: ref.name,
          confirmText: '重命名',
          onSubmit: (v) => repo.renameBranch(ref.name, v),
        }
      } else if (id === 'delete') {
        if (!window.confirm(`确定删除分支 ${ref.name}？\n（会先自动打安全网快照）`)) return
        await repo.deleteBranch(ref.name)
      } else if (id === 'delete-tag') {
        if (!window.confirm(`确定删除标签 ${ref.name}？`)) return
        await repo.deleteTag(ref.name)
      }
    },
  }
}

/* ── 弹窗流程 ── */
function openNewBranch(from: string) {
  prompt.value = {
    title: '新建分支',
    label: '分支名（将从该提交拉出并切换）',
    placeholder: 'feature/my-branch',
    confirmText: '创建分支',
    onSubmit: (name) => repo.createBranch(name, from),
  }
}

function openCreateTag(oid?: string) {
  prompt.value = {
    title: '新建标签',
    label: '标签名（如 v1.0.0）',
    placeholder: 'v1.0.0',
    secondLabel: '说明（留空则为轻量标签）',
    secondPlaceholder: 'release 1.0.0',
    confirmText: '创建标签',
    onSubmit: (name, message) => repo.createTag(name, message || undefined, oid ?? repo.selected?.oid),
  }
}

function openCreateStash() {
  prompt.value = {
    title: '新建暂存',
    label: '描述',
    placeholder: 'wip: 正在改登录',
    confirmText: '创建暂存',
    onSubmit: (message) => repo.createStash(message),
  }
}

async function submitPrompt(value: string, second: string) {
  const p = prompt.value
  prompt.value = null
  await p?.onSubmit(value, second)
}

/* ── 主题 ── */
const themeOrder = ['dark', 'midnight', 'light', 'contrast'] as const
function cycleTheme() {
  const i = themeOrder.indexOf(settings.theme as (typeof themeOrder)[number])
  settings.setTheme(themeOrder[(i + 1) % themeOrder.length])
}

const noticeClass = computed(() => {
  switch (repo.notice?.kind) {
    case 'ok':
      return { background: 'var(--badge-head-bg)', color: 'var(--badge-head-fg)' }
    case 'err':
      return { background: 'var(--badge-tag-bg)', color: 'var(--badge-tag-fg)' }
    default:
      return { background: 'var(--panel-3)', color: 'var(--text)' }
  }
})

onMounted(async () => {
  settings.init()
  window.addEventListener('keydown', onKey)
  void repo.loadRecents()
  maximized.value = await isMaximized()

  if (settings.autoCheckUpdate) {
    void update.check().then(() => {
      if (update.phase === 'available') {
        if (settings.autoInstallUpdate) {
          void update.install()
        } else {
          repo.notify('info', `发现新版本 v${update.version}，点击顶部提示一键更新`)
        }
      }
    })
  }

  const cliRepo = await startupRepo()
  if (cliRepo) {
    pathInput.value = cliRepo
    await open()
    return
  }

  const params = new URLSearchParams(location.search)
  const repoParam = params.get('repo')
  const fileParam = params.get('file')
  if (repoParam) {
    pathInput.value = repoParam
    open().then(() => {
      if (fileParam) repo.openFileDiff(fileParam)
    })
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex h-screen flex-col" :style="{ background: 'var(--bg)', color: 'var(--text)' }">
    <!-- 自绘标题栏：既能拖拽，也是应用主工具条 -->
    <header
      class="line-b flex h-11 shrink-0 items-center gap-2 overflow-hidden px-3"
      :style="{ background: 'var(--panel)' }"
      data-tauri-drag-region
    >
      <div class="mr-1 flex shrink-0 items-center gap-2" data-tauri-drag-region>
        <div class="h-4 w-4 rounded bg-gradient-to-br from-sky-400 to-violet-500" />
        <span class="text-[13px] font-semibold t1">GitPanel</span>
      </div>

      <input
        v-model="pathInput"
        class="field min-w-0 max-w-[300px] flex-1 px-2 py-1 font-mono text-[12px]"
        placeholder="仓库路径，例如 F:\\gitlab\\myrepo"
        @keydown.enter="open"
      />
      <button class="btn btn-primary shrink-0" @click="open">打开</button>

      <div class="relative hidden shrink-0 lg:block">
        <input
          ref="searchInput"
          v-model="repo.search"
          class="field w-[160px] py-1 pl-7 pr-2 text-[12px]"
          placeholder="搜索提交 / 作者"
        />
        <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] t3">⌕</span>
      </div>

      <span v-if="repo.error" class="min-w-0 max-w-[180px] shrink truncate text-[11px] text-rose-400" :title="repo.error">
        {{ repo.error }}
      </span>

      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          v-if="update.hasUpdate || update.phase === 'downloading' || update.phase === 'installing'"
          class="mr-1 rounded px-1.5 py-0.5 text-[11px]"
          :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }"
          :title="update.phase === 'available' ? `点击更新到 v${update.version}` : update.message || '正在更新'"
          @click="update.install()"
        >
          <template v-if="update.phase === 'available'">↑ 更新 v{{ update.version }}</template>
          <template v-else-if="update.phase === 'downloading'">下载 {{ update.percent }}%</template>
          <template v-else>安装中…</template>
        </button>

        <IconButton name="fetch" title="Fetch：抓取远端更新" :disabled="!!repo.syncing" @click="repo.sync('fetch')" />
        <IconButton name="pull" :title="`Pull：拉取并合并${repo.status?.behind ? `（落后 ${repo.status.behind}）` : ''}`" :disabled="!!repo.syncing" @click="repo.sync('pull')" />
        <IconButton name="push" :title="`Push：推送到远端${repo.status?.ahead ? `（领先 ${repo.status.ahead}）` : ''}`" :disabled="!!repo.syncing" @click="repo.sync('push')" />

        <span class="mx-1 h-4 w-px" :style="{ background: 'var(--border)' }" />

        <IconButton name="command" title="命令面板 (Ctrl+K)" @click="showPalette = true" />
        <IconButton name="theme" :title="`主题：${settings.themeLabel}`" @click="cycleTheme" />
        <IconButton name="github" title="打开 GitHub 仓库" @click="openExternal(REPO_URL)" />
        <IconButton name="settings" title="设置 (Ctrl+,)" @click="showSettings = true" />

        <template v-if="isTauri">
          <span class="mx-1 h-4 w-px" :style="{ background: 'var(--border)' }" />
          <IconButton name="minus" :title="settings.minimizeToTray ? '最小化到托盘' : '最小化'" @click="onMinimize" />
          <IconButton :name="maximized ? 'restore' : 'maximize'" :title="maximized ? '还原' : '最大化'" @click="onMaximize" />
          <IconButton name="close" title="关闭" danger @click="onClose" />
        </template>
      </div>
    </header>

    <main v-if="repo.info" class="flex min-h-0 flex-1">
      <div class="flex h-full w-[240px] shrink-0 flex-col" :style="{ borderRight: '1px solid var(--border)' }">
        <div class="flex shrink-0 items-center" :style="{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }">
          <button
            v-for="t in (['branches', 'working', 'stashes', 'snapshots'] as const)"
            :key="t"
            class="flex-1 px-1 py-1.5 text-[11px]"
            :style="
              leftTab === t
                ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
                : { color: 'var(--text-mute)' }
            "
            @click="switchTab(t)"
          >
            {{ t === 'branches' ? '分支' : t === 'working' ? '工作区' : t === 'stashes' ? '暂存' : '安全网' }}
            <span v-if="t === 'working' && changeCount" class="ml-0.5" :style="{ color: 'var(--accent)' }">{{ changeCount }}</span>
            <span v-else-if="t === 'stashes' && repo.stashes.length" class="ml-0.5 t3">{{ repo.stashes.length }}</span>
          </button>
        </div>

        <SidePanel
          v-if="leftTab === 'branches'"
          class="min-h-0 flex-1"
          :refs="repo.info.refs"
          :branch="repo.info.branch"
          :tip="repo.tip"
          :name="repo.info.name"
          @filter="repo.setTip($event)"
          @context="onRefContext"
          @create-tag="openCreateTag()"
        />
        <WorkingPanel
          v-else-if="leftTab === 'working'"
          class="min-h-0 flex-1"
          @conflict="repo.openConflict($event)"
        />
        <StashPanel v-else-if="leftTab === 'stashes'" class="min-h-0 flex-1" @create="openCreateStash" />
        <SnapshotPanel v-else class="min-h-0 flex-1" />
      </div>

      <CommitList
        class="min-w-0 flex-1"
        :rows="repo.filteredRows"
        :selected-oid="repo.selected?.oid"
        :loading="repo.loading"
        @select="repo.select($event)"
        @load-more="repo.loadMore()"
        @context="onCommitContext"
      />
      <DetailPanel
        :detail="repo.detail"
        :loading="repo.detailLoading"
        @open-file="repo.openFileDiff($event)"
      />
    </main>

    <main v-else class="flex min-h-0 flex-1">
      <div class="m-auto w-[560px] max-w-full px-6">
        <div class="mb-1 text-center text-[15px] font-semibold t1">打开一个 Git 仓库</div>
        <div class="mb-5 text-center text-[12px] t3">本地运行，不联网，不上传任何数据</div>

        <div v-if="repo.recents.length" class="mb-4">
          <div class="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide t3">最近打开</div>
          <div
            v-for="r in repo.recents"
            :key="r.path"
            class="row-hover group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
            @click="openPath(r.path)"
          >
            <Icon name="folder" :size="14" class="shrink-0 t3" />
            <span class="shrink-0 text-[12px] t1">{{ r.name }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[11px] t3">{{ r.path }}</span>
            <IconButton
              name="pin"
              :title="r.pinned ? '取消置顶' : '置顶'"
              :active="r.pinned"
              :size="13"
              @click.stop="repo.pinRecent(r.path, !r.pinned)"
            />
            <IconButton
              name="trash"
              title="从列表移除"
              :size="13"
              danger
              @click.stop="repo.forget(r.path)"
            />
          </div>
        </div>

        <div class="mt-6 text-center text-[11px] t3">
          Ctrl+K 命令面板 · Ctrl+, 设置 · Ctrl+F 搜索 · v{{ APP_VERSION }}
        </div>
      </div>
    </main>

    <StatusBar />

    <!-- 无边框窗口的缩放手柄 -->
    <div v-if="isTauri" class="resize-layer" aria-hidden="true">
      <div
        v-for="dir in ([
          ['North', 'rh-n'],
          ['South', 'rh-s'],
          ['East', 'rh-e'],
          ['West', 'rh-w'],
          ['NorthEast', 'rh-ne'],
          ['NorthWest', 'rh-nw'],
          ['SouthEast', 'rh-se'],
          ['SouthWest', 'rh-sw'],
        ] as [ResizeDir, string][])"
        :key="dir[0]"
        class="rh"
        :class="dir[1]"
        @pointerdown.prevent="startResize(dir[0])"
      />
    </div>

    <!-- 浮层 -->
    <ConflictResolver v-if="repo.conflictFile" />
    <DiffView
      v-if="repo.diffFile"
      :file="repo.diffFile"
      :diff="repo.diff"
      :loading="repo.diffLoading"
      @close="repo.closeDiff()"
    />
    <PatchModal />
    <CommandPalette v-if="showPalette" @close="showPalette = false" @settings="showSettings = true" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      @select="(id) => { const h = menu?.handler; menu = null; h?.(id) }"
      @close="menu = null"
    />
    <InputDialog
      v-if="prompt"
      :title="prompt.title"
      :label="prompt.label"
      :placeholder="prompt.placeholder"
      :value="prompt.value"
      :confirm-text="prompt.confirmText"
      :second-label="prompt.secondLabel"
      :second-placeholder="prompt.secondPlaceholder"
      @confirm="submitPrompt"
      @close="prompt = null"
    />
    <CommandOutput />

    <transition name="fade">
      <div
        v-if="repo.notice"
        class="fixed bottom-12 right-4 z-[60] rounded-lg px-3 py-2 text-[12px] shadow-lg"
        :style="noticeClass"
      >
        {{ repo.notice.text }}
      </div>
    </transition>
  </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 无边框窗口：8 个方向的缩放手柄 */
.resize-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 70;
}
.resize-layer .rh {
  position: absolute;
  pointer-events: auto;
}
.rh-n {
  top: 0;
  left: 8px;
  right: 8px;
  height: 4px;
  cursor: ns-resize;
}
.rh-s {
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 4px;
  cursor: ns-resize;
}
.rh-e {
  top: 8px;
  bottom: 8px;
  right: 0;
  width: 4px;
  cursor: ew-resize;
}
.rh-w {
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 4px;
  cursor: ew-resize;
}
.rh-ne {
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  cursor: nesw-resize;
}
.rh-nw {
  top: 0;
  left: 0;
  width: 8px;
  height: 8px;
  cursor: nwse-resize;
}
.rh-se {
  bottom: 0;
  right: 0;
  width: 8px;
  height: 8px;
  cursor: nwse-resize;
}
.rh-sw {
  bottom: 0;
  left: 0;
  width: 8px;
  height: 8px;
  cursor: nesw-resize;
}
</style>

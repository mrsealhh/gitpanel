<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CommandOutput from './components/CommandOutput.vue'
import CommandPalette from './components/CommandPalette.vue'
import CommitList from './components/CommitList.vue'
import ContextMenu from './components/ContextMenu.vue'
import DetailPanel from './components/DetailPanel.vue'
import DiffView from './components/DiffView.vue'
import InputDialog from './components/InputDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SidePanel from './components/SidePanel.vue'
import StatusBar from './components/StatusBar.vue'
import type { CommitRow } from './api/types'
import type { MenuItem } from './types/ui'
import { useRepoStore } from './stores/repo'
import { useSettingsStore } from './stores/settings'

const repo = useRepoStore()
const settings = useSettingsStore()

const pathInput = ref('F:\\gitlab\\gitpanel')
const searchInput = ref<HTMLInputElement | null>(null)
const showPalette = ref(false)
const showSettings = ref(false)
const menu = ref<{ x: number; y: number; row: CommitRow; items: MenuItem[] } | null>(null)
const branchDialog = ref<{ from: string } | null>(null)

async function open() {
  await repo.open(pathInput.value)
}

/* ── 命令/快捷键 ── */
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
    else if (showPalette.value) showPalette.value = false
    else if (showSettings.value) showSettings.value = false
    else if (branchDialog.value) branchDialog.value = null
    else if (repo.commandOutput) repo.closeCommandOutput()
    else if (repo.diffFile) repo.closeDiff()
    else if (repo.search) repo.search = ''
    return
  }
  if (showPalette.value || showSettings.value || branchDialog.value || repo.diffFile) return

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
function onContext({ row, x, y }: { row: CommitRow; x: number; y: number }) {
  const items: MenuItem[] = [
    { id: 'copy-sha', label: '复制 SHA', hint: row.short },
    { id: 'copy-summary', label: '复制提交说明' },
    { id: 'open-file', label: '查看变更文件', hint: 'Enter' },
  ]
  if (repo.originWeb) items.push({ id: 'open-web', label: '在远端打开仓库' })
  items.push(
    { id: 'divider1', label: '', divider: true },
    { id: 'new-branch', label: '在此提交上新建分支…' },
    { id: 'focus-here', label: '只看此提交起的历史' },
  )
  menu.value = { x, y, row, items }
}

async function onMenuSelect(id: string) {
  const row = menu.value?.row
  menu.value = null
  if (!row) return
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
    window.open(repo.originWeb, '_blank')
  } else if (id === 'new-branch') {
    branchDialog.value = { from: row.oid }
  } else if (id === 'focus-here') {
    repo.setTip(row.oid)
  }
}

async function confirmBranch(name: string) {
  const from = branchDialog.value?.from
  branchDialog.value = null
  await repo.createBranch(name, from)
}

/* ── 主题快速切换 ── */
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

onMounted(() => {
  settings.init()
  window.addEventListener('keydown', onKey)

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
    <header class="line-b flex h-11 shrink-0 items-center gap-2 px-3" :style="{ background: 'var(--panel)' }">
      <div class="mr-1 flex items-center gap-2">
        <div class="h-4 w-4 rounded bg-gradient-to-br from-sky-400 to-violet-500" />
        <span class="text-[13px] font-semibold t1">GitPanel</span>
      </div>

      <input
        v-model="pathInput"
        class="field w-[320px] px-2 py-1 font-mono text-[12px]"
        placeholder="仓库路径，例如 F:\\gitlab\\myrepo"
        @keydown.enter="open"
      />
      <button class="btn btn-primary" @click="open">打开</button>

      <div class="relative ml-2">
        <input
          ref="searchInput"
          v-model="repo.search"
          class="field w-[200px] py-1 pl-7 pr-2 text-[12px]"
          placeholder="搜索提交 / 作者"
        />
        <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] t3">⌕</span>
      </div>

      <button class="btn ml-auto" title="命令面板 Ctrl+K" @click="showPalette = true">⌘ 命令</button>
      <button class="btn" title="切换主题" @click="cycleTheme">{{ settings.themeLabel }}</button>
      <button class="btn" title="设置 Ctrl+," @click="showSettings = true">设置</button>

      <span v-if="repo.loading" class="text-[11px] t3">加载中…</span>
      <span v-if="repo.error" class="max-w-[220px] truncate text-[11px] text-rose-400">{{ repo.error }}</span>
    </header>

    <main v-if="repo.info" class="flex min-h-0 flex-1">
      <SidePanel
        :refs="repo.info.refs"
        :branch="repo.info.branch"
        :tip="repo.tip"
        :name="repo.info.name"
        @filter="repo.setTip($event)"
      />
      <CommitList
        class="min-w-0 flex-1"
        :rows="repo.filteredRows"
        :selected-oid="repo.selected?.oid"
        :loading="repo.loading"
        @select="repo.select($event)"
        @load-more="repo.loadMore()"
        @context="onContext"
      />
      <DetailPanel
        :detail="repo.detail"
        :loading="repo.detailLoading"
        @open-file="repo.openFileDiff($event)"
      />
    </main>

    <main v-else class="flex min-h-0 flex-1">
      <div class="m-auto w-[520px] max-w-full px-6 text-center">
        <div class="mb-1 text-[15px] font-semibold t1">打开一个 Git 仓库</div>
        <div class="mb-6 text-[12px] t3">本地运行，不联网，不上传任何数据</div>
        <div class="space-y-1 text-left">
          <button
            v-for="p in repo.recent"
            :key="p"
            class="row-hover block w-full truncate rounded border px-3 py-2 text-left font-mono text-[12px] t2"
            :style="{ borderColor: 'var(--border)' }"
            @click="pathInput = p; open()"
          >
            {{ p }}
          </button>
        </div>
        <div class="mt-6 text-[11px] t3">Ctrl+K 命令面板 · Ctrl+, 设置 · Ctrl+F 搜索</div>
      </div>
    </main>

    <StatusBar />

    <!-- 浮层 -->
    <DiffView
      v-if="repo.diffFile"
      :file="repo.diffFile"
      :diff="repo.diff"
      :loading="repo.diffLoading"
      @close="repo.closeDiff()"
    />
    <CommandPalette
      v-if="showPalette"
      @close="showPalette = false"
      @settings="showSettings = true"
    />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      @select="onMenuSelect"
      @close="menu = null"
    />
    <InputDialog
      v-if="branchDialog"
      title="新建分支"
      label="分支名（将从该提交拉出并切换）"
      placeholder="feature/my-branch"
      confirm-text="创建分支"
      @confirm="confirmBranch"
      @close="branchDialog = null"
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
</style>

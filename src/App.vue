<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CommandOutput from './components/CommandOutput.vue'
import CommandPalette from './components/CommandPalette.vue'
import CommitList from './components/CommitList.vue'
import ConflictResolver from './components/ConflictResolver.vue'
import ContextMenu from './components/ContextMenu.vue'
import DetailPanel from './components/DetailPanel.vue'
import DiffView from './components/DiffView.vue'
import BlameModal from './components/BlameModal.vue'
import CloneDialog from './components/CloneDialog.vue'
import DashboardModal from './components/DashboardModal.vue'
import FileHistoryModal from './components/FileHistoryModal.vue'
import FileEditor from './components/FileEditor.vue'
import FilePanel from './components/FilePanel.vue'
import HealthModal from './components/HealthModal.vue'
import HistorySearchModal from './components/HistorySearchModal.vue'
import ProjectSwitcher from './components/ProjectSwitcher.vue'
import CompareList from './components/CompareList.vue'
import HunkDialog from './components/HunkDialog.vue'
import LogModal from './components/LogModal.vue'
import WorktreeDialog from './components/WorktreeDialog.vue'
import Icon from './components/Icon.vue'
import IconButton from './components/IconButton.vue'
import InputDialog from './components/InputDialog.vue'
import PatchModal from './components/PatchModal.vue'
import RebaseDialog from './components/RebaseDialog.vue'
import RemoteDialog from './components/RemoteDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SidePanel from './components/SidePanel.vue'
import SnapshotPanel from './components/SnapshotPanel.vue'
import StashPanel from './components/StashPanel.vue'
import StatusBar from './components/StatusBar.vue'
import WorkingPanel from './components/WorkingPanel.vue'
import WorktreePanel from './components/WorktreePanel.vue'
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
  pickFolder,
  startResize,
  toggleMaximize,
} from './api/desktop'
import type { ResizeDir } from './api/desktop'
import { APP_VERSION, REPO_URL } from './api/update'
import { copyText } from './lib/clipboard'
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
const leftTab = ref<'branches' | 'stashes' | 'snapshots' | 'worktrees'>('branches')
/** 右侧面板：变动详情 / 项目文件；变动详情默认不显示，点提交行才出现，可关闭 */
const rightTab = ref<'detail' | 'files'>('files')
const detailTabOpen = ref(false)
const maximized = ref(false)
const diffFullscreen = ref(false)
const showWorktreeDialog = ref(false)
const showRemotes = ref(false)
const showDashboard = ref(false)
const showClone = ref(false)
const cloneUrl = ref('')
const showHunks = ref<{ file: string; staged: boolean } | null>(null)
const showDate = ref(false)
const dateBtn = ref<HTMLElement | null>(null)
const dateRoot = ref<HTMLElement | null>(null)
const datePos = ref({ right: 8, top: 0 })
/** 日期弹窗里的草稿：点「应用」才真正生效，点「关闭」放弃 */
const dateDraft = ref({ from: '', to: '' })

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 预设只改草稿，点「应用」才生效 */
function setDateRange(preset: 'today' | 'yesterday' | '3d' | '7d' | 'clear') {
  const now = new Date()
  if (preset === 'clear') {
    dateDraft.value = { from: '', to: '' }
    return
  }
  const from = new Date(now)
  if (preset === 'yesterday') {
    from.setDate(now.getDate() - 1)
    dateDraft.value = { from: ymd(from), to: ymd(from) }
    return
  }
  if (preset === '3d') from.setDate(now.getDate() - 2)
  if (preset === '7d') from.setDate(now.getDate() - 6)
  dateDraft.value = { from: ymd(from), to: ymd(now) }
}

const dateLabel = computed(() => {
  if (!repo.dateFrom && !repo.dateTo) return '按提交日期筛选'
  const from = repo.dateFrom || '…'
  const to = repo.dateTo || '…'
  return `日期范围：${from} ~ ${to}（点击修改）`
})

function applyDate() {
  repo.dateFrom = dateDraft.value.from
  repo.dateTo = dateDraft.value.to
  showDate.value = false
  if (repo.dateFrom || repo.dateTo) {
    repo.notify('ok', `已筛选 ${repo.dateFrom || '…'} ~ ${repo.dateTo || '…'}`)
  } else {
    repo.notify('info', '已清除日期筛选')
  }
}

function clearDate() {
  dateDraft.value = { from: '', to: '' }
  repo.dateFrom = ''
  repo.dateTo = ''
  showDate.value = false
}

/** 原生文件夹选择；浏览器态提示手输 */
async function browseFolder() {
  const dir = await pickFolder('选择 Git 仓库目录')
  if (dir) {
    pathInput.value = dir
    await open()
  } else if (!isTauri) {
    repo.notify('info', '浏览器模式不支持系统文件夹选择，请用项目下拉里的地址克隆')
  }
}

/** 从项目下拉里粘贴地址 → 打开克隆框（地址已填好） */
function onCloneFromUrl(url: string) {
  cloneUrl.value = url
  showClone.value = true
}

/** 日期筛选浮层：用 fixed 定位，避免被标题栏裁剪 */
function toggleDate() {
  if (!showDate.value) {
    dateDraft.value = { from: repo.dateFrom, to: repo.dateTo }
    const r = dateBtn.value?.getBoundingClientRect()
    if (r) datePos.value = { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 }
  }
  showDate.value = !showDate.value
}

function onDocMouseDown(e: MouseEvent) {
  if (!showDate.value) return
  if (dateRoot.value && !dateRoot.value.contains(e.target as Node)) showDate.value = false
}

function onRenameProject(path: string) {
  const current = repo.recents.find((r) => r.path === path)
  prompt.value = {
    title: '重命名项目',
    label: '显示名称（全局唯一，重名会自动补 1/2/3）',
    value: current?.alias || current?.name || '',
    confirmText: '保存',
    onSubmit: (name) => repo.renameProject(path, name),
  }
}

const identityMissing = computed(
  () => !!repo.info && !repo.identity.email && !repo.identityDismissed,
)

/** 文档标签栏：编辑器 + diff 合并成一排，可横向滚动 */
const docTabs = computed(() =>
  [
    ...repo.editorTabs.map((t) => ({
      key: `f:${t.file}`,
      kind: 'file' as const,
      label: t.file.split('/').pop() || t.file,
      title: t.file,
      dirty: t.content !== t.saved,
    })),
    ...repo.diffTabs.map((t) => ({
      key: `d:${t.key}`,
      kind: 'diff' as const,
      label: t.file.split('/').pop() || t.file,
      title: `${t.file} · ${diffKindLabel(t.kind)}`,
      dirty: false,
    })),
  ].sort((a, b) => (a.key < b.key ? -1 : 1)),
)

function diffKindLabel(kind: string) {
  if (kind === 'worktree') return '工作区改动'
  if (kind === 'compare') return '提交对比'
  return '提交改动'
}

const activeEditorTab = computed(
  () => repo.editorTabs.find((t) => repo.activeTab === `f:${t.file}`) ?? null,
)
const activeDiffTab = computed(
  () => repo.diffTabs.find((t) => repo.activeTab === `d:${t.key}`) ?? null,
)

function closeTab(key: string) {
  if (key.startsWith('d:')) repo.closeDiffTab(key.slice(2))
  else repo.closeEditorTab(key.slice(2))
  if (!repo.activeTab) diffFullscreen.value = false
}

function closeActiveDoc() {
  closeTab(repo.activeTab)
}

/** 「只看…的历史」条上显示的简短标签 */const tipLabel = computed(() => {
  const t = repo.tip
  if (!t) return ''
  if (/^[0-9a-f]{7,40}$/i.test(t)) return t.slice(0, 7)
  if (t.length > 40) return `${t.slice(0, 37)}…`
  return t
})

/** 底部工作区拖拽调高 */
function startDockDrag(e: PointerEvent) {
  e.preventDefault()
  const startY = e.clientY
  const startH = settings.workDockHeight
  const onMove = (ev: PointerEvent) => {
    const next = startH - (ev.clientY - startY)
    settings.workDockHeight = Math.round(Math.min(window.innerHeight * 0.7, Math.max(140, next)))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    settings.save()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** 内部客户端工具：禁用浏览器默认右键菜单，避免暴露「检查/另存为」这类入口 */
function blockContextMenu(e: MouseEvent) {
  e.preventDefault()
}

/* ── 面板宽度拖拽 ── */
function startDrag(side: 'left' | 'right', e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = side === 'left' ? settings.leftWidth : settings.rightWidth

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    if (side === 'left') {
      settings.leftWidth = Math.min(520, Math.max(170, startW + dx))
    } else {
      settings.rightWidth = Math.min(620, Math.max(240, startW - dx))
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    settings.save()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

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
  detailTabOpen.value = false
  rightTab.value = 'files'
  await repo.open(pathInput.value)
  await repo.refreshStatus()
  const s = repo.status
  if (s && !s.clean) settings.workDockOpen = true
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

/** 左侧页签上的数字角标 */
function tabBadge(t: 'branches' | 'stashes' | 'snapshots' | 'worktrees'): number {
  if (t === 'stashes') return repo.stashes.length
  if (t === 'worktrees') return repo.worktrees.length
  if (t === 'snapshots') return repo.snapshots.length
  return 0
}

function switchTab(t: 'branches' | 'stashes' | 'snapshots' | 'worktrees') {
  leftTab.value = t
  if (t === 'stashes') repo.loadStashes()
  if (t === 'worktrees') repo.loadWorktrees()
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
  if (e.defaultPrevented) return
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
    else if (repo.rebaseOpen) repo.closeRebase()
    else if (repo.fileHistoryFile) repo.closeFileHistory()
    else if (repo.blameFile) repo.closeBlame()
    else if (repo.health) repo.closeHealth()
    else if (showDashboard.value) showDashboard.value = false
    else if (showClone.value) showClone.value = false
    else if (showDate.value) showDate.value = false
    else if (showHunks.value) showHunks.value = null
    else if (repo.logOpen) repo.logOpen = false
    else if (repo.compareOpen) repo.closeCompare()
    else if (showWorktreeDialog.value) showWorktreeDialog.value = false
    else if (repo.commandOutput) repo.closeCommandOutput()
    else if (repo.stashDiff) repo.closeStashDiff()
    else if (repo.activeTab) closeActiveDoc()
    else if (repo.conflictFile) repo.closeConflict()
    else if (repo.tip) repo.setTip('')
    else if (repo.search) repo.search = ''
    return
  }
  if (showPalette.value || showSettings.value || prompt.value || repo.activeTab || repo.conflictFile) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    openDetailTab()
    repo.selectOffset(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    openDetailTab()
    repo.selectOffset(-1)
  } else if (e.key === 'Enter' && repo.detail?.files.length) {
    e.preventDefault()
    repo.openFileDiff(repo.detail.files[0].path)
  }
}

/** 变动详情改成按需出现的动态标签：点提交行 / 用方向键切换时才打开 */
function openDetailTab() {
  detailTabOpen.value = true
  rightTab.value = 'detail'
}

function closeDetailTab() {
  detailTabOpen.value = false
  if (rightTab.value === 'detail') rightTab.value = 'files'
}

function onSelectCommit(row: CommitRow) {
  openDetailTab()
  repo.select(row)
}

async function onHistoryHit(oid: string) {
  openDetailTab()
  await repo.focusCommit(oid)
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
    { id: 'divider3', label: '', divider: true },
    { id: 'compare-base', label: '设为对比起点' },
  )
  if (repo.compareBase && repo.compareBase !== row.oid) {
    items.push({ id: 'compare-with', label: `与 ${repo.compareBase.slice(0, 7)} 对比` })
  }
  items.push(
    { id: 'divider2', label: '', divider: true },
    { id: 'cherry-pick', label: 'Cherry-pick 到当前分支' },
    { id: 'revert', label: '撤销此提交（revert）' },
  )

  menu.value = {
    x,
    y,
    items,
    handler: async (id) => {
      if (id === 'copy-sha') {
        const ok = await copyText(row.oid)
        repo.notify(ok ? 'ok' : 'err', ok ? '已复制 SHA' : '复制失败')
      } else if (id === 'copy-summary') {
        const ok = await copyText(row.summary)
        repo.notify(ok ? 'ok' : 'err', ok ? '已复制提交说明' : '复制失败')
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
      } else if (id === 'compare-base') {
        repo.setCompareBase(row.oid)
      } else if (id === 'compare-with') {
        await repo.openCompare(row.oid)
      } else if (id === 'cherry-pick') {
        if (settings.confirmDangerous) {
          prompt.value = {
            title: 'Cherry-pick 到当前分支',
            label: `把 ${row.short}「${row.summary}」摘到当前分支？`,
            confirmText: '开始 cherry-pick',
            onSubmit: () => repo.cherryPick(row.oid),
          }
        } else {
          void repo.cherryPick(row.oid)
        }
      } else if (id === 'revert') {
        if (settings.confirmDangerous) {
          prompt.value = {
            title: '撤销此提交（revert）',
            label: `会生成一个反向提交，抵消 ${row.short} 的改动`,
            confirmText: '生成反向提交',
            onSubmit: () => repo.revertCommit(row.oid),
          }
        } else {
          void repo.revertCommit(row.oid)
        }
      }
    },
  }
}

/* ── 分支/标签右键菜单 ── */
function onCheckoutRef(name: string) {
  void repo.checkoutRef(name)
}

function onDeleteRemoteBranch(name: string) {
  if (settings.confirmDangerous && !window.confirm(`确定删除远端分支 ${name}？\n会执行 git push --delete，远端分支将消失。`)) return
  void repo.deleteRemoteBranch(name)
}

function onRefContext({ ref, x, y }: { ref: RepoRef; x: number; y: number }) {
  const isTag = ref.kind === 'tag'
  const isRemote = ref.kind === 'remote'
  const items: MenuItem[] = isTag
    ? [
        { id: 'delete-tag', label: '删除标签', danger: true },
        { id: 'copy-name', label: '复制名称' },
      ]
    : isRemote
      ? [
          { id: 'checkout', label: '签出为本地分支（自动跟踪）' },
          { id: 'compare', label: '与当前 HEAD 对比' },
          { id: 'divider', label: '', divider: true },
          { id: 'fetch', label: '抓取所有远端（fetch）' },
          { id: 'delete-remote', label: '删除远端分支…', danger: true },
          { id: 'divider2', label: '', divider: true },
          { id: 'copy-name', label: '复制名称' },
        ]
      : [
          { id: 'checkout', label: '检出此分支' },
          { id: 'merge', label: '合并到当前分支' },
          { id: 'rebase-onto', label: '交互式 rebase 到此分支' },
          { id: 'divider', label: '', divider: true },
          { id: 'fetch', label: '抓取所有远端（fetch）' },
          { id: 'pull', label: '拉取当前分支（pull）' },
          { id: 'push', label: '推送当前分支（push）' },
          { id: 'divider3', label: '', divider: true },
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
      else if (id === 'compare') await repo.openCompare(ref.name, 'HEAD')
      else if (id === 'delete-remote') {
        if (settings.confirmDangerous && !window.confirm(`确定删除远端分支 ${ref.name}？\n会执行 git push --delete。`)) return
        await repo.deleteRemoteBranch(ref.name)
      } else if (id === 'merge') await repo.mergeBranch(ref.name)
      else if (id === 'rebase-onto') await repo.openRebase(ref.name)
      else if (id === 'fetch') await repo.sync('fetch')
      else if (id === 'pull') await repo.sync('pull')
      else if (id === 'push') await repo.sync('push')
      else if (id === 'copy-name') {
        const ok = await copyText(ref.name)
        repo.notify(ok ? 'ok' : 'err', ok ? '已复制名称' : '复制失败')
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
        const hasRemote = (repo.branchStatus.find((b) => b.name === ref.name)?.upstream ?? '') !== ''
        if (
          hasRemote &&
          window.confirm(`是否同时删除远端分支 ${ref.name}？\n这会执行 git push <remote> --delete ${ref.name}`)
        ) {
          await repo.deleteRemoteBranch(ref.name)
        }
      } else if (id === 'delete-tag') {
        if (!window.confirm(`确定删除标签 ${ref.name}？`)) return
        await repo.deleteTag(ref.name)
      }
    },
  }
}

/* ── 文件右键菜单 ── */
function absRepoPath(file: string) {
  const base = (repo.path || '').replace(/[\\/]+$/, '')
  const rel = file.replace(/\\/g, '/').replace(/^\/+/, '')
  return rel ? `${base}/${rel}` : base
}

function absDirPath(file: string, isDir = false) {
  const rel = file.replace(/\\/g, '/')
  if (isDir) return absRepoPath(rel)
  const i = rel.lastIndexOf('/')
  return absRepoPath(i >= 0 ? rel.slice(0, i) : '')
}

async function copyLabeledPath(text: string, label: string) {
  const ok = await copyText(text)
  repo.notify(ok ? 'ok' : 'err', ok ? `已复制${label}` : '复制失败')
}

function onFileContext({ file, x, y, isDir = false }: { file: string; x: number; y: number; isDir?: boolean }) {
  const items: MenuItem[] = isDir
    ? [
        { id: 'copy-abs', label: '复制目录路径' },
        { id: 'copy-rel', label: '复制相对路径' },
      ]
    : [
        { id: 'diff', label: '查看并排 Diff' },
        { id: 'history', label: '文件历史' },
        { id: 'blame', label: 'Blame（逐行归属）' },
        { id: 'divider', label: '', divider: true },
        { id: 'copy-rel', label: '复制文件路径（相对）' },
        { id: 'copy-abs', label: '复制绝对路径' },
        { id: 'copy-dir', label: '复制目录路径' },
        { id: 'divider2', label: '', divider: true },
        { id: 'ignore', label: '忽略此文件（加入 .gitignore）' },
      ]

  menu.value = {
    x,
    y,
    items,
    handler: async (id) => {
      if (id === 'diff') await repo.openFileDiff(file)
      else if (id === 'history') await repo.openFileHistory(file)
      else if (id === 'blame') await repo.openBlame(file)
      else if (id === 'copy-rel') await copyLabeledPath(file, isDir ? '目录路径' : '文件路径')
      else if (id === 'copy-abs') await copyLabeledPath(absRepoPath(file), isDir ? '目录路径' : '绝对路径')
      else if (id === 'copy-dir') await copyLabeledPath(absDirPath(file), '目录路径')
      else if (id === 'ignore') await repo.ignoreFile(file)
    },
  }
}

/** 文档标签右键：复制路径 / 绝对路径 / 目录路径 */
function onTabContext(e: MouseEvent, tab: { key: string; title: string }) {
  e.preventDefault()
  const file = tab.title
  menu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { id: 'copy-rel', label: '复制文件路径（相对）' },
      { id: 'copy-abs', label: '复制绝对路径' },
      { id: 'copy-dir', label: '复制目录路径' },
      { id: 'divider', label: '', divider: true },
      { id: 'close', label: '关闭这个标签' },
    ],
    handler: async (id) => {
      if (id === 'copy-rel') await copyLabeledPath(file, '文件路径')
      else if (id === 'copy-abs') await copyLabeledPath(absRepoPath(file), '绝对路径')
      else if (id === 'copy-dir') await copyLabeledPath(absDirPath(file), '目录路径')
      else if (id === 'close') closeTab(tab.key)
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
    title: '新建储藏（stash）',
    label: '描述',
    placeholder: 'wip: 正在改登录',
    confirmText: '创建储藏',
    onSubmit: (message) => repo.createStash(message),
  }
}

/** 为 AI 并行会话开一个独立工作副本 */
function openCreateWorktree() {
  showWorktreeDialog.value = true
}

/** 给工作树打 Agent 标记 */
function onSetWorktreeAgent(wtPath: string) {
  prompt.value = {
    title: '标记工作树的 Agent',
    label: '谁在用它（claude / codex / cursor …）',
    value: repo.worktreeMeta[wtPath]?.agent ?? '',
    placeholder: 'claude',
    confirmText: '保存标记',
    onSubmit: (agent) => repo.setWorktreeAgent(wtPath, agent),
  }
}

/** 打开工作树：先记一次「最后活动」，再切仓库 */
async function openWorktree(path: string) {
  await repo.touchWorktree(path)
  openPath(path)
}

/** 记录这个副本在做什么 */
function onSetWorktreeTask(wtPath: string) {
  prompt.value = {
    title: '记录任务',
    label: '这个副本要做什么（prompt / issue 链接）',
    value: repo.worktreeMeta[wtPath]?.task ?? '',
    placeholder: '修复登录超时；https://github.com/org/repo/issues/123',
    confirmText: '保存任务',
    onSubmit: (task) => repo.setWorktreeTask(wtPath, task),
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

/** 切分支时自动展开底部工作区，方便先看改动再操作 */
watch(
  () => repo.info?.branch,
  (next, prev) => {
    if (next && next !== prev) {
      settings.workDockOpen = true
      settings.save()
    }
  },
)

onMounted(async () => {
  settings.init()
  window.addEventListener('keydown', onKey)
  window.addEventListener('contextmenu', blockContextMenu)
  document.addEventListener('mousedown', onDocMouseDown)
  void repo.loadRecents()
  repo.loadLogs()
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

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('contextmenu', blockContextMenu)
  document.removeEventListener('mousedown', onDocMouseDown)
})
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

      <ProjectSwitcher
        @open="openPath"
        @rename="onRenameProject"
        @clone="onCloneFromUrl"
        @browse="browseFolder"
      />

      <!-- 搜索 + 日期筛选放在一起 -->
      <div ref="dateRoot" class="relative flex min-w-0 max-w-[340px] flex-1 items-center gap-1">
        <div class="relative min-w-0 flex-1">
          <input
            ref="searchInput"
            v-model="repo.search"
            class="field w-full py-1 pl-7 pr-7 text-[12px]"
            placeholder="搜索提交 / 作者"
          />
          <span class="pointer-events-none absolute left-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[11px] t3">
            <Icon name="search" :size="13" />
          </span>
          <button
            v-if="repo.search"
            class="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded t3 hover:bg-[var(--hover)] hover:opacity-100"
            title="清除搜索"
            @click="repo.search = ''; searchInput?.focus()"
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
        <span ref="dateBtn" class="shrink-0">
          <IconButton
            name="calendar"
            :title="dateLabel"
            :active="!!repo.dateFrom || !!repo.dateTo"
            @click="toggleDate"
          />
        </span>

        <div
          v-if="showDate"
          class="modal animate-pop fixed z-[60] w-[272px] p-3"
          :style="{ right: datePos.right + 'px', top: datePos.top + 'px' }"
        >
          <div class="mb-2 flex items-center">
            <span class="text-[11px] font-medium t2">提交日期范围</span>
            <button
              class="ml-auto rounded px-1 text-[12px] t3 hover:opacity-80"
              title="关闭（不应用）"
              @click="showDate = false"
            >
              ✕
            </button>
          </div>

          <div class="mb-2 flex gap-1">
            <button class="btn px-1.5 py-0 text-[10px]" @click="setDateRange('today')">今日</button>
            <button class="btn px-1.5 py-0 text-[10px]" @click="setDateRange('yesterday')">昨日</button>
            <button class="btn px-1.5 py-0 text-[10px]" @click="setDateRange('3d')">近三天</button>
            <button class="btn px-1.5 py-0 text-[10px]" @click="setDateRange('7d')">近一周</button>
          </div>
          <label class="mb-1 block text-[10px] t3">起始</label>
          <input v-model="dateDraft.from" type="date" class="field mb-2 w-full px-2 py-1 text-[11px]" />
          <label class="mb-1 block text-[10px] t3">结束</label>
          <input v-model="dateDraft.to" type="date" class="field w-full px-2 py-1 text-[11px]" />

          <div class="mt-2 flex items-center gap-1">
            <button class="btn px-2 py-0.5 text-[10px]" @click="clearDate">清除</button>
            <span class="ml-auto" />
            <button class="btn px-2 py-0.5 text-[10px]" @click="showDate = false">关闭</button>
            <button class="btn btn-primary px-2 py-0.5 text-[10px]" @click="applyDate">应用</button>
          </div>
        </div>
      </div>

      <span v-if="repo.error" class="min-w-0 max-w-[180px] shrink truncate text-[11px] text-rose-400" :title="repo.error">
        {{ repo.error }}
      </span>

      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton name="panel-left" title="显示/隐藏左侧面板" :active="settings.showLeft" :size="15" @click="settings.showLeft = !settings.showLeft; settings.save()" />
        <IconButton name="panel-right" title="显示/隐藏右侧面板" :active="settings.showRight" :size="15" @click="settings.showRight = !settings.showRight; settings.save()" />
        <span class="mx-1 h-4 w-px" :style="{ background: 'var(--border)' }" />
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
        <div class="relative">
          <IconButton name="pull" :title="`Pull：拉取并合并${repo.status?.behind ? `（落后 ${repo.status.behind}）` : ''}`" :disabled="!!repo.syncing" @click="repo.sync('pull')" />
          <span v-if="repo.status?.behind" class="count-badge">{{ repo.status.behind }}</span>
        </div>
        <div class="relative">
          <IconButton name="push" :title="`Push：推送到远端${repo.status?.ahead ? `（领先 ${repo.status.ahead}）` : ''}`" :disabled="!!repo.syncing" @click="repo.sync('push')" />
          <span v-if="repo.status?.ahead" class="count-badge">{{ repo.status.ahead }}</span>
        </div>

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

    <!-- 本机 git 身份提示（只读检查，不保存凭据） -->
    <div
      v-if="identityMissing"
      class="line-b flex items-center gap-2 px-3 py-1.5 text-[11px]"
      :style="{ background: 'rgba(251,146,60,.10)', color: '#fb923c' }"
    >
      <span class="shrink-0 font-medium">本机未配置 git 身份</span>
      <span class="min-w-0 truncate t3">
        请在终端执行 git config --global user.name "..." 与 user.email "..."；GitPanel 只读取本机配置，不保存任何凭据。
      </span>
      <button class="btn ml-auto shrink-0 px-2 py-0 text-[10px]" @click="repo.identityDismissed = true">知道了</button>
    </div>

    <main v-if="repo.info" class="flex min-h-0 flex-1">      <div
        v-if="settings.showLeft"
        class="flex h-full shrink-0 flex-col"
        :style="{ width: settings.leftWidth + 'px', borderRight: '1px solid var(--border)' }"
      >
        <div class="flex h-8 shrink-0 items-center gap-px px-0.5" :style="{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }">
          <button
            v-for="t in (['branches', 'stashes', 'snapshots', 'worktrees'] as const)"
            :key="t"
            class="relative flex h-8 flex-1 items-center justify-center gap-0.5 whitespace-nowrap px-0.5 text-[10px] leading-none"
            :title="t === 'branches' ? '分支' : t === 'stashes' ? '储藏：git stash，把当前改动临时存起来' : t === 'snapshots' ? '安全网快照' : '工作树'"
            :style="
              leftTab === t
                ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
                : { color: 'var(--text-mute)' }
            "
            @click="switchTab(t)"
          >
            {{ t === 'branches' ? '分支' : t === 'stashes' ? '储藏' : t === 'snapshots' ? '安全网' : '工作树' }}
            <span
              v-if="tabBadge(t)"
              class="shrink-0 rounded-full px-1 text-[9px] leading-[14px]"
              :style="{ background: 'var(--panel-3)', color: 'var(--text-mute)' }"
            >
              {{ tabBadge(t) }}
            </span>
          </button>
        </div>

        <SidePanel
          v-if="leftTab === 'branches'"
          class="min-h-0 flex-1"
          :refs="repo.info.refs"
          :branch="repo.info.branch"
          :tip="repo.tip"
          :name="repo.info.name"
          :statuses="repo.branchStatus"
          @filter="repo.setTip($event)"
          @context="onRefContext"
          @create-tag="openCreateTag()"
          @sync="repo.sync($event)"
          @compare="repo.openCompare($event, 'HEAD')"
          @checkout="onCheckoutRef"
          @delete-remote="onDeleteRemoteBranch"
          @manage-remotes="showRemotes = true"
        />
        <StashPanel v-else-if="leftTab === 'stashes'" class="min-h-0 flex-1" @create="openCreateStash" />
        <WorktreePanel
          v-else-if="leftTab === 'worktrees'"
          class="min-h-0 flex-1"
          @create="openCreateWorktree"
          @open="openWorktree"
          @set-agent="onSetWorktreeAgent"
          @set-task="onSetWorktreeTask"
        />
        <SnapshotPanel v-else class="min-h-0 flex-1" />
      </div>

      <div v-if="settings.showLeft" class="panel-resizer" @pointerdown="startDrag('left', $event)" />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- 文档标签：打开的文件和 diff 都在这里，可横向滚动、单个/全部关闭 -->
        <div
          v-if="docTabs.length"
          class="line-b flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto px-1"
          :style="{ background: 'var(--panel)' }"
        >
          <div
            v-for="t in docTabs"
            :key="t.key"
            class="group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded px-2 text-[11px]"
            :style="
              repo.activeTab === t.key
                ? { background: 'var(--panel-3)', color: 'var(--text)' }
                : { color: 'var(--text-mute)' }
            "
            :title="t.title"
            @click="repo.activeTab = t.key"
            @contextmenu.prevent="onTabContext($event, t)"
          >
            <span class="shrink-0 text-[9px] opacity-70">{{ t.kind === 'file' ? '◻' : '±' }}</span>
            <span class="max-w-[170px] truncate">{{ t.label }}</span>
            <span v-if="t.dirty" class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: 'var(--accent)' }" />
            <button class="shrink-0 px-0.5 opacity-50 hover:opacity-100" title="关闭" @click.stop="closeTab(t.key)">
              ✕
            </button>
          </div>
          <IconButton
            class="ml-auto shrink-0"
            compact
            name="close"
            title="关闭全部文档"
            :size="13"
            @click="repo.closeAllDocs()"
          />
        </div>

        <FileEditor
          v-if="activeEditorTab"
          :key="activeEditorTab.file"
          class="min-h-0 flex-1"
          :file="activeEditorTab.file"
          :content="activeEditorTab.content"
          :dirty="activeEditorTab.content !== activeEditorTab.saved"
          :saving="activeEditorTab.saving"
          :loading="activeEditorTab.loading"
          :editable="activeEditorTab.editable"
          :encoding="activeEditorTab.encoding"
          :size="activeEditorTab.size"
          :lines="activeEditorTab.lines"
          :truncated="activeEditorTab.truncated"
          :has-more="activeEditorTab.hasMore"
          :loading-more="activeEditorTab.loadingMore"
          :loaded-bytes="activeEditorTab.offset"
          @change="repo.updateEditorContent(activeEditorTab.file, $event)"
          @save="repo.saveEditor(activeEditorTab.file)"
          @reload="repo.reloadEditor(activeEditorTab.file)"
          @close="closeActiveDoc()"
          @load-more="repo.loadMoreEditor()"
        />
        <div
          v-else-if="activeDiffTab"
          :class="diffFullscreen ? 'fixed inset-0 z-40 flex' : 'flex min-h-0 flex-1'"
          :style="diffFullscreen ? { background: 'var(--bg)' } : {}"
        >
          <DiffView
            :key="activeDiffTab.key"
            class="min-w-0 flex-1"
            :file="activeDiffTab.file"
            :diff="activeDiffTab.diff"
            :loading="activeDiffTab.loading"
            :fullscreen="diffFullscreen"
            :large-kb="settings.diffLargeKB"
            @toggle-fullscreen="diffFullscreen = !diffFullscreen"
            @load-more="repo.loadMoreDiff()"
            @close="closeActiveDoc()"
          />
        </div>
        <CompareList v-else-if="repo.compareOpen" class="min-w-0 flex-1" />
        <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col">
          <!-- cherry-pick / revert 进行中：给继续 / 跳过 / 中止 -->
          <div
            v-if="repo.sequence.inProgress"
            class="line-b flex h-9 shrink-0 items-center gap-2 px-3 text-[11px]"
            :style="{ background: 'rgba(251,146,60,.12)', color: '#fb923c' }"
          >
            <span class="shrink-0 font-medium">
              {{ repo.sequence.kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert' }} 进行中
            </span>
            <span v-if="repo.sequence.conflicted.length" class="min-w-0 truncate t3">
              {{ repo.sequence.conflicted.length }} 个文件有冲突，解决后点「继续」
            </span>
            <span v-else-if="repo.sequence.pending" class="t3">还剩 {{ repo.sequence.pending }} 个提交</span>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <button
                v-if="repo.sequence.conflicted.length"
                class="btn px-2 py-0 text-[10px]"
                @click="repo.openConflict(repo.sequence.conflicted[0].path)"
              >
                解决冲突
              </button>
              <button class="btn px-2 py-0 text-[10px]" @click="repo.sequenceAction('continue')">继续</button>
              <button class="btn px-2 py-0 text-[10px]" @click="repo.sequenceAction('skip')">跳过</button>
              <button class="btn px-2 py-0 text-[10px]" @click="repo.sequenceAction('abort')">中止</button>
            </div>
          </div>

          <!-- 过滤到某个分支 / 提交时给一个明确的返回入口 -->
          <div
            v-if="repo.tip"
            class="line-b flex h-8 shrink-0 items-center gap-2 px-3 text-[11px]"
            :style="{ background: 'var(--panel)' }"
          >
            <span class="shrink-0" :style="{ color: 'var(--accent)' }">只看</span>
            <span class="min-w-0 truncate font-mono t2" :title="repo.tip">{{ tipLabel }}</span>
            <span class="shrink-0 t3">的历史 · {{ repo.filteredRows.length }} 条</span>
            <button class="btn ml-auto shrink-0 px-2 py-0 text-[10px]" title="返回全部提交（Esc）" @click="repo.setTip('')">
              ← 返回全部提交
            </button>
          </div>
          <CommitList
            class="min-w-0 flex-1"
            :rows="repo.filteredRows"
            :selected-oid="repo.selected?.oid"
            :loading="repo.loading"
            @select="onSelectCommit"
            @load-more="repo.loadMore()"
            @context="onCommitContext"
          />
        </div>

        <!-- 底部工作区：可拖高度、可收起；切分支时自动展开 -->
        <div
          v-if="settings.workDockOpen"
          class="flex shrink-0 flex-col"
          :style="{ height: settings.workDockHeight + 'px', borderTop: '1px solid var(--border)' }"
        >
          <div class="dock-resizer" title="拖动调整高度" @pointerdown="startDockDrag($event)" />
          <div class="flex h-7 shrink-0 items-center gap-2 px-3 text-[11px]" :style="{ background: 'var(--panel-2)' }">
            <span class="font-medium t2">工作区</span>
            <span class="t3">{{ changeCount }} 项改动</span>
            <span class="text-[10px] t3">Ctrl 点击多选文件</span>
            <IconButton
              class="ml-auto"
              compact
              name="collapse"
              title="收起工作区（最小化到底部）"
              :size="14"
              @click="settings.workDockOpen = false; settings.save()"
            />
          </div>
          <WorkingPanel
            class="min-h-0 flex-1"
            @conflict="repo.openConflict($event)"
            @hunks="showHunks = $event"
          />
        </div>
        <button
          v-else
          class="line-t flex h-7 shrink-0 items-center gap-2 px-3 text-[11px] t3"
          :style="{ background: 'var(--panel-2)' }"
          title="展开工作区"
          @click="settings.workDockOpen = true; settings.save()"
        >
          <span class="font-medium t2">工作区</span>
          <span>{{ changeCount }} 项改动</span>
          <Icon name="expand" :size="14" class="ml-auto" />
        </button>
      </div>

      <div v-if="settings.showRight" class="panel-resizer" @pointerdown="startDrag('right', $event)" />
      <div
        v-if="settings.showRight"
        class="flex h-full shrink-0 flex-col"
        :style="{ width: settings.rightWidth + 'px', borderLeft: '1px solid var(--border)' }"
      >
        <div
          class="flex h-8 shrink-0 items-center"
          :style="{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }"
        >
          <button
            v-if="detailTabOpen"
            class="group relative flex h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap text-[10px] leading-none"
            title="当前提交的变动详情（可关闭）"
            :style="
              rightTab === 'detail'
                ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
                : { color: 'var(--text-mute)' }
            "
            @click="rightTab = 'detail'"
          >
            变动详情
            <span
              class="rounded px-1 text-[10px] leading-[14px] opacity-0 transition group-hover:opacity-60 hover:bg-[var(--hover)] hover:opacity-100"
              title="关闭变动详情"
              @click.stop="closeDetailTab"
            >
              ✕
            </span>
          </button>
          <button
            class="relative flex h-8 flex-1 items-center justify-center whitespace-nowrap text-[10px] leading-none"
            title="项目文件（可直接查看 / 编辑）"
            :style="
              rightTab === 'files'
                ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
                : { color: 'var(--text-mute)' }
            "
            @click="rightTab = 'files'"
          >
            文件
          </button>
        </div>

        <DetailPanel
          v-if="rightTab === 'detail'"
          class="min-h-0 flex-1"
          :detail="repo.detail"
          :loading="repo.detailLoading"
          @open-file="repo.openFileDiff($event)"
          @file-context="onFileContext"
        />
        <FilePanel v-else class="min-h-0 flex-1" @file-context="onFileContext" />
      </div>
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

        <div class="mt-3 flex items-center justify-center gap-2">
          <button class="btn" @click="showDashboard = true">多仓库看板</button>
          <button class="btn" @click="showPalette = true">命令面板</button>
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
    <PatchModal />
    <RebaseDialog v-if="repo.rebaseOpen" />
    <FileHistoryModal />
    <BlameModal />
    <HealthModal />
    <HistorySearchModal
      v-if="repo.historySearchOpen"
      @close="repo.closeHistorySearch()"
      @open="onHistoryHit"
    />
    <DashboardModal v-if="showDashboard" @close="showDashboard = false" @open="openPath" />
    <CloneDialog
      v-if="showClone"
      :initial-url="cloneUrl"
      @close="showClone = false; cloneUrl = ''"
      @cloned="openPath"
    />
    <HunkDialog
      v-if="showHunks"
      :file="showHunks.file"
      :staged="showHunks.staged"
      @close="showHunks = null"
    />
    <LogModal v-if="repo.logOpen" @close="repo.logOpen = false" />
    <WorktreeDialog v-if="showWorktreeDialog" @close="showWorktreeDialog = false" />
    <RemoteDialog v-if="showRemotes" @close="showRemotes = false" />
    <CommandPalette
      v-if="showPalette"
      @close="showPalette = false"
      @settings="showSettings = true"
      @dashboard="showDashboard = true"
      @remotes="showRemotes = true"
      @history-search="repo.openHistorySearch()"
    />
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
        class="fixed bottom-12 right-4 z-[60] max-w-[380px] cursor-pointer rounded-lg px-3 py-2 text-[12px] shadow-lg"
        :style="noticeClass"
        :title="'点击查看操作日志与完整原因'"
        @click="repo.logOpen = true"
      >
        {{ repo.notice.text }}
        <span class="ml-1 opacity-70">›</span>
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

/* 面板拖拽分隔条 */
.count-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 9px;
  line-height: 13px;
  text-align: center;
  pointer-events: none;
}

.panel-resizer {
  flex: 0 0 5px;
  width: 5px;
  cursor: col-resize;
  transition: background 0.12s ease;
}
.panel-resizer:hover {
  background: var(--accent-weak);
}

/* 底部工作区的拖拽手柄 */
.dock-resizer {
  flex: 0 0 4px;
  height: 4px;
  cursor: row-resize;
  transition: background 0.12s ease;
}
.dock-resizer:hover {
  background: var(--accent-weak);
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

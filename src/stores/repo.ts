import { defineStore } from 'pinia'
import { api } from '../api/git'
import { useSettingsStore } from './settings'
import { explainGitError } from '../lib/gitErrors'
import { recentList, recentPin, recentRemove, recentTouch, recentRename, cloneRepo, gitIdentity } from '../api/desktop'
import type { RecentRepo } from '../api/desktop'
import type {
  BlameLine,
  BranchStatus,
  CommandResult,
  CommitDetail,
  CommitRow,
  CompareFile,
  ConflictDetail,  FileDiff,
  FileHistoryEntry,
  MergeResult,
  PluginCommand,
  RebaseCommit,
  RebaseOutcome,
  RebaseStatus,
  RebaseStep,
  ReflogEntry,
  RemoteInfo,
  RepoHealth,
  RepoInfo,
  RepoOverview,
  SequenceStatus,
  Snapshot,
  Stash,
  StashDiff,
  StatusFile,
  TagInfo,
  WorktreeInfo,
  WorktreeMeta,
  WorktreeStatus,
} from '../api/types'

const PAGE_SIZE = 400

export interface Notice {
  kind: 'ok' | 'err' | 'info'
  text: string
}

let noticeTimer: number | undefined

const LOG_KEY = 'gitpanel.logs'

/** 一条操作/错误日志 */
export interface LogEntry {
  time: number
  kind: 'ok' | 'err' | 'info'
  summary: string
  detail: string
}

/** 打开中的一个本地文件（编辑器标签） */
export interface EditorTab {
  file: string
  /** 当前编辑内容（LF） */
  content: string
  /** 上次保存/加载的内容（LF），用于判断未保存 */
  saved: string
  eol: string
  size: number
  lines: number
  editable: boolean
  encoding: string
  truncated: boolean
  loading: boolean
  saving: boolean
}

/** 打开中的一个 diff 标签 */
export interface DiffTab {
  /** d:<kind>:<oid|a..b>:<staged>:<file> */
  key: string
  file: string
  kind: 'commit' | 'worktree' | 'compare'
  oid: string
  staged: boolean
  a: string
  b: string
  diff: FileDiff | null
  from: number
  loading: boolean
}

function countLines(text: string): number {
  if (!text) return 0
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n + 1
}

function joinChunk(head: string, tail: string): string {
  if (!tail) return head
  if (!head) return tail
  return `${head}\n${tail}`
}

/** diff 标签的唯一键 */
function diffKey(
  kind: string,
  file: string,
  oid: string,
  a: string,
  b: string,
  staged: boolean,
): string {
  const rev = kind === 'compare' ? `${a}..${b}` : kind === 'worktree' ? (staged ? 'index' : 'work') : oid
  return `${kind}:${rev}:${file}`
}

export const useRepoStore = defineStore('repo', {
  state: () => ({
    path: '',
    info: null as RepoInfo | null,
    rows: [] as CommitRow[],
    laneCount: 1,
    nextOffset: 0,
    done: false,
    loading: false,
    loadingMore: false,
    error: '',
    tip: '',
    search: '',
    dateFrom: '',
    dateTo: '',
    selected: null as CommitRow | null,
    detail: null as CommitDetail | null,
    detailLoading: false,

    // 文档标签：编辑器 / diff 都放在同一排标签里，可并行打开多个
    editorTabs: [] as EditorTab[],
    diffTabs: [] as DiffTab[],
    /** 当前激活的标签：f:<path> 或 d:<key> */
    activeTab: '',

    commands: [] as PluginCommand[],
    remotes: [] as RemoteInfo[],
    notice: null as Notice | null,
    commandOutput: null as (CommandResult & { title: string }) | null,
    recents: [] as RecentRepo[],

    // 操作 / 错误日志（可复盘）
    logs: [] as LogEntry[],
    logOpen: false,

    // 工作区 / 提交 / 同步
    status: null as WorktreeStatus | null,
    /** 各分支的上游与领先 / 落后 */
    branchStatus: [] as BranchStatus[],
    statusLoading: false,
    commitMessage: '',
    amend: false,
    syncing: '' as '' | 'fetch' | 'pull' | 'push',
    syncOutput: '',

    // 安全网
    snapshots: [] as Snapshot[],
    snapshotsLoading: false,

    // 冲突
    conflict: null as ConflictDetail | null,
    conflictLoading: false,
    conflictFile: '',
    diffStaged: false,

    // 暂存 / 标签 / reflog
    stashes: [] as Stash[],
    stashesLoading: false,
    stashDiff: null as StashDiff | null,
    tags: [] as TagInfo[],
    reflog: [] as ReflogEntry[],
    reflogLoading: false,

    // cherry-pick / revert 进行中状态
    sequence: { kind: '', inProgress: false, conflicted: [], pending: 0 } as SequenceStatus,

    // 跨提交对比
    compareBase: '',
    compareA: '',
    compareB: '',
    compareFiles: [] as CompareFile[],
    compareOpen: false,

    // 交互式 rebase
    rebaseOpen: false,
    rebaseBase: 'HEAD~5',
    rebaseCommits: [] as RebaseCommit[],
    rebaseLoading: false,
    rebaseStatus: null as RebaseStatus | null,

    // 工作树
    worktrees: [] as WorktreeInfo[],
    worktreesLoading: false,
    worktreeMeta: {} as Record<string, WorktreeMeta>,

    // 多仓库看板
    overview: [] as RepoOverview[],
    overviewLoading: false,

    // 项目 / 身份
    identity: { name: '', email: '' },
    identityDismissed: false,

    // 文件历史 / Blame / 体检
    fileHistoryFile: '',
    fileHistory: [] as FileHistoryEntry[],
    blameFile: '',
    blameLines: [] as BlameLine[],
    health: null as RepoHealth | null,
    healthLoading: false,
  }),

  getters: {
    branches: (s) => s.info?.refs.filter((r) => r.kind === 'branch' || r.kind === 'head') ?? [],
    remotesRefs: (s) => s.info?.refs.filter((r) => r.kind === 'remote') ?? [],
    filteredRows: (s) => {
      const kw = s.search.trim().toLowerCase()
      let rows = s.rows
      if (kw) {
        rows = rows.filter(
          (r) =>
            r.summary.toLowerCase().includes(kw) ||
            r.author.toLowerCase().includes(kw) ||
            r.short.toLowerCase().includes(kw) ||
            r.refs.some((b) => b.name.toLowerCase().includes(kw)),
        )
      }
      if (s.dateFrom) {
        const from = Math.floor(new Date(`${s.dateFrom}T00:00:00`).getTime() / 1000)
        rows = rows.filter((r) => r.time >= from)
      }
      if (s.dateTo) {
        const to = Math.floor(new Date(`${s.dateTo}T23:59:59`).getTime() / 1000)
        rows = rows.filter((r) => r.time <= to)
      }
      return rows
    },
    originWeb: (s) => s.remotes.find((r) => r.name === 'origin')?.web ?? s.remotes[0]?.web ?? '',
  },

  actions: {
    async open(path: string) {
      this.loading = true
      this.error = ''
      try {
        this.info = await api.openRepo(path)
        this.path = this.info.path
        this.remember(this.info.path)
        await this.maybeAutoPruneSnapshots()
        await this.reload()
        this.loadExtras()
        await this.refreshRebaseStatus()
        void this.loadSequence()
        const first = this.rows[0]
        if (first) await this.select(first)
        // 新项目：检查本机是否有 git 身份（只看不改，不保存）
        void this.checkIdentity()
      } catch (e) {
        this.info = null
        this.rows = []
        this.error = String((e as Error).message || e)
      } finally {
        this.loading = false
      }
    },

    async loadExtras() {
      if (!this.path) return
      try {
        const [c, r] = await Promise.all([api.commands(this.path), api.remotes(this.path)])
        this.commands = c.commands
        this.remotes = r.remotes
      } catch {
        this.commands = []
        this.remotes = []
      }
    },

    remember(path: string) {
      void recentTouch(path, path.split(/[\\/]/).filter(Boolean).pop() || path).then(() =>
        this.loadRecents(),
      )
    },

    async loadRecents() {
      this.recents = await recentList()
    },

    async forget(path: string) {
      await recentRemove(path)
      await this.loadRecents()
    },

    async checkIdentity() {
      this.identity = await gitIdentity()
    },

    async renameProject(path: string, alias: string) {
      const final = await recentRename(path, alias)
      await this.loadRecents()
      this.notify('ok', final ? `已重命名为 ${final}` : '已恢复默认名称')
      return final
    },

    /** 克隆并打开：返回新仓库路径，由调用方负责切过去 */
    async cloneAndOpen(url: string, target: string): Promise<string> {
      const path = await cloneRepo(url, target)
      this.notify('ok', '克隆完成')
      await recentTouch(path, path.split(/[\\/]/).filter(Boolean).pop() || path)
      await this.loadRecents()
      return path
    },

    async pinRecent(path: string, pinned: boolean) {
      await recentPin(path, pinned)
      await this.loadRecents()
    },

    async reload() {
      if (!this.path) return
      this.loading = true
      this.rows = []
      this.nextOffset = 0
      this.done = false
      try {
        const page = await api.graph({ path: this.path, offset: 0, limit: PAGE_SIZE, tip: this.tip })
        this.rows = page.rows
        this.laneCount = page.laneCount
        this.nextOffset = page.nextOffset
        this.done = page.done
      } catch (e) {
        this.error = String((e as Error).message || e)
      } finally {
        this.loading = false
      }
    },

    async loadMore() {
      if (this.loadingMore || this.done || !this.path) return
      this.loadingMore = true
      try {
        const page = await api.graph({
          path: this.path,
          offset: this.nextOffset,
          limit: PAGE_SIZE,
          tip: this.tip,
        })
        this.rows = this.rows.concat(page.rows)
        this.nextOffset = page.nextOffset
        this.done = page.done
        this.laneCount = Math.max(this.laneCount, page.laneCount)
      } catch (e) {
        this.error = String((e as Error).message || e)
      } finally {
        this.loadingMore = false
      }
    },

    async select(row: CommitRow) {
      this.selected = row
      this.detail = null
      if (!this.path) return
      this.detailLoading = true
      try {
        this.detail = await api.commit(this.path, row.oid)
      } catch {
        this.detail = null
      } finally {
        this.detailLoading = false
      }
    },

    selectOffset(delta: number) {
      const list = this.filteredRows
      if (!list.length) return
      const idx = list.findIndex((r) => r.oid === this.selected?.oid)
      const next = Math.min(list.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + delta))
      void this.select(list[next])
    },

    /* ── 跨提交 / 分支对比 ── */

    setCompareBase(oid: string) {
      this.compareBase = oid
      this.notify('info', `已设对比起点 ${oid.slice(0, 7)}，再右键另一个提交点「与起点对比」`)
    },

    async openCompare(b: string, a?: string) {
      if (!this.path) return
      const base = a || this.compareBase
      if (!base || base === b) {
        this.notify('err', '先右键一个提交「设为对比起点」')
        return
      }
      try {
        this.closeEditor()
        const r = await api.compare(this.path, base, b)
        this.compareA = base
        this.compareB = b
        this.compareFiles = r.files
        this.compareOpen = true
        if (!r.files.length) this.notify('info', '这两个提交之间没有文件差异')
        else await this.openCompareFile(r.files[0].path)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    closeCompare() {
      this.compareOpen = false
      this.compareFiles = []
      this.compareA = ''
      this.compareB = ''
    },

    /* ── cherry-pick / revert ── */

    async ignoreFile(file: string) {
      if (!this.path) return
      try {
        const r = await api.ignoreFile(this.path, file)
        this.notify('ok', `已加入 .gitignore：${r.entry}`)
        await this.refreshStatus()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async loadSequence() {      if (!this.path) return
      try {
        this.sequence = await api.sequenceStatus(this.path)
      } catch {
        this.sequence = { kind: '', inProgress: false, conflicted: [], pending: 0 }
      }
    },

    async cherryPick(oid: string) {
      if (!this.path) return
      try {
        const r = await api.cherryPick(this.path, oid)
        if (r.ok) this.notify('ok', `已 cherry-pick ${oid.slice(0, 7)}`)
        else if (r.conflicts) this.notify('err', '有冲突，解决后点「继续」')
        else this.notify('err', r.output || 'cherry-pick 失败')
        await this.refreshStatus()
        await this.loadSequence()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async revertCommit(oid: string) {
      if (!this.path) return
      try {
        const r = await api.revert(this.path, oid)
        if (r.ok) this.notify('ok', `已生成反向提交（revert ${oid.slice(0, 7)}）`)
        else if (r.conflicts) this.notify('err', '有冲突，解决后点「继续」')
        else this.notify('err', r.output || 'revert 失败')
        await this.refreshStatus()
        await this.loadSequence()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async sequenceAction(action: 'continue' | 'skip' | 'abort') {
      if (!this.path || !this.sequence.kind) return
      try {
        await api.sequenceAction(
          this.path,
          this.sequence.kind as 'cherry-pick' | 'revert',
          action,
        )
        const label = action === 'continue' ? '继续完成' : action === 'skip' ? '已跳过' : '已中止'
        this.notify('ok', `${this.sequence.kind} ${label}`)
        await this.refreshStatus()
        await this.loadSequence()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async setTip(tip: string) {      this.tip = tip
      await this.reload()
    },

    /** 大文件阈值：单次最多返回多少行（0 = 不限），按性能优先默认 3000 行 */
    diffWindow(from: number) {
      const st = useSettingsStore()
      return { fromLine: from, maxLines: st.diffMaxLines, maxBytes: 0 }
    },

    /* ── 文档标签：diff ── */

    async openFileDiff(file: string) {
      if (!this.path || !this.selected) return
      await this.loadDiffTab({ kind: 'commit', file, oid: this.selected.oid, staged: false, a: '', b: '' })
    },

    /** 打开任意提交里某文件的 diff（文件历史跳转用） */
    async openFileDiffAt(oid: string, file: string) {
      if (!this.path) return
      await this.loadDiffTab({ kind: 'commit', file, oid, staged: false, a: '', b: '' })
    },

    async openWorktreeDiff(file: string, staged: boolean) {
      if (!this.path) return
      await this.loadDiffTab({ kind: 'worktree', file, oid: '', staged, a: '', b: '' })
    },

    async openCompareFile(file: string) {
      if (!this.path) return
      await this.loadDiffTab({ kind: 'compare', file, oid: '', staged: false, a: this.compareA, b: this.compareB })
    },

    /** 打开（或激活）一个 diff 标签 */
    async loadDiffTab(cfg: {
      kind: 'commit' | 'worktree' | 'compare'
      file: string
      oid: string
      staged: boolean
      a: string
      b: string
    }) {
      if (!this.path) return
      const key = diffKey(cfg.kind, cfg.file, cfg.oid, cfg.a, cfg.b, cfg.staged)
      this.activeTab = `d:${key}`
      if (this.diffTabs.some((t) => t.key === key)) return
      const tab: DiffTab = {
        key,
        file: cfg.file,
        kind: cfg.kind,
        oid: cfg.oid,
        staged: cfg.staged,
        a: cfg.a,
        b: cfg.b,
        diff: null,
        from: 0,
        loading: true,
      }
      this.diffTabs.push(tab)
      const live = this.diffTabs[this.diffTabs.length - 1]
      await this.fetchDiff(live, 0, true)
    },

    async fetchDiff(tab: DiffTab, from: number, replace: boolean) {
      if (!this.path) return
      const win = this.diffWindow(from)
      try {
        const next =
          tab.kind === 'worktree'
            ? await api.worktreeDiff(this.path, tab.file, tab.staged, win)
            : tab.kind === 'compare'
              ? await api.compareFile(this.path, tab.a, tab.b, tab.file, win)
              : await api.fileDiff(this.path, tab.oid, tab.file, win)
        if (replace || !tab.diff) {
          tab.diff = next
        } else {
          tab.diff = {
            ...next,
            oldText: joinChunk(tab.diff.oldText, next.oldText),
            newText: joinChunk(tab.diff.newText, next.newText),
            oldFrom: 0,
            newFrom: 0,
          }
        }
        tab.from = from
      } catch {
        if (replace) tab.diff = null
      } finally {
        tab.loading = false
      }
    },

    /** 大文件分段：给当前 diff 标签接上后一段 */
    async loadMoreDiff() {
      const tab = this.diffTabs.find((t) => `d:${t.key}` === this.activeTab)
      if (!tab || !tab.diff?.hasMore || tab.loading) return
      const from = tab.from + Math.max(countLines(tab.diff.oldText), countLines(tab.diff.newText))
      tab.loading = true
      await this.fetchDiff(tab, from, false)
    },

    closeDiff() {
      const idx = this.diffTabs.findIndex((t) => `d:${t.key}` === this.activeTab)
      if (idx >= 0) this.diffTabs.splice(idx, 1)
      this.pickNextTab()
    },

    closeDiffTab(key: string) {
      const idx = this.diffTabs.findIndex((t) => t.key === key)
      const wasActive = idx >= 0 && this.activeTab === `d:${key}`
      if (idx >= 0) this.diffTabs.splice(idx, 1)
      if (wasActive) this.pickNextTab()
    },

    closeAllDocs() {
      this.diffTabs = []
      this.editorTabs = []
      this.activeTab = ''
    },

    /** 关掉一个标签后，自动切到剩下的最后一个 */
    pickNextTab() {
      const d = this.diffTabs[this.diffTabs.length - 1]
      if (d) {
        this.activeTab = `d:${d.key}`
        return
      }
      const f = this.editorTabs[this.editorTabs.length - 1]
      this.activeTab = f ? `f:${f.file}` : ''
    },

    /* ── 本地文件编辑（多标签） ── */

    async openEditor(file: string) {
      if (!this.path) return
      this.activeTab = `f:${file}`
      if (this.editorTabs.some((t) => t.file === file)) return
      const tab: EditorTab = {
        file,
        content: '',
        saved: '',
        eol: '\n',
        size: 0,
        lines: 0,
        editable: true,
        encoding: 'utf8',
        truncated: false,
        loading: true,
        saving: false,
      }
      this.editorTabs.push(tab)
      const live = this.editorTabs[this.editorTabs.length - 1]
      await this.loadEditorTab(live)
    },

    async loadEditorTab(tab: EditorTab) {
      if (!this.path) return
      tab.loading = true
      try {
        const res = await api.fsRead(this.path, tab.file)
        // CodeMirror 内部统一用 LF，这里记下原文件风格，保存时还原
        tab.eol = res.content.includes('\r\n') ? '\r\n' : '\n'
        tab.content = res.content.replace(/\r\n/g, '\n')
        tab.saved = tab.content
        tab.size = res.size
        tab.lines = res.lines
        tab.editable = res.editable
        tab.encoding = res.encoding
        tab.truncated = res.truncated
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      } finally {
        tab.loading = false
      }
    },

    updateEditorContent(file: string, content: string) {
      const tab = this.editorTabs.find((t) => t.file === file)
      if (tab) tab.content = content
    },

    async saveEditor(file?: string) {
      if (!this.path) return
      const tab = this.editorTabs.find((t) => t.file === (file ?? this.activeFile()))
      if (!tab) return
      if (!tab.editable) {
        this.notify('err', '这个文件只能只读查看（非 UTF-8 或过大）')
        return
      }
      if (tab.content === tab.saved) {
        this.notify('info', `${tab.file} 没有改动`)
        return
      }
      tab.saving = true
      try {
        // 编辑器里是 LF，写回时还原成原文件的换行风格
        const payload = tab.content.replace(/\r\n/g, '\n').split('\n').join(tab.eol)
        const r = await api.fsWrite(this.path, tab.file, payload)
        tab.saved = tab.content
        tab.size = r.size
        tab.lines = r.lines
        tab.truncated = false
        this.notify('ok', `已保存 ${r.file}`)
        await this.refreshStatus()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      } finally {
        tab.saving = false
      }
    },

    async reloadEditor(file?: string) {
      const tab = this.editorTabs.find((t) => t.file === (file ?? this.activeFile()))
      if (!tab) return
      await this.loadEditorTab(tab)
      this.notify('ok', `已重新读取 ${tab.file}`)
    },

    /** 当前激活编辑器对应的文件名（没有则空） */
    activeFile(): string {
      return this.activeTab.startsWith('f:') ? this.activeTab.slice(2) : ''
    },

    closeEditor(file?: string) {
      const name = file ?? this.activeFile()
      const idx = this.editorTabs.findIndex((t) => t.file === name)
      const wasActive = idx >= 0 && this.activeTab === `f:${name}`
      if (idx >= 0) this.editorTabs.splice(idx, 1)
      if (wasActive) this.pickNextTab()
    },

    closeEditorTab(file: string) {
      this.closeEditor(file)
    },

    notify(kind: Notice['kind'], text: string) {
      let display = text
      let detail = ''
      if (kind === 'err') {
        const explained = explainGitError(text)
        display = explained.summary
        detail = `${explained.hint}\n\n—— 原始输出 ——\n${text}`
      }
      this.notice = { kind, text: display }
      this.addLog(kind, display, detail || text)
      if (noticeTimer) window.clearTimeout(noticeTimer)
      noticeTimer = window.setTimeout(() => {
        this.notice = null
      }, kind === 'err' ? 6000 : 3200)
    },

    /* ── 操作 / 错误日志 ── */

    addLog(kind: LogEntry['kind'], summary: string, detail: string) {
      this.logs.unshift({ time: Date.now(), kind, summary, detail })
      if (this.logs.length > 300) this.logs.length = 300
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(this.logs.slice(0, 200)))
      } catch {
        /* 存满或隐私模式失败可忽略 */
      }
    },

    loadLogs() {
      try {
        const raw = localStorage.getItem(LOG_KEY)
        if (raw) this.logs = JSON.parse(raw) as LogEntry[]
      } catch {
        this.logs = []
      }
    },

    clearLogs() {
      this.logs = []
      try {
        localStorage.removeItem(LOG_KEY)
      } catch {
        /* 忽略 */
      }
    },

    async checkoutRef(ref: string) {
      if (!this.path) return
      try {
        const r = await api.checkout(this.path, ref)
        this.notify('ok', `已切换到 ${r.branch}`)
        this.tip = ''
        this.info = await api.openRepo(this.path)
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async createBranch(name: string, from?: string) {
      if (!this.path) return
      try {
        const r = await api.createBranch(this.path, name, from)
        this.notify('ok', `已创建并切换到 ${r.branch}`)
        this.info = await api.openRepo(this.path)
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async runCommand(id: string, title: string) {
      if (!this.path) return
      try {
        const res = await api.runCommand(this.path, id)
        this.commandOutput = { ...res, title }
        if (res.code !== 0) this.notify('err', `命令退出码 ${res.code}`)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    closeCommandOutput() {
      this.commandOutput = null
    },

    /* ─────────────── 工作区 ─────────────── */

    async refreshStatus() {
      if (!this.path) return
      this.statusLoading = true
      try {
        this.status = await api.worktreeStatus(this.path)
        void this.loadBranchStatus()
      } catch (e) {
        this.status = null
        this.error = String((e as Error).message || e)
      } finally {
        this.statusLoading = false
      }
    },

    async stage(files: StatusFile[] | string[]) {
      if (!this.path || !files.length) return
      const paths = files.map((f) => (typeof f === 'string' ? f : f.path))
      await api.stage(this.path, paths)
      await this.refreshStatus()
      await this.reload()
    },

    async unstage(files: StatusFile[] | string[]) {
      if (!this.path || !files.length) return
      const paths = files.map((f) => (typeof f === 'string' ? f : f.path))
      await api.unstage(this.path, paths)
      await this.refreshStatus()
    },

    async discard(files: StatusFile[] | string[], untracked = false) {
      if (!this.path || !files.length) return
      const paths = files.map((f) => (typeof f === 'string' ? f : f.path))
      try {
        await api.discard(this.path, paths, untracked)
        this.notify('ok', `已丢弃 ${paths.length} 个文件的改动（已自动打快照）`)
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async commitChanges() {
      if (!this.path) return
      if (!this.commitMessage.trim()) {
        this.notify('err', '提交信息不能为空')
        return
      }
      try {
        const r = await api.commitChanges(this.path, this.commitMessage, this.amend, false)
        this.commitMessage = ''
        this.amend = false
        this.notify('ok', `已提交 ${r.short}`)
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.reload()
        const fresh = this.rows.find((x) => x.oid === r.oid)
        if (fresh) await this.select(fresh)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 同步 ─────────────── */

    async loadBranchStatus() {
      if (!this.path) return
      try {
        this.branchStatus = (await api.branchStatus(this.path)).branches
      } catch {
        this.branchStatus = []
      }
    },

    async deleteRemoteBranch(name: string) {
      if (!this.path) return
      try {
        await api.deleteRemoteBranch(this.path, name)
        this.notify('ok', `已删除远端分支 ${name}`)
        await this.loadBranchStatus()
        this.info = await api.openRepo(this.path)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async deleteSnapshot(ref: string) {
      if (!this.path) return
      try {
        await api.deleteSnapshot(this.path, ref)
        this.notify('ok', '已彻底删除该快照')
        await this.loadSnapshots()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async purgeSnapshots() {
      if (!this.path) return
      try {
        const r = await api.deleteAllSnapshots(this.path)
        this.notify('ok', `已清空 ${r.count} 个安全网快照`)
        await this.loadSnapshots()
        await this.loadReflog()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async sync(kind: 'fetch' | 'pull' | 'push', force = false) {
      if (!this.path) return
      this.syncing = kind
      this.syncOutput = ''
      try {
        const r =
          kind === 'fetch'
            ? await api.fetch(this.path)
            : kind === 'pull'
              ? await api.pull(this.path)
              : await api.push(this.path, force)
        this.syncOutput = r.output || '(无输出)'
        this.notify('ok', `${kind} 完成`)
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.syncing = ''
      }
    },

    /* ─────────────── 安全网 ─────────────── */

    /** 按设置自动清理超过保留天数的快照；默认关闭，失败不影响正常使用 */
    async maybeAutoPruneSnapshots() {
      const settings = useSettingsStore()
      if (!this.path || !settings.snapshotAutoPrune) return
      const days = Math.max(1, Math.floor(settings.snapshotRetentionDays || 30))
      try {
        const r = await api.pruneSnapshots(this.path, days)
        if (r.count > 0) {
          this.notify('info', `已自动清理 ${r.count} 个超过 ${days} 天的安全网快照`)
        }
      } catch {
        // 自动清理失败（例如 git 临时被占用）不影响查看快照
      }
    },

    /** 设置里的「立即清理」：不依赖自动清理开关，按指定天数执行一次 */
    async pruneSnapshotsNow(days: number) {
      if (!this.path) return 0
      const keep = Math.max(1, Math.floor(days || 30))
      const r = await api.pruneSnapshots(this.path, keep)
      await this.loadSnapshots()
      return r.count
    },

    async loadSnapshots() {
      if (!this.path) return
      this.snapshotsLoading = true
      try {
        await this.maybeAutoPruneSnapshots()
        this.snapshots = (await api.snapshots(this.path)).snapshots
      } catch {
        this.snapshots = []
      } finally {
        this.snapshotsLoading = false
      }
    },

    async restoreSnapshot(ref: string) {
      if (!this.path) return
      try {
        await api.restoreSnapshot(this.path, ref)
        this.notify('ok', '已回滚到该快照（回滚前也留了一份快照）')
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.reload()
        await this.loadSnapshots()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 冲突 ─────────────── */

    async openConflict(file: string) {
      if (!this.path) return
      this.conflictFile = file
      this.conflict = null
      this.conflictLoading = true
      try {
        this.conflict = await api.conflict(this.path, file)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
        this.conflictFile = ''
      } finally {
        this.conflictLoading = false
      }
    },

    closeConflict() {
      this.conflictFile = ''
      this.conflict = null
    },

    async saveResolution(content: string) {
      if (!this.path || !this.conflictFile) return
      try {
        await api.resolve(this.path, this.conflictFile, content)
        this.notify('ok', '冲突已解决并暂存')
        this.closeConflict()
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async resolveSide(side: 'ours' | 'theirs') {
      if (!this.path || !this.conflictFile) return
      try {
        await api.resolveSide(this.path, this.conflictFile, side)
        this.notify('ok', `已整文件采用${side === 'ours' ? '我方' : '对方'}`)
        this.closeConflict()
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 暂存 ─────────────── */

    async loadStashes() {
      if (!this.path) return
      this.stashesLoading = true
      try {
        this.stashes = (await api.stashes(this.path)).stashes
      } catch {
        this.stashes = []
      } finally {
        this.stashesLoading = false
      }
    },

    async createStash(message: string, includeUntracked = false) {
      if (!this.path) return
      try {
        await api.createStash(this.path, message, includeUntracked)
        this.notify('ok', '已创建储藏（stash）')
        await this.loadStashes()
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async stashAction(ref: string, action: 'apply' | 'pop' | 'drop') {
      if (!this.path) return
      try {
        await api.stashAction(this.path, ref, action)
        const label = action === 'apply' ? '已应用' : action === 'pop' ? '已弹出' : '已删除'
        this.notify('ok', `${label} ${ref}`)
        await this.loadStashes()
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async openStashDiff(ref: string) {
      if (!this.path) return
      try {
        this.stashDiff = await api.stashDiff(this.path, ref)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    closeStashDiff() {
      this.stashDiff = null
    },

    /* ─────────────── 标签 ─────────────── */

    async loadTags() {
      if (!this.path) return
      try {
        this.tags = (await api.tags(this.path)).tags
      } catch {
        this.tags = []
      }
    },

    async createTag(name: string, message?: string, oid?: string) {
      if (!this.path) return
      try {
        await api.createTag(this.path, name, message, oid)
        this.notify('ok', `已创建标签 ${name}`)
        this.info = await api.openRepo(this.path)
        await this.loadTags()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async deleteTag(name: string) {
      if (!this.path) return
      try {
        await api.deleteTag(this.path, name)
        this.notify('ok', `已删除标签 ${name}`)
        this.info = await api.openRepo(this.path)
        await this.loadTags()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 分支操作 ─────────────── */

    async mergeBranch(name: string) {
      if (!this.path) return
      try {
        const r: MergeResult = await api.mergeBranch(this.path, name)
        if (r.conflicts) {
          this.notify('err', `合并 ${name} 产生冲突，请到工作区解决`)
        } else {
          this.notify('ok', `已合并 ${name}`)
        }
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async deleteBranch(name: string, force = false) {
      if (!this.path) return
      try {
        await api.deleteBranch(this.path, name, force)
        this.notify('ok', `已删除分支 ${name}`)
        this.info = await api.openRepo(this.path)
        await this.reload()
        await this.loadBranchStatus()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async renameBranch(from: string, to: string) {
      if (!this.path) return
      try {
        await api.renameBranch(this.path, from, to)
        this.notify('ok', `已重命名为 ${to}`)
        this.info = await api.openRepo(this.path)
        this.tip = ''
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── reflog ─────────────── */

    async loadReflog() {
      if (!this.path) return
      this.reflogLoading = true
      try {
        this.reflog = (await api.reflog(this.path, 60)).entries
      } catch {
        this.reflog = []
      } finally {
        this.reflogLoading = false
      }
    },

    async resetTo(oid: string, mode: 'soft' | 'mixed' | 'hard') {
      if (!this.path) return
      try {
        await api.resetTo(this.path, oid, mode)
        this.notify('ok', `已 ${mode} 重置到 ${oid.slice(0, 7)}（操作前已打快照）`)
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.reload()
        await this.loadReflog()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 交互式 rebase ─────────────── */

    async refreshRebaseStatus() {
      if (!this.path) return
      try {
        this.rebaseStatus = await api.rebaseStatus(this.path)
      } catch {
        this.rebaseStatus = null
      }
    },

    async openRebase(base?: string) {
      if (!this.path) return
      this.rebaseOpen = true
      this.rebaseCommits = []
      // 没指定基点时，按当前已加载的提交数给一个合理默认值
      const fallback = `HEAD~${Math.min(5, Math.max(1, (this.rows.length || 1) - 1))}`
      const start = base ?? this.rebaseBase ?? fallback
      this.rebaseBase = start
      await this.loadRebasePreview(start)
    },

    async loadRebasePreview(base: string) {
      if (!this.path) return
      this.rebaseLoading = true
      try {
        const res = await api.rebasePreview(this.path, base)
        this.rebaseBase = base
        this.rebaseCommits = res.commits
      } catch (e) {
        this.rebaseCommits = []
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.rebaseLoading = false
      }
    },

    closeRebase() {
      this.rebaseOpen = false
      this.rebaseCommits = []
    },

    async startRebase(steps: RebaseStep[]) {
      if (!this.path) return
      this.rebaseLoading = true
      try {
        const res: RebaseOutcome = await api.rebaseStart(this.path, this.rebaseBase, steps)
        if (res.ok) {
          this.notify('ok', '变基完成')
          this.closeRebase()
        } else if (res.conflicts) {
          this.notify('err', '变基遇到冲突，请到工作区解决后继续')
          this.closeRebase()
        } else {
          this.notify('err', res.output || '变基失败')
        }
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.refreshRebaseStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.rebaseLoading = false
      }
    },

    async rebaseAction(action: 'continue' | 'abort' | 'skip') {
      if (!this.path) return
      try {
        const res = await api.rebaseAction(this.path, action)
        if (res.ok) this.notify('ok', action === 'abort' ? '已中止变基' : '变基已推进')
        else if (res.conflicts) this.notify('err', '仍有冲突未解决')
        else this.notify('err', res.output || '操作失败')
        this.info = await api.openRepo(this.path)
        await this.refreshStatus()
        await this.refreshRebaseStatus()
        await this.reload()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 工作树 ─────────────── */

    async loadWorktrees() {
      if (!this.path) return
      this.worktreesLoading = true
      try {
        const [list, meta] = await Promise.all([
          api.worktrees(this.path),
          api.worktreeMetaList(this.path).catch(() => ({ meta: {} })),
        ])
        this.worktrees = list.worktrees
        this.worktreeMeta = meta.meta || {}
      } catch (e) {
        this.worktrees = []
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.worktreesLoading = false
      }
    },

    async addWorktree(opts: {
      target: string
      branch: string
      newBranch: boolean
      base?: string
      agent?: string
      task?: string
    }): Promise<string | null> {
      if (!this.path) return null
      try {
        const res = await api.addWorktree(this.path, {
          target: opts.target,
          branch: opts.branch,
          newBranch: opts.newBranch,
          base: opts.base,
        })
        if (opts.agent || opts.task) {
          await api
            .worktreeMetaSet(this.path, res.path, opts.agent ?? '', '', opts.task ?? '')
            .catch(() => null)
        }
        this.notify('ok', `已创建工作树：${res.path}`)
        await this.loadWorktrees()
        return res.path
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
        return null
      }
    },

    /** 给某个工作树打上「由谁创建 / 由谁在用」的标记 */
    async setWorktreeAgent(wtPath: string, agent: string) {
      if (!this.path) return
      try {
        const prev = this.worktreeMeta[wtPath]
        await api.worktreeMetaSet(this.path, wtPath, agent, prev?.note ?? '', prev?.task ?? '')
        await this.loadWorktrees()
        this.notify('ok', agent ? `已标记为 ${agent}` : '已清除标记')
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /** 记录这个副本「在做什么」（prompt / issue 链接） */
    async setWorktreeTask(wtPath: string, task: string) {
      if (!this.path) return
      try {
        const prev = this.worktreeMeta[wtPath]
        await api.worktreeMetaSet(this.path, wtPath, prev?.agent ?? '', prev?.note ?? '', task)
        await this.loadWorktrees()
        this.notify('ok', '任务已记录')
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /** 打开工作树时刷新最后活动时间 */
    async touchWorktree(wtPath: string) {
      if (!this.path) return
      await api.worktreeMetaTouch(this.path, wtPath).catch(() => null)
    },

    async loadOverview() {
      this.overviewLoading = true
      try {
        const recents = await recentList()
        const paths = recents.map((r) => r.path)
        if (!paths.length) {
          this.overview = []
          return
        }
        this.overview = (await api.reposOverview(paths)).repos
      } catch (e) {
        this.overview = []
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.overviewLoading = false
      }
    },

    async removeWorktree(target: string, force = false) {
      if (!this.path) return
      try {
        await api.removeWorktree(this.path, target, force)
        this.notify('ok', '工作树已移除')
        await this.loadWorktrees()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    async pruneWorktrees() {
      if (!this.path) return
      try {
        const res = await api.pruneWorktrees(this.path)
        this.notify('ok', res.output ? `已清理：${res.output.slice(0, 60)}` : '没有可清理的工作树')
        await this.loadWorktrees()
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    /* ─────────────── 文件历史 / Blame / 体检 ─────────────── */

    async openFileHistory(file: string) {
      if (!this.path) return
      this.fileHistoryFile = file
      this.fileHistory = []
      try {
        this.fileHistory = (await api.fileHistory(this.path, file, 200)).commits
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    closeFileHistory() {
      this.fileHistoryFile = ''
      this.fileHistory = []
    },

    async openBlame(file: string) {
      if (!this.path) return
      this.blameFile = file
      this.blameLines = []
      try {
        this.blameLines = (await api.blame(this.path, file, 3000)).lines
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      }
    },

    closeBlame() {
      this.blameFile = ''
      this.blameLines = []
    },

    async openHealth() {
      if (!this.path) return
      this.health = null
      this.healthLoading = true
      try {
        this.health = await api.repoHealth(this.path)
      } catch (e) {
        this.notify('err', String((e as Error).message || e))
      } finally {
        this.healthLoading = false
      }
    },

    closeHealth() {
      this.health = null
    },
  },
})

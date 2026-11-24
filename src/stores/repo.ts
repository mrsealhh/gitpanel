import { defineStore } from 'pinia'
import { api } from '../api/git'
import { recentList, recentPin, recentRemove, recentTouch } from '../api/desktop'
import type { RecentRepo } from '../api/desktop'
import type {
  CommandResult,
  CommitDetail,
  CommitRow,
  ConflictDetail,
  FileDiff,
  MergeResult,
  PluginCommand,
  RebaseCommit,
  RebaseOutcome,
  RebaseStatus,
  RebaseStep,
  ReflogEntry,
  RemoteInfo,
  RepoInfo,
  Snapshot,
  Stash,
  StashDiff,
  StatusFile,
  TagInfo,
  WorktreeStatus,
} from '../api/types'

const PAGE_SIZE = 400

export interface Notice {
  kind: 'ok' | 'err' | 'info'
  text: string
}

let noticeTimer: number | undefined

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
    selected: null as CommitRow | null,
    detail: null as CommitDetail | null,
    detailLoading: false,
    diffFile: '',
    diff: null as FileDiff | null,
    diffLoading: false,
    commands: [] as PluginCommand[],
    remotes: [] as RemoteInfo[],
    notice: null as Notice | null,
    commandOutput: null as (CommandResult & { title: string }) | null,
    recents: [] as RecentRepo[],

    // 工作区 / 提交 / 同步
    status: null as WorktreeStatus | null,
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

    // 交互式 rebase
    rebaseOpen: false,
    rebaseBase: 'HEAD~5',
    rebaseCommits: [] as RebaseCommit[],
    rebaseLoading: false,
    rebaseStatus: null as RebaseStatus | null,
  }),

  getters: {
    branches: (s) => s.info?.refs.filter((r) => r.kind === 'branch' || r.kind === 'head') ?? [],
    remotesRefs: (s) => s.info?.refs.filter((r) => r.kind === 'remote') ?? [],
    filteredRows: (s) => {
      const kw = s.search.trim().toLowerCase()
      if (!kw) return s.rows
      return s.rows.filter(
        (r) =>
          r.summary.toLowerCase().includes(kw) ||
          r.author.toLowerCase().includes(kw) ||
          r.short.toLowerCase().includes(kw) ||
          r.refs.some((b) => b.name.toLowerCase().includes(kw)),
      )
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
        await this.reload()
        this.loadExtras()
        await this.refreshRebaseStatus()
        const first = this.rows[0]
        if (first) await this.select(first)
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

    async setTip(tip: string) {
      this.tip = tip
      await this.reload()
    },

    async openFileDiff(file: string) {
      this.diffFile = file
      this.diff = null
      if (!this.path || !this.selected) return
      this.diffLoading = true
      try {
        this.diff = await api.fileDiff(this.path, this.selected.oid, file)
      } catch {
        this.diff = null
      } finally {
        this.diffLoading = false
      }
    },

    closeDiff() {
      this.diffFile = ''
      this.diff = null
    },

    notify(kind: Notice['kind'], text: string) {
      this.notice = { kind, text }
      if (noticeTimer) window.clearTimeout(noticeTimer)
      noticeTimer = window.setTimeout(() => {
        this.notice = null
      }, 3200)
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

    async openWorktreeDiff(file: string, staged: boolean) {
      if (!this.path) return
      this.diffFile = file
      this.diffStaged = staged
      this.diff = null
      this.diffLoading = true
      try {
        this.diff = await api.worktreeDiff(this.path, file, staged)
      } catch {
        this.diff = null
      } finally {
        this.diffLoading = false
      }
    },

    /* ─────────────── 同步 ─────────────── */

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

    async loadSnapshots() {
      if (!this.path) return
      this.snapshotsLoading = true
      try {
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
        this.notify('ok', '已创建暂存')
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
  },
})

import { defineStore } from 'pinia'
import { api } from '../api/git'
import type {
  CommandResult,
  CommitDetail,
  CommitRow,
  FileDiff,
  PluginCommand,
  RemoteInfo,
  RepoInfo,
} from '../api/types'

const RECENT_KEY = 'gitpanel.recent'
const PAGE_SIZE = 400

export interface Notice {
  kind: 'ok' | 'err' | 'info'
  text: string
}

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
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
    recent: loadRecent(),
  }),

  getters: {
    branches: (s) => s.info?.refs.filter((r) => r.kind === 'branch' || r.kind === 'head') ?? [],
    remotesRefs: (s) => s.info?.refs.filter((r) => r.kind === 'remote') ?? [],
    tags: (s) => s.info?.refs.filter((r) => r.kind === 'tag') ?? [],
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
      const list = [path, ...this.recent.filter((p) => p !== path)].slice(0, 8)
      this.recent = list
      localStorage.setItem(RECENT_KEY, JSON.stringify(list))
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
  },
})

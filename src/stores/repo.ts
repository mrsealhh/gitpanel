import { defineStore } from 'pinia'
import { api } from '../api/git'
import type { CommitDetail, CommitRow, RepoInfo } from '../api/types'

const RECENT_KEY = 'gitpanel.recent'
const PAGE_SIZE = 400

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
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
    selected: null as CommitRow | null,
    detail: null as CommitDetail | null,
    detailLoading: false,
    recent: loadRecent(),
  }),

  getters: {
    branches: (s) => s.info?.refs.filter((r) => r.kind === 'branch' || r.kind === 'head') ?? [],
    remotes: (s) => s.info?.refs.filter((r) => r.kind === 'remote') ?? [],
    tags: (s) => s.info?.refs.filter((r) => r.kind === 'tag') ?? [],
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

    async setTip(tip: string) {
      this.tip = tip
      await this.reload()
    },
  },
})

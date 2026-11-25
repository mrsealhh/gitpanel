import { invoke } from '@tauri-apps/api/core'
import type {
  BlameLine,
  BranchStatus,
  CommandResult,
  CommitDetail,
  CompareFile,
  FileDiff,
  FileHistoryEntry,
  FileHunks,
  FileText,
  FsEntry,
  GraphPage,
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
  SyncResult,
  Stash,
  StashDiff,
  TagInfo,
  WorktreeInfo,
  WorktreeMeta,
  WorktreeStatus,
  Snapshot,
  ConflictDetail,
} from './types'

/**
 * 数据适配层：前端唯一的数据入口。
 * - 浏览器/开发态：走 devserver 的 HTTP 桥（端口 7717）
 * - Tauri 运行态：换成 invoke('xxx')，界面代码无需改动
 */
const BASE = (import.meta.env.VITE_API as string | undefined) ?? 'http://127.0.0.1:7717'

/** 桌面态判定：Tauri 会注入 __TAURI_INTERNALS__ */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  // 桌面态：一个通用 RPC 入口，cmd 与 /api/<cmd> 同名，payload 同构
  if (isTauri) {
    return invoke<T>('git_call', { cmd: path.replace('/api/', ''), payload })
  }

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

export const api = {
  health(): Promise<{ ok: boolean }> {
    if (isTauri) return Promise.resolve({ ok: true })
    return fetch(`${BASE}/api/health`).then((r) => r.json())
  },
  openRepo(path: string): Promise<RepoInfo> {
    return post<RepoInfo>('/api/open', { path })
  },
  graph(params: {
    path: string
    offset?: number
    limit?: number
    tip?: string
  }): Promise<GraphPage> {
    return post<GraphPage>('/api/graph', params)
  },
  commit(path: string, oid: string): Promise<CommitDetail> {
    return post<CommitDetail>('/api/commit', { path, oid })
  },
  fileDiff(
    path: string,
    oid: string,
    file: string,
    win?: { fromLine?: number; maxLines?: number; maxBytes?: number },
  ): Promise<FileDiff> {
    return post<FileDiff>('/api/file-diff', { path, oid, file, ...(win ?? {}) })
  },

  /** 插件/自定义命令列表（仓库级 + 用户级） */
  commands(path: string): Promise<{ commands: PluginCommand[] }> {
    return post<{ commands: PluginCommand[] }>('/api/commands', { path })
  },

  runCommand(path: string, id: string): Promise<CommandResult> {
    return post<CommandResult>('/api/run-command', { path, id })
  },

  remotes(path: string): Promise<{ remotes: RemoteInfo[] }> {
    return post<{ remotes: RemoteInfo[] }>('/api/remotes', { path })
  },

  checkout(path: string, ref: string): Promise<{ ok: boolean; branch: string }> {
    return post<{ ok: boolean; branch: string }>('/api/checkout', { path, ref })
  },

  createBranch(
    path: string,
    name: string,
    from?: string,
  ): Promise<{ ok: boolean; branch: string }> {
    return post<{ ok: boolean; branch: string }>('/api/create-branch', { path, name, from })
  },

  /* ── 工作区 ── */
  worktreeStatus(path: string): Promise<WorktreeStatus> {
    return post<WorktreeStatus>('/api/worktree-status', { path })
  },
  worktreeDiff(
    path: string,
    file: string,
    staged: boolean,
    win?: { fromLine?: number; maxLines?: number; maxBytes?: number },
  ): Promise<FileDiff> {
    return post<FileDiff>('/api/worktree-diff', { path, file, staged, ...(win ?? {}) })
  },
  stage(path: string, files: string[]): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/stage', { path, files })
  },
  unstage(path: string, files: string[]): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/unstage', { path, files })
  },
  discard(path: string, files: string[], untracked = false): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/discard', { path, files, untracked })
  },
  commitChanges(
    path: string,
    message: string,
    amend = false,
    addAll = false,
  ): Promise<{ ok: boolean; oid: string; short: string; output: string }> {
    return post('/api/commit-changes', { path, message, amend, addAll })
  },

  /* ── 同步 ── */
  fetch(path: string): Promise<SyncResult> {
    return post<SyncResult>('/api/fetch', { path })
  },
  pull(path: string): Promise<SyncResult> {
    return post<SyncResult>('/api/pull', { path })
  },
  push(path: string, force = false): Promise<SyncResult> {
    return post<SyncResult>('/api/push', { path, force })
  },

  /* ── 安全网 ── */
  snapshots(path: string): Promise<{ snapshots: Snapshot[] }> {
    return post<{ snapshots: Snapshot[] }>('/api/snapshots', { path })
  },
  restoreSnapshot(path: string, ref: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/restore-snapshot', { path, ref })
  },

  /* ── 冲突 ── */
  conflict(path: string, file: string): Promise<ConflictDetail> {
    return post<ConflictDetail>('/api/conflict', { path, file })
  },
  resolve(path: string, file: string, content: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/resolve', { path, file, content })
  },
  resolveSide(path: string, file: string, side: 'ours' | 'theirs'): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/resolve-side', { path, file, side })
  },

  /* ── 暂存 ── */
  stashes(path: string): Promise<{ stashes: Stash[] }> {
    return post<{ stashes: Stash[] }>('/api/stashes', { path })
  },
  createStash(
    path: string,
    message: string,
    includeUntracked = false,
  ): Promise<{ ok: boolean; output: string }> {
    return post('/api/stash-create', { path, message, includeUntracked })
  },
  stashAction(
    path: string,
    ref: string,
    action: 'apply' | 'pop' | 'drop',
  ): Promise<{ ok: boolean; output: string }> {
    return post('/api/stash-action', { path, ref, action })
  },
  stashDiff(path: string, ref: string): Promise<StashDiff> {
    return post<StashDiff>('/api/stash-diff', { path, ref })
  },

  /* ── 标签 ── */
  tags(path: string): Promise<{ tags: TagInfo[] }> {
    return post<{ tags: TagInfo[] }>('/api/tags', { path })
  },
  createTag(
    path: string,
    name: string,
    message?: string,
    oid?: string,
  ): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/tag-create', { path, name, message, oid })
  },
  deleteTag(path: string, name: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/tag-delete', { path, name })
  },

  /* ── 分支操作 ── */
  mergeBranch(path: string, name: string): Promise<MergeResult> {
    return post<MergeResult>('/api/merge-branch', { path, name })
  },
  deleteBranch(path: string, name: string, force = false): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/delete-branch', { path, name, force })
  },
  renameBranch(path: string, from: string, to: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/rename-branch', { path, from, to })
  },

  /* ── reflog / 重置 ── */
  reflog(path: string, limit = 60): Promise<{ entries: ReflogEntry[] }> {
    return post<{ entries: ReflogEntry[] }>('/api/reflog', { path, limit })
  },
  resetTo(path: string, oid: string, mode: 'soft' | 'mixed' | 'hard'): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/reset-to', { path, oid, mode })
  },

  /* ── cherry-pick / revert / 序列状态 ── */

  cherryPick(path: string, oid: string): Promise<MergeResult> {
    return post<MergeResult>('/api/cherry-pick', { path, oid })
  },

  revert(path: string, oid: string): Promise<MergeResult> {
    return post<MergeResult>('/api/revert', { path, oid })
  },

  sequenceStatus(path: string): Promise<SequenceStatus> {
    return post<SequenceStatus>('/api/sequence-status', { path })
  },

  sequenceAction(
    path: string,
    kind: 'cherry-pick' | 'revert',
    action: 'continue' | 'skip' | 'abort',
  ): Promise<{ ok: boolean; output: string }> {
    return post<{ ok: boolean; output: string }>('/api/sequence-action', { path, kind, action })
  },

  ignoreFile(path: string, file: string): Promise<{ ok: boolean; entry: string }> {
    return post<{ ok: boolean; entry: string }>('/api/ignore-file', { path, file })
  },

  branchStatus(path: string): Promise<{ branches: BranchStatus[] }> {
    return post<{ branches: BranchStatus[] }>('/api/branch-status', { path })
  },

  deleteRemoteBranch(path: string, name: string): Promise<{ ok: boolean; output: string }> {
    return post<{ ok: boolean; output: string }>('/api/delete-remote-branch', { path, name })
  },

  deleteSnapshot(path: string, ref: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/delete-snapshot', { path, ref })
  },

  deleteAllSnapshots(path: string): Promise<{ ok: boolean; count: number }> {
    return post<{ ok: boolean; count: number }>('/api/delete-all-snapshots', { path })
  },

  /** 自动清理早于 days 天的安全网快照 */
  pruneSnapshots(path: string, days: number): Promise<{ ok: boolean; count: number }> {
    return post<{ ok: boolean; count: number }>('/api/prune-snapshots', { path, days })
  },

  /* ── hunk 级操作 / 跨提交对比 ── */

  fileHunks(path: string, file: string, staged: boolean): Promise<FileHunks> {
    return post<FileHunks>('/api/file-hunks', { path, file, staged })
  },

  applyHunks(
    path: string,
    file: string,
    staged: boolean,
    indexes: number[],
    mode: 'stage' | 'unstage' | 'discard',
  ): Promise<{ ok: boolean; output: string }> {
    return post<{ ok: boolean; output: string }>('/api/apply-hunks', {
      path,
      file,
      staged,
      indexes,
      mode,
    })
  },

  compare(path: string, a: string, b: string): Promise<{ a: string; b: string; files: CompareFile[] }> {
    return post<{ a: string; b: string; files: CompareFile[] }>('/api/compare', { path, a, b })
  },

  compareFile(
    path: string,
    a: string,
    b: string,
    file: string,
    win?: { fromLine?: number; maxLines?: number; maxBytes?: number },
  ): Promise<FileDiff> {
    return post<FileDiff>('/api/compare-file', { path, a, b, file, ...(win ?? {}) })
  },

  /* ── 交互式 rebase ── */
  rebasePreview(path: string, base: string): Promise<{ base: string; commits: RebaseCommit[] }> {
    return post<{ base: string; commits: RebaseCommit[] }>('/api/rebase-preview', { path, base })
  },
  rebaseStart(path: string, base: string, steps: RebaseStep[]): Promise<RebaseOutcome> {
    return post<RebaseOutcome>('/api/rebase-start', { path, base, steps })
  },
  rebaseStatus(path: string): Promise<RebaseStatus> {
    return post<RebaseStatus>('/api/rebase-status', { path })
  },
  rebaseAction(path: string, action: 'continue' | 'abort' | 'skip'): Promise<RebaseOutcome> {
    return post<RebaseOutcome>('/api/rebase-action', { path, action })
  },

  /* ── 工作树 ── */
  worktrees(path: string): Promise<{ worktrees: WorktreeInfo[] }> {
    return post<{ worktrees: WorktreeInfo[] }>('/api/worktrees', { path })
  },
  worktreeMetaList(path: string): Promise<{ meta: Record<string, WorktreeMeta> }> {
    return post<{ meta: Record<string, WorktreeMeta> }>('/api/worktree-meta-list', { path })
  },
  worktreeMetaSet(
    path: string,
    wtPath: string,
    agent: string,
    note = '',
    task = '',
  ): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/worktree-meta-set', { path, wtPath, agent, note, task })
  },
  worktreeMetaTouch(path: string, wtPath: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/worktree-meta-touch', { path, wtPath })
  },
  reposOverview(paths: string[]): Promise<{ repos: RepoOverview[] }> {
    return post<{ repos: RepoOverview[] }>('/api/repos-overview', { paths })
  },
  addWorktree(
    path: string,
    opts: { target: string; branch: string; newBranch: boolean; base?: string },
  ): Promise<{ ok: boolean; path: string }> {
    return post<{ ok: boolean; path: string }>('/api/worktree-add', { path, ...opts })
  },
  removeWorktree(path: string, target: string, force = false): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/worktree-remove', { path, target, force })
  },
  pruneWorktrees(path: string): Promise<{ ok: boolean; output: string }> {
    return post<{ ok: boolean; output: string }>('/api/worktree-prune', { path })
  },

  /* ── 文件历史 / Blame / 体检 ── */
  fileHistory(path: string, file: string, limit = 200): Promise<{ file: string; commits: FileHistoryEntry[] }> {
    return post<{ file: string; commits: FileHistoryEntry[] }>('/api/file-history', { path, file, limit })
  },
  blame(path: string, file: string, max = 2000): Promise<{ file: string; lines: BlameLine[]; truncated?: boolean }> {
    return post<{ file: string; lines: BlameLine[]; truncated?: boolean }>('/api/blame', { path, file, max })
  },
  repoHealth(path: string): Promise<RepoHealth> {
    return post<RepoHealth>('/api/repo-health', { path })
  },

  /* ── 项目本地文件（查看 / 编辑） ── */

  fsList(path: string, dir = ''): Promise<{ dir: string; entries: FsEntry[] }> {
    return post<{ dir: string; entries: FsEntry[] }>('/api/fs-list', { path, dir })
  },

  fsFiles(path: string): Promise<{ files: string[] }> {
    return post<{ files: string[] }>('/api/fs-files', { path })
  },

  fsGrep(
    path: string,
    query: string,
    max = 300,
  ): Promise<{ hits: { file: string; line: number; text: string }[]; limitReached: boolean }> {
    return post<{ hits: { file: string; line: number; text: string }[]; limitReached: boolean }>(
      '/api/fs-grep',
      { path, query, max },
    )
  },

  fsRead(path: string, file: string, maxBytes = 2 * 1024 * 1024): Promise<FileText> {
    return post<FileText>('/api/fs-read', { path, file, maxBytes })
  },

  fsWrite(
    path: string,
    file: string,
    content: string,
  ): Promise<{ ok: boolean; file: string; size: number; lines: number }> {
    return post<{ ok: boolean; file: string; size: number; lines: number }>('/api/fs-write', {
      path,
      file,
      content,
    })
  },
}

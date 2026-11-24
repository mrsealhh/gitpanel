import type {
  CommandResult,
  CommitDetail,
  FileDiff,
  GraphPage,
  PluginCommand,
  RemoteInfo,
  RepoInfo,
  SyncResult,
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

async function post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
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
  fileDiff(path: string, oid: string, file: string): Promise<FileDiff> {
    return post<FileDiff>('/api/file-diff', { path, oid, file })
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
  worktreeDiff(path: string, file: string, staged: boolean): Promise<FileDiff> {
    return post<FileDiff>('/api/worktree-diff', { path, file, staged })
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
}

import type { CommitDetail, GraphPage, RepoInfo } from './types'

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
}

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 桌面态判定：Tauri 会注入 __TAURI_INTERNALS__ */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface RecentRepo {
  path: string
  name: string
  alias: string
  openedAt: number
  pinned: boolean
}

const LS_KEY = 'gitpanel.recents'

function lsList(): RecentRepo[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

function lsSave(list: RecentRepo[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

/* ── 最近打开：桌面态走 SQLite，浏览器态回退 localStorage ── */

export async function recentList(): Promise<RecentRepo[]> {
  if (isTauri) {
    try {
      return await invoke<RecentRepo[]>('recent_list')
    } catch {
      return []
    }
  }
  return lsList()
}

export async function recentTouch(path: string, name: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke('recent_touch', { path, name })
    } catch {
      /* 忽略：不影响主流程 */
    }
    return
  }
  const list = lsList().filter((r) => r.path !== path)
  list.unshift({ path, name, alias: '', openedAt: Date.now(), pinned: false })
  lsSave(list.slice(0, 50))
}

export async function recentRemove(path: string): Promise<void> {
  if (isTauri) {
    await invoke('recent_remove', { path })
    return
  }
  lsSave(lsList().filter((r) => r.path !== path))
}

export async function recentPin(path: string, pinned: boolean): Promise<void> {
  if (isTauri) {
    await invoke('recent_pin', { path, pinned })
    return
  }
  lsSave(lsList().map((r) => (r.path === path ? { ...r, pinned } : r)))
}

/** 重命名项目：名字全局唯一，冲突自动补 1/2/3，返回最终名称 */
export async function recentRename(path: string, alias: string): Promise<string> {
  if (isTauri) {
    return invoke<string>('project_rename', { path, alias })
  }

  const list = lsList()
  const base = alias.trim()
  if (!base) {
    lsSave(list.map((r) => (r.path === path ? { ...r, alias: '' } : r)))
    return ''
  }
  const taken = new Set(
    list.filter((r) => r.path !== path).map((r) => (r.alias || r.name).toLowerCase()),
  )
  let finalName = base
  let n = 1
  while (taken.has(finalName.toLowerCase())) {
    finalName = `${base}${n}`
    n += 1
  }
  lsSave(list.map((r) => (r.path === path ? { ...r, alias: finalName } : r)))
  return finalName
}

/** 原生文件夹选择；浏览器态返回 null */
export async function pickFolder(title = '选择文件夹'): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const res = await open({ directory: true, multiple: false, title })
    return typeof res === 'string' ? res : null
  } catch {
    return null
  }
}

/** 本机 git 身份（只读，不保存凭据） */
export async function gitIdentity(): Promise<{ name: string; email: string }> {
  if (!isTauri) {
    try {
      const r = await fetch('http://127.0.0.1:7717/api/git-identity', { method: 'POST' })
      return await r.json()
    } catch {
      return { name: '', email: '' }
    }
  }
  try {
    return await invoke<{ name: string; email: string }>('git_identity')
  } catch {
    return { name: '', email: '' }
  }
}

/** 克隆仓库（返回新的仓库路径） */
export async function cloneRepo(url: string, target: string): Promise<string> {
  if (isTauri) {
    return invoke<string>('clone_repo', { url, target })
  }
  const res = await fetch('http://127.0.0.1:7717/api/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, target }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error || '克隆失败')
  return (data as { path: string }).path
}

/* ── 外部链接 ── */

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    await invoke('open_external', { url })
    return
  }
  window.open(url, '_blank', 'noopener')
}

/* ── 窗口控制（无边框自绘） ── */

export type ResizeDir =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest'

export async function minimizeWindow(): Promise<void> {
  if (isTauri) await getCurrentWindow().minimize()
}

export async function toggleMaximize(): Promise<boolean> {
  if (!isTauri) return false
  const w = getCurrentWindow()
  await w.toggleMaximize()
  return w.isMaximized()
}

export async function isMaximized(): Promise<boolean> {
  if (!isTauri) return false
  return getCurrentWindow().isMaximized()
}

export async function hideToTray(): Promise<void> {
  if (isTauri) await invoke('hide_to_tray')
}

export async function exitApp(): Promise<void> {
  if (isTauri) await invoke('exit_app')
}

export async function closeWindow(action: 'tray' | 'exit'): Promise<void> {
  if (!isTauri) return
  if (action === 'exit') await exitApp()
  else await hideToTray()
}

export async function startResize(dir: ResizeDir): Promise<void> {
  if (!isTauri) return
  await getCurrentWindow().startResizeDragging(dir as never)
}

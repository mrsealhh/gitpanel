import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 桌面态判定：Tauri 会注入 __TAURI_INTERNALS__ */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface RecentRepo {
  path: string
  name: string
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
  list.unshift({ path, name, openedAt: Date.now(), pinned: false })
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

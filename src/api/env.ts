import { invoke } from '@tauri-apps/api/core'

/** 桌面态判定：Tauri 会注入 __TAURI_INTERNALS__ */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * 启动参数里的仓库路径（`gitpanel.exe <repo>`）。
 * 浏览器态返回 null，由调用方回退到 URL 参数。
 */
export async function startupRepo(): Promise<string | null> {
  if (!isTauri) return null
  try {
    return (await invoke<string | null>('startup_repo')) ?? null
  } catch {
    return null
  }
}

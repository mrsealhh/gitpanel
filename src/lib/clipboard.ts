import { invoke } from '@tauri-apps/api/core'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * 复制到剪贴板。
 * Windows WebView 里 `navigator.clipboard` 经常因为权限/非用户手势失败，
 * 所以在 Tauri 环境下优先走 Rust 侧系统剪贴板（arboard），最后才是 textarea 兜底。
 */
export async function copyText(text: string): Promise<boolean> {
  if (isTauri) {
    try {
      await invoke('copy_text', { text })
      return true
    } catch {
      /* 落到浏览器方案 */
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 走回退 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

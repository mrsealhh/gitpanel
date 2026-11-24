import { defineStore } from 'pinia'
import { isTauri } from '../api/desktop'
import { checkUpdate } from '../api/update'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'uptodate'
  | 'error'

type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished'; data?: unknown }

interface NativeUpdate {
  version: string
  body?: string
  downloadAndInstall: (cb: (e: DownloadEvent) => void) => Promise<void>
}

/** 插件返回的 Update 句柄不能进响应式 state，单独存 */
let nativeHandle: NativeUpdate | null = null

export const useUpdateStore = defineStore('update', {
  state: () => ({
    phase: 'idle' as UpdatePhase,
    version: '',
    notes: '',
    percent: 0,
    message: '',
  }),

  getters: {
    busy: (s) => s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'installing',
    hasUpdate: (s) => s.phase === 'available' || s.phase === 'downloading',
  },

  actions: {
    async check() {
      if (this.busy) return
      this.phase = 'checking'
      this.message = ''
      this.percent = 0

      // 桌面态：走 Tauri updater（带签名校验）
      if (isTauri) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater')
          const handle = (await check()) as unknown as NativeUpdate | null
          if (!handle) {
            this.phase = 'uptodate'
            return
          }
          nativeHandle = handle
          this.version = handle.version
          this.notes = handle.body ?? ''
          this.phase = 'available'
        } catch (e) {
          this.phase = 'error'
          this.message = String((e as Error).message || e)
        }
        return
      }

      // 浏览器态：查 GitHub Releases，仅提示
      const info = await checkUpdate()
      if (!info) {
        this.phase = 'error'
        this.message = '检查失败：网络不可用或还没有发布 Release'
        return
      }
      this.version = info.latest
      this.notes = info.notes
      this.phase = info.newer ? 'available' : 'uptodate'
    },

    /** 下载并安装，成功后自动重启。返回是否已重启 */
    async install(): Promise<boolean> {
      if (!isTauri || !nativeHandle) {
        // 浏览器态只能跳下载页
        const info = await checkUpdate()
        if (info?.newer) window.open(info.url, '_blank', 'noopener')
        return false
      }

      try {
        this.phase = 'downloading'
        this.percent = 0
        let total = 0
        let got = 0

        await nativeHandle.downloadAndInstall((ev) => {
          if (ev.event === 'Started') {
            total = ev.data.contentLength ?? 0
          } else if (ev.event === 'Progress') {
            got += ev.data.chunkLength
            this.percent = total ? Math.min(99, Math.round((got / total) * 100)) : 0
          } else if (ev.event === 'Finished') {
            this.phase = 'installing'
            this.percent = 100
          }
        })

        this.phase = 'installing'
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
        return true
      } catch (e) {
        this.phase = 'error'
        this.message = String((e as Error).message || e)
        return false
      }
    },
  },
})

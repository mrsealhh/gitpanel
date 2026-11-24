import { defineStore } from 'pinia'

export type ThemeId = 'dark' | 'midnight' | 'light' | 'contrast'
export type Density = 'compact' | 'normal' | 'relaxed'

/** 画布泳道配色：Canvas 不认 CSS 变量，按主题各给一套 */
export const LANE_PALETTES: Record<ThemeId, string[]> = {
  dark: [
    '#5b9dff', '#f2a93b', '#3ddc97', '#f472b6', '#a78bfa',
    '#38bdf8', '#fb7185', '#eab308', '#2dd4bf', '#c084fc',
  ],
  midnight: [
    '#38bdf8', '#fbbf24', '#34d399', '#f472b6', '#a78bfa',
    '#22d3ee', '#fb7185', '#facc15', '#2dd4bf', '#c4b5fd',
  ],
  light: [
    '#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed',
    '#0284c7', '#e11d48', '#ca8a04', '#0d9488', '#9333ea',
  ],
  contrast: [
    '#00e5ff', '#ffd400', '#00ff9d', '#ff5edb', '#b48cff',
    '#4dd2ff', '#ff6b6b', '#fff176', '#00ffcc', '#e0a8ff',
  ],
}

export const THEME_LABELS: Record<ThemeId, string> = {
  dark: '深色（默认）',
  midnight: '午夜蓝',
  light: '浅色',
  contrast: '高对比',
}

export const DENSITY_LABELS: Record<Density, string> = {
  compact: '紧凑',
  normal: '标准',
  relaxed: '宽松',
}

const KEY = 'gitpanel.settings'

interface Persisted {
  theme: ThemeId
  density: Density
  relativeTime: boolean
  showGraph: boolean
  confirmDangerous: boolean
  graphWidth: number
  /** 最小化按钮：收进托盘 */
  minimizeToTray: boolean
  /** 关闭按钮：收进托盘 或 直接退出 */
  closeAction: 'tray' | 'exit'
  /** 启动时自动检查更新 */
  autoCheckUpdate: boolean
  /** 检查到更新后自动下载安装（静默更新） */
  autoInstallUpdate: boolean
  /** 左侧面板宽度 / 是否显示 */
  leftWidth: number
  showLeft: boolean
  /** 右侧面板宽度 / 是否显示 */
  rightWidth: number
  showRight: boolean
  /** 大文件 diff：单次最多显示多少行（0 = 不限行） */
  diffMaxLines: number
  /** 大文件阈值（KB）：超过就提示「已按性能优先分段加载」 */
  diffLargeKB: number
}

function load(): Persisted {
  const fallback: Persisted = {
    theme: 'dark',
    density: 'normal',
    relativeTime: true,
    showGraph: true,
    confirmDangerous: true,
    graphWidth: 14,
    minimizeToTray: true,
    closeAction: 'tray',
    autoCheckUpdate: true,
    autoInstallUpdate: false,
    leftWidth: 240,
    showLeft: true,
    rightWidth: 340,
    showRight: true,
    diffMaxLines: 3000,
    diffLargeKB: 512,
  }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return fallback
  }
}

const ROW_HEIGHT: Record<Density, number> = { compact: 24, normal: 28, relaxed: 32 }

export const useSettingsStore = defineStore('settings', {
  state: () => load(),

  getters: {
    rowHeight: (s) => ROW_HEIGHT[s.density],
    palette: (s) => LANE_PALETTES[s.theme],
    themeLabel: (s) => THEME_LABELS[s.theme],
  },

  actions: {
    init() {
      const t = new URLSearchParams(location.search).get('theme')
      if (t && t in THEME_LABELS) {
        // 深链接主题只做预览，不写入本地设置
        this.theme = t as ThemeId
        document.documentElement.dataset.theme = this.theme
        return
      }
      this.applyTheme()
    },

    applyTheme() {
      document.documentElement.dataset.theme = this.theme
      this.save()
    },

    setTheme(theme: ThemeId) {
      this.theme = theme
      this.applyTheme()
    },

    save() {
      const {
        theme,
        density,
        relativeTime,
        showGraph,
        confirmDangerous,
        graphWidth,
        minimizeToTray,
        closeAction,
        autoCheckUpdate,
        autoInstallUpdate,
        leftWidth,
        showLeft,
        rightWidth,
        showRight,
        diffMaxLines,
        diffLargeKB,
      } = this
      localStorage.setItem(
        KEY,
        JSON.stringify({
          theme,
          density,
          relativeTime,
          showGraph,
          confirmDangerous,
          graphWidth,
          minimizeToTray,
          closeAction,
          autoCheckUpdate,
          autoInstallUpdate,
          leftWidth,
          showLeft,
          rightWidth,
          showRight,
          diffMaxLines,
          diffLargeKB,
        }),
      )
    },

    reset() {
      this.theme = 'dark'
      this.density = 'normal'
      this.relativeTime = true
      this.showGraph = true
      this.confirmDangerous = true
      this.graphWidth = 14
      this.minimizeToTray = true
      this.closeAction = 'tray'
      this.autoCheckUpdate = true
      this.autoInstallUpdate = false
      this.leftWidth = 240
      this.showLeft = true
      this.rightWidth = 340
      this.showRight = true
      this.diffMaxLines = 3000
      this.diffLargeKB = 512
      this.applyTheme()
    },
  },
})

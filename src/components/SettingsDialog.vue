<script setup lang="ts">
import { computed } from 'vue'
import { DENSITY_LABELS, THEME_LABELS, useSettingsStore } from '../stores/settings'
import type { Density, ThemeId } from '../stores/settings'
import { APP_VERSION, REPO_URL } from '../api/update'
import { isTauri, openExternal } from '../api/desktop'
import { useUpdateStore } from '../stores/update'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const update = useUpdateStore()

const themes = computed(() =>
  (Object.keys(THEME_LABELS) as ThemeId[]).map((id) => ({
    id,
    label: THEME_LABELS[id],
    active: settings.theme === id,
  })),
)

const densities = computed(() =>
  (Object.keys(DENSITY_LABELS) as Density[]).map((id) => ({
    id,
    label: DENSITY_LABELS[id],
    active: settings.density === id,
  })),
)

const shortcuts = [
  { keys: 'Ctrl + K', desc: '打开命令面板' },
  { keys: 'Ctrl + ,', desc: '打开设置' },
  { keys: 'Ctrl + F', desc: '搜索提交' },
  { keys: '↑ / ↓', desc: '切换提交' },
  { keys: 'Enter', desc: '查看变更文件 Diff' },
  { keys: 'Esc', desc: '关闭当前面板' },
]

const MCP_SNIPPET = `{
  "mcpServers": {
    "gitpanel": {
      "command": "C:\\\\Program Files\\\\GitPanel\\\\gitpanel-mcp.exe"
    }
  }
}`

function copyMcpConfig() {
  void navigator.clipboard?.writeText(MCP_SNIPPET)
}

const updateStatus = computed(() => {  switch (update.phase) {
    case 'checking':
      return '检查中…'
    case 'uptodate':
      return `已是最新版本（v${APP_VERSION}）`
    case 'available':
      return `发现新版本 v${update.version}`
    case 'downloading':
      return `下载中 ${update.percent}%`
    case 'installing':
      return '正在安装，随后自动重启…'
    case 'error':
      return update.message || '检查失败'
    default:
      return ''
  }
})
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[8vh]" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[82vh] w-[660px] flex-col overflow-hidden">
      <header class="line-b flex items-center px-5 py-3">
        <h2 class="text-[14px] font-semibold t1">设置</h2>
        <button class="btn ml-auto" @click="emit('close')">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">主题</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="t in themes"
              :key="t.id"
              class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition"
              :style="{
                borderColor: t.active ? 'var(--accent)' : 'var(--border)',
                background: t.active ? 'var(--accent-weak)' : 'transparent',
              }"
              @click="settings.setTheme(t.id)"
            >
              <span
                class="h-6 w-6 shrink-0 rounded-full border"
                :style="{
                  background: `linear-gradient(135deg, ${t.id === 'light' ? '#ffffff' : '#12151d'} 50%, ${t.id === 'contrast' ? '#00e5ff' : t.id === 'midnight' ? '#38bdf8' : t.id === 'light' ? '#2563eb' : '#5b9dff'} 50%)`,
                  borderColor: 'var(--border-strong)',
                }"
              />
              <span class="text-[12px] t1">{{ t.label }}</span>
              <span v-if="t.active" class="ml-auto text-[11px] accent">✓</span>
            </button>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">列表密度</h3>
          <div class="flex gap-2">
            <button
              v-for="d in densities"
              :key="d.id"
              class="btn"
              :style="d.active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
              @click="settings.density = d.id; settings.save()"
            >
              {{ d.label }}
            </button>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">显示</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">显示分支图</span>
            <input type="checkbox" v-model="settings.showGraph" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">相对时间（15 hours ago）</span>
            <input type="checkbox" v-model="settings.relativeTime" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">危险操作需二次确认</span>
            <input type="checkbox" v-model="settings.confirmDangerous" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">大文件 Diff</h3>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">单次最多显示行数（按性能优先）</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="settings.diffMaxLines"
                type="number"
                min="0"
                step="500"
                class="field w-[96px] px-2 py-1 text-right text-[12px]"
                @change="settings.save()"
              />
              <span class="text-[11px] t3">行</span>
            </div>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">大文件阈值</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="settings.diffLargeKB"
                type="number"
                min="0"
                step="128"
                class="field w-[96px] px-2 py-1 text-right text-[12px]"
                @change="settings.save()"
              />
              <span class="text-[11px] t3">KB</span>
            </div>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed t3">
            超过阈值时按上面的行数分段读取，不会截断丢内容：点「继续加载」一段段往后翻。填 0 表示不限。
          </p>
        </section>

        <section v-if="isTauri" class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">窗口行为</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">最小化时收进系统托盘</span>
            <input type="checkbox" v-model="settings.minimizeToTray" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">点击关闭按钮</span>
            <div class="flex gap-2">
              <button
                class="btn"
                :style="settings.closeAction === 'tray' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
                @click="settings.closeAction = 'tray'; settings.save()"
              >
                收进托盘
              </button>
              <button
                class="btn"
                :style="settings.closeAction === 'exit' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
                @click="settings.closeAction = 'exit'; settings.save()"
              >
                直接退出
              </button>
            </div>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">更新</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">启动时自动检查更新</span>
            <input type="checkbox" v-model="settings.autoCheckUpdate" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">发现更新后自动下载安装（静默更新）</span>
            <input type="checkbox" v-model="settings.autoInstallUpdate" class="h-4 w-4 accent-[var(--accent)]" @change="settings.save()" />
          </label>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button class="btn" :disabled="update.busy" @click="update.check()">
              {{ update.phase === 'checking' ? '检查中…' : '立即检查更新' }}
            </button>
            <button v-if="update.hasUpdate" class="btn btn-primary" @click="update.install()">
              更新到 v{{ update.version }}
            </button>
            <span v-if="updateStatus" class="text-[11px] t3">{{ updateStatus }}</span>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed t3">
            更新包经 minisign 签名校验，只接受本仓库发布且签名匹配的安装包。静默更新会在后台下载安装并自动重启。
          </p>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">快捷键</h3>
          <div class="rounded-lg border" :style="{ borderColor: 'var(--border)' }">
            <div
              v-for="(s, i) in shortcuts"
              :key="s.keys"
              class="flex items-center justify-between px-3 py-1.5 text-[12px]"
              :class="i > 0 ? 'line-t' : ''"
            >
              <span class="t2">{{ s.desc }}</span>
              <kbd class="rounded border px-1.5 py-0.5 font-mono text-[11px] t3" :style="{ borderColor: 'var(--border)' }">
                {{ s.keys }}
              </kbd>
            </div>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">MCP 接入（给第三方 AI）</h3>
          <p class="mb-2 text-[11px] leading-relaxed t3">
            `gitpanel-mcp.exe` 是一个 stdio MCP 服务端，Claude Desktop / Cursor / Continue 等可直接调用，
            能读取仓库信息，也能执行暂存、提交、建分支、工作树等写操作。
          </p>
          <pre
            class="mb-2 overflow-x-auto rounded border p-2 font-mono text-[10px] leading-relaxed"
            :style="{ borderColor: 'var(--border)', background: 'var(--panel-2)', color: 'var(--text-dim)' }"
          >{ "mcpServers": { "gitpanel": { "command": "&lt;安装目录&gt;\\gitpanel-mcp.exe" } } }</pre>
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn" @click="copyMcpConfig">复制配置</button>
            <span class="text-[10px] t3">只读模式：设置环境变量 GITPANEL_MCP_READ_ONLY=1</span>
          </div>
        </section>

        <section>
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">关于</h3>
          <div class="rounded-lg border px-3 py-2 text-[12px]" :style="{ borderColor: 'var(--border)' }">
            <div class="flex items-center justify-between">
              <span class="t2">GitPanel</span>
              <span class="font-mono text-[11px] t3">v{{ APP_VERSION }}</span>
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button class="btn" @click="openExternal(REPO_URL)">GitHub 仓库</button>
              <span class="text-[11px] t3">本地运行，不上传任何数据</span>
            </div>
          </div>
        </section>
      </div>

      <footer class="line-t flex items-center px-5 py-3">
        <span class="text-[11px] t3">设置保存在本地，随主题即时生效</span>
        <button class="btn ml-auto" @click="settings.reset()">恢复默认</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DENSITY_LABELS, THEME_LABELS, useSettingsStore } from '../stores/settings'
import type { Density, ThemeId } from '../stores/settings'
import { APP_VERSION, REPO_URL } from '../api/update'
import { isTauri, openExternal } from '../api/desktop'
import { useUpdateStore } from '../stores/update'
import { useRepoStore } from '../stores/repo'
import { copyText } from '../lib/clipboard'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const update = useUpdateStore()
const repo = useRepoStore()

/** 统一的设置反馈：改完立刻告诉用户生效了 */
function toast(text: string, kind: 'ok' | 'info' | 'err' = 'ok') {
  repo.notify(kind, text)
}

function applyTheme(id: ThemeId) {
  settings.setTheme(id)
  toast(`主题已切换：${THEME_LABELS[id]}`)
}

function applyDensity(id: Density) {
  settings.density = id
  settings.save()
  toast(`列表密度：${DENSITY_LABELS[id]}`)
}

function saveToggle(label: string, on: boolean) {
  settings.save()
  toast(`${label}：${on ? '已开启' : '已关闭'}`)
}

function saveNumber(label: string) {
  settings.save()
  toast(`${label}已保存`)
}

function saveRetention() {
  settings.snapshotRetentionDays = Math.max(1, Math.floor(Number(settings.snapshotRetentionDays) || 30))
  settings.save()
  toast(`安全网保留天数：${settings.snapshotRetentionDays} 天`)
}

function saveLogRetention() {
  settings.logRetentionDays = Math.max(1, Math.floor(Number(settings.logRetentionDays) || 30))
  settings.save()
  toast(`日志保留天数：${settings.logRetentionDays} 天`)
}

function pruneLogsNow() {
  const days = Math.max(1, Math.floor(Number(settings.logRetentionDays) || 30))
  settings.logRetentionDays = days
  settings.save()
  const n = repo.pruneLogsNow(days)
  toast(n ? `已清理 ${n} 条超过 ${days} 天的操作日志` : `没有超过 ${days} 天的操作日志`, n ? 'ok' : 'info')
}

async function pruneNow() {
  if (!repo.path) {
    toast('先打开一个仓库，再清理安全网快照', 'err')
    return
  }
  const days = Math.max(1, Math.floor(Number(settings.snapshotRetentionDays) || 30))
  settings.snapshotRetentionDays = days
  settings.save()
  try {
    const n = await repo.pruneSnapshotsNow(days)
    toast(n ? `已清理 ${n} 个超过 ${days} 天的快照` : `没有超过 ${days} 天的快照`, n ? 'ok' : 'info')
  } catch (e) {
    toast(String((e as Error).message || e), 'err')
  }
}

function resetAll() {
  settings.reset()
  toast('已恢复默认设置')
}

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
  void copyText(MCP_SNIPPET).then((ok) => {
    if (ok) toast('MCP 配置已复制到剪贴板，粘贴到客户端的 mcpServers 里即可')
    else toast('复制失败：请手动选中下面这段配置复制', 'err')
  })
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
              @click="applyTheme(t.id)"
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
              @click="applyDensity(d.id)"
            >
              {{ d.label }}
            </button>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">显示</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">显示分支图</span>
            <input type="checkbox" v-model="settings.showGraph" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('显示分支图', settings.showGraph)" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">相对时间（15 hours ago）</span>
            <input type="checkbox" v-model="settings.relativeTime" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('相对时间', settings.relativeTime)" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">危险操作需二次确认</span>
            <input type="checkbox" v-model="settings.confirmDangerous" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('危险操作二次确认', settings.confirmDangerous)" />
          </label>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">安全网</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">自动清理旧快照（默认关闭）</span>
            <input
              v-model="settings.snapshotAutoPrune"
              type="checkbox"
              class="h-4 w-4 accent-[var(--accent)]"
              @change="saveToggle('安全网自动清理', settings.snapshotAutoPrune)"
            />
          </label>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">保留天数</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="settings.snapshotRetentionDays"
                type="number"
                min="1"
                step="1"
                class="field w-[72px] px-2 py-1 text-right text-[12px]"
                @change="saveRetention"
              />
              <span class="text-[11px] t3">天</span>
              <button class="btn px-2 py-1 text-[11px]" @click="pruneNow">立即清理一次</button>
            </div>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed t3">
            开启后，打开仓库或查看安全网时会自动删除超过保留天数的快照；关闭时不会自动删除任何快照。
          </p>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">操作日志</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">自动清理旧日志（默认关闭）</span>
            <input
              v-model="settings.logAutoPrune"
              type="checkbox"
              class="h-4 w-4 accent-[var(--accent)]"
              @change="saveToggle('操作日志自动清理', settings.logAutoPrune)"
            />
          </label>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">保留天数</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="settings.logRetentionDays"
                type="number"
                min="1"
                step="1"
                class="field w-[72px] px-2 py-1 text-right text-[12px]"
                @change="saveLogRetention"
              />
              <span class="text-[11px] t3">天</span>
              <button class="btn px-2 py-1 text-[11px]" @click="pruneLogsNow">立即清理一次</button>
            </div>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed t3">
            开启后，启动应用或打开「操作日志」时会自动删除超过保留天数的日志；关闭时不会自动删除任何日志。
          </p>
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
                @change="saveNumber('单次最多显示行数')"
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
                @change="saveNumber('大文件阈值')"
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
            <input type="checkbox" v-model="settings.minimizeToTray" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('最小化到托盘', settings.minimizeToTray)" />
          </label>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-[12px] t2">点击关闭按钮</span>
            <div class="flex gap-2">
              <button
                class="btn"
                :style="settings.closeAction === 'tray' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
                @click="settings.closeAction = 'tray'; settings.save(); toast('关闭按钮：收进托盘')"
              >
                收进托盘
              </button>
              <button
                class="btn"
                :style="settings.closeAction === 'exit' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
                @click="settings.closeAction = 'exit'; settings.save(); toast('关闭按钮：直接退出')"
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
            <input type="checkbox" v-model="settings.autoCheckUpdate" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('启动自动检查更新', settings.autoCheckUpdate)" />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">发现更新后自动下载安装（静默更新）</span>
            <input type="checkbox" v-model="settings.autoInstallUpdate" class="h-4 w-4 accent-[var(--accent)]" @change="saveToggle('静默自动安装', settings.autoInstallUpdate)" />
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
        <button class="btn ml-auto" @click="resetAll()">恢复默认</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import { apiBusy } from '../api/git'

const repo = useRepoStore()
const settings = useSettingsStore()

const counts = computed(() => ({
  rows: repo.rows.length,
  plugins: repo.commands.length,
}))

const errCount = computed(() => repo.logs.filter((l) => l.kind === 'err').length)
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center gap-3 px-3 text-[11px]"
    :style="{ background: 'var(--panel-3)', borderTop: '1px solid var(--border)', color: 'var(--text-mute)' }"
  >
    <span class="flex items-center gap-1">
      <span class="h-1.5 w-1.5 rounded-full" style="background: var(--accent)" />
      {{ repo.info?.branch || '—' }}
    </span>
    <span class="truncate">{{ repo.path || '未打开仓库' }}</span>
    <span v-if="repo.tip" class="rounded px-1.5 py-0.5" :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }">
      过滤：{{ repo.tip }}
    </span>

    <span v-if="apiBusy > 0" class="flex items-center gap-1" :style="{ color: 'var(--accent)' }">
      <span class="busy-spinner" />
      处理中<span v-if="apiBusy > 1"> ×{{ apiBusy }}</span>
    </span>

    <span class="ml-auto">{{ counts.rows }} commits</span>
    <span v-if="counts.plugins">· {{ counts.plugins }} 个插件命令</span>
    <button
      class="rounded px-1.5 py-0.5 hover:bg-black/10"
      :style="errCount ? { color: '#f87171' } : {}"
      :title="errCount ? `${errCount} 个错误，点开查看原因和原始输出` : '操作日志'"
      @click="repo.logOpen = true"
    >
      日志{{ errCount ? ` · ${errCount}` : '' }}
    </button>
    <span v-if="repo.selected" class="font-mono">{{ repo.selected.short }}</span>
    <span>· {{ settings.themeLabel }}</span>
  </footer>
</template>

<style scoped>
.busy-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: busy-spin 0.7s linear infinite;
}
@keyframes busy-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

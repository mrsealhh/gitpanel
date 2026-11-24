<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'

const repo = useRepoStore()
const settings = useSettingsStore()

const counts = computed(() => ({
  rows: repo.rows.length,
  plugins: repo.commands.length,
}))
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

    <span class="ml-auto">{{ counts.rows }} commits</span>
    <span v-if="counts.plugins">· {{ counts.plugins }} 个插件命令</span>
    <span v-if="repo.selected" class="font-mono">{{ repo.selected.short }}</span>
    <span>· {{ settings.themeLabel }}</span>
  </footer>
</template>

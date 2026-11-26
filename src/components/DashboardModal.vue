<script setup lang="ts">
import { onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import { relativeTime } from '../utils/time'
import IconButton from './IconButton.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'open', path: string): void; (e: 'manage'): void }>()
const repo = useRepoStore()

onMounted(() => repo.loadOverview())

function groupOf(path: string) {
  return repo.recents.find((r) => r.path === path)?.groupPath || ''
}

function drift(r: { ahead: number; behind: number }) {
  if (!r.ahead && !r.behind) return '同步'
  return `${r.ahead ? `↑${r.ahead}` : ''}${r.behind ? ` ↓${r.behind}` : ''}`
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[8vh]" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[80vh] w-[820px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-3">
        <span class="text-[13px] font-semibold t1">多仓库看板</span>
        <span class="text-[11px] t3">最近打开的仓库，一次看清漂移与脏改动</span>
        <span v-if="repo.overviewLoading" class="inline-flex items-center gap-1 text-[10px]" :style="{ color: 'var(--accent)' }">
          <span class="inline-block h-2 w-2 animate-spin rounded-full border border-current border-r-transparent" />
          {{ repo.overviewProgress.done }} / {{ repo.overviewProgress.total }}
        </span>
        <button class="btn ml-auto px-2 py-1 text-[11px]" @click="emit('manage'); emit('close')">整理 / 分组</button>
        <IconButton name="refresh" title="刷新" :size="14" @click="repo.loadOverview()" />
        <button class="btn" @click="emit('close')">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="repo.overviewLoading && !repo.overview.length" class="p-6 text-center text-[12px] t3">
          正在统计（仓库多时需要几秒）…
        </div>
        <div v-else-if="!repo.overview.length" class="p-6 text-center text-[12px] t3">
          还没有最近打开的仓库，可以用「整理 / 分组」里的扫描文件夹批量导入
        </div>

        <table v-else class="w-full border-collapse text-[12px]">
          <thead class="sticky top-0" :style="{ background: 'var(--panel-3)' }">
            <tr class="text-left text-[10px] uppercase tracking-wider t3">
              <th class="px-3 py-1.5 font-medium">仓库</th>
              <th class="px-2 py-1.5 font-medium">分组</th>
              <th class="px-2 py-1.5 font-medium">分支</th>
              <th class="w-16 px-2 py-1.5 text-center font-medium">漂移</th>
              <th class="w-14 px-2 py-1.5 text-center font-medium">改动</th>
              <th class="w-14 px-2 py-1.5 text-center font-medium">工作树</th>
              <th class="w-24 px-2 py-1.5 text-right font-medium">最后活动</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in repo.overview" :key="r.path" class="row-hover cursor-pointer border-b"
              :style="{ borderColor: 'var(--border)' }" :title="r.path" @click="emit('open', r.path); emit('close')">
              <td class="px-3 py-1.5">
                <div class="truncate t1">{{ r.name }}</div>
                <div class="truncate font-mono text-[10px] t3">{{ r.path }}</div>
              </td>
              <td class="px-2 py-1.5">
                <span class="text-[10px] t3">{{ groupOf(r.path) || '—' }}</span>
              </td>
              <td class="px-2 py-1.5">
                <span class="badge badge-branch">{{ r.branch || '—' }}</span>
              </td>
              <td class="px-2 py-1.5 text-center" :style="{ color: r.ahead || r.behind ? 'var(--accent)' : 'var(--text-mute)' }">
                {{ drift(r) }}
              </td>
              <td class="px-2 py-1.5 text-center" :style="{ color: r.dirty ? 'var(--badge-tag-fg)' : 'var(--text-mute)' }">
                {{ r.dirty || '—' }}
              </td>
              <td class="px-2 py-1.5 text-center t3">{{ r.worktrees }}</td>
              <td class="px-2 py-1.5 text-right t3">{{ r.lastCommit ? relativeTime(r.lastCommit) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

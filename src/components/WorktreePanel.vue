<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import IconButton from './IconButton.vue'
import Icon from './Icon.vue'
import { relativeTime } from '../utils/time'

const emit = defineEmits<{ (e: 'create'): void; (e: 'open', path: string): void }>()
const repo = useRepoStore()

onMounted(() => repo.loadWorktrees())

const totalDirty = computed(() => repo.worktrees.reduce((n, w) => n + w.dirty, 0))

async function copyPath(p: string) {
  await navigator.clipboard?.writeText(p)
  repo.notify('ok', '已复制路径')
}

async function remove(wt: { path: string; dirty: number; isCurrent: boolean }) {
  if (wt.isCurrent) {
    repo.notify('err', '不能移除当前正在使用的工作树')
    return
  }
  const force = wt.dirty > 0
  const msg = force
    ? `该工作树有 ${wt.dirty} 个未提交改动，\n确定强制移除？改动会丢失（主仓库已有安全网快照不影响它）`
    : '确定移除该工作树？（只移除目录，分支保留）'
  if (!window.confirm(msg)) return
  await repo.removeWorktree(wt.path, force)
}
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">工作树</span>
      <span class="ml-2 text-[11px] t3">{{ repo.worktrees.length }} 个 · {{ totalDirty }} 处改动</span>
      <IconButton class="ml-auto" name="plus" title="新建工作树" :size="14" @click="emit('create')" />
      <IconButton name="refresh" title="刷新" :size="14" @click="repo.loadWorktrees()" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="repo.worktreesLoading" class="p-3 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.worktrees.length" class="p-3 text-[12px] t3">还没有工作树</div>

      <div v-for="wt in repo.worktrees" :key="wt.path" class="row-hover group mx-2 my-1 rounded border px-2 py-1.5"
        :style="{ borderColor: wt.isCurrent ? 'var(--accent)' : 'var(--border)' }">
        <div class="flex items-center gap-1.5">
          <Icon name="folder" :size="13" class="shrink-0 t3" />
          <span class="min-w-0 flex-1 truncate text-[12px] t1">{{ wt.branch || '（分离头指针）' }}</span>
          <span v-if="wt.isCurrent" class="badge shrink-0"
            :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }">当前</span>
          <span v-if="wt.locked" class="badge shrink-0"
            :style="{ background: 'var(--badge-tag-bg)', color: 'var(--badge-tag-fg)' }">锁定</span>
          <span v-if="wt.prunable" class="badge shrink-0"
            :style="{ background: 'var(--badge-remote-bg)', color: 'var(--badge-remote-fg)' }">可清理</span>
        </div>

        <div class="mt-0.5 truncate font-mono text-[10px] t3" :title="wt.path">{{ wt.path }}</div>

        <div class="mt-0.5 flex items-center gap-2 text-[10px] t3">
          <span v-if="wt.dirty" style="color: var(--badge-tag-fg)">{{ wt.dirty }} 处改动</span>
          <span v-else>干净</span>
          <span v-if="wt.ahead" style="color: var(--accent)">↑{{ wt.ahead }}</span>
          <span v-if="wt.behind" style="color: var(--accent)">↓{{ wt.behind }}</span>
          <span v-if="wt.aiHints.length" class="rounded px-1"
            :style="{ background: 'var(--panel-3)' }" :title="wt.aiHints.join(', ')">AI 配置</span>
          <span class="ml-auto">{{ wt.lastCommit ? relativeTime(wt.lastCommit) : '—' }}</span>
        </div>

        <div class="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <button v-if="!wt.isCurrent" class="btn px-1.5 py-0 text-[10px]" @click="emit('open', wt.path)">打开</button>
          <button class="btn px-1.5 py-0 text-[10px]" @click="copyPath(wt.path)">复制路径</button>
          <button v-if="!wt.isCurrent" class="btn px-1.5 py-0 text-[10px]" style="color: #f87171"
            @click="remove(wt)">移除</button>
        </div>
      </div>
    </div>

    <div class="line-t p-2 text-[10px] leading-relaxed t3">
      工作树让多个分支同时检出到不同目录，适合并行跑多个 AI 会话；每个工作树共用同一份 .git。
    </div>
  </div>
</template>

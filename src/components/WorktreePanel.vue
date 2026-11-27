<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import IconButton from './IconButton.vue'
import Icon from './Icon.vue'
import { formatDate, relativeTime } from '../utils/time'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'open', path: string): void
  (e: 'set-agent', path: string): void
  (e: 'set-task', path: string): void
}>()
const repo = useRepoStore()
const settings = useSettingsStore()

onMounted(() => repo.loadWorktrees())
// 切换仓库 / 工作树后重新拉取，保证「当前」标记与路径一致
watch(() => repo.path, () => repo.loadWorktrees())

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
/** 以实际打开的仓库路径为准，避免列表还没刷新时把当前工作树判断错 */
function isCurrent(wt: { path: string; isCurrent: boolean }) {
  if (repo.path) return norm(repo.path) === norm(wt.path)
  return wt.isCurrent
}

function metaOf(p: string) {
  return repo.worktreeMeta[p]
}

/** 最后活动时间统一成秒：meta 存的是毫秒，git 给的是秒 */
function lastActive(wt: { path: string; lastCommit: number }) {
  const m = metaOf(wt.path)
  if (m?.lastUsedAt) return Math.floor(m.lastUsedAt / 1000)
  return wt.lastCommit || 0
}

function lastActiveLabel(wt: { path: string; lastCommit: number }) {
  const t = lastActive(wt)
  if (!t) return '—'
  return settings.relativeTime ? relativeTime(t) : formatDate(t)
}

const totalDirty = computed(() => repo.worktrees.reduce((n, w) => n + w.dirty, 0))

async function copyPath(p: string) {
  await navigator.clipboard?.writeText(p)
  repo.notify('ok', '已复制路径')
}

function onCardClick(wt: { path: string; isCurrent: boolean; exists: boolean }) {
  if (isCurrent(wt)) return
  if (!wt.exists) {
    repo.notify('err', '这个工作树的目录已经不在了，可以点右上角「清理」移除登记')
    return
  }
  emit('open', wt.path)
}

async function remove(wt: { path: string; dirty: number; isCurrent: boolean; exists: boolean }) {
  if (isCurrent(wt)) {
    repo.notify('err', '不能移除当前正在使用的工作树')
    return
  }
  if (!wt.exists) {
    if (!window.confirm('这个工作树的目录已经不存在了，确定清理这条登记？')) return
    await repo.pruneWorktrees()
    return
  }
  const force = wt.dirty > 0
  const msg = force
    ? `该工作树有 ${wt.dirty} 个未提交 / 未跟踪改动，\n确定强制移除？改动会丢失（主仓库已有安全网快照不影响它）`
    : '确定移除该工作树？（只移除目录，分支保留）'
  if (!window.confirm(msg)) return
  const res = await repo.removeWorktree(wt.path, force)
  if (res.ok) return
  const err = res.error || ''
  // 目录里有未跟踪 / 未提交文件时 git 默认拒绝删除，问一次再强制删
  if (/modified|untracked|contain/i.test(err)) {
    if (window.confirm('该工作树里还有未提交或未跟踪的文件，\n强制移除会一起删掉。确定强制移除？')) {
      await repo.removeWorktree(wt.path, true)
    }
  } else if (/locked/i.test(err)) {
    await repo.removeWorktree(wt.path, true)
  }
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
        :class="isCurrent(wt) || !wt.exists ? '' : 'cursor-pointer'"
        :style="{ borderColor: isCurrent(wt) ? 'var(--accent)' : 'var(--border)' }"
        :title="wt.exists ? (isCurrent(wt) ? '当前工作树' : '点击切换到该工作树') : '目录已不存在，可点「清理」移除登记'"
        @click="onCardClick(wt)">
        <div class="flex items-center gap-1.5">
          <Icon name="folder" :size="13" class="shrink-0 t3" />
          <span class="min-w-0 flex-1 truncate text-[12px] t1">{{ wt.branch || '（分离头指针）' }}</span>
          <span v-if="isCurrent(wt)" class="badge shrink-0"
            :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }">当前</span>
          <span v-if="wt.locked" class="badge shrink-0"
            :style="{ background: 'var(--badge-tag-bg)', color: 'var(--badge-tag-fg)' }">锁定</span>
          <span v-if="wt.prunable" class="badge shrink-0"
            :style="{ background: 'var(--badge-remote-bg)', color: 'var(--badge-remote-fg)' }">可清理</span>
        </div>

        <div class="mt-0.5 truncate font-mono text-[10px] t3" :title="wt.path">{{ wt.path }}</div>

        <div v-if="metaOf(wt.path)?.task" class="mt-0.5 truncate text-[10px]" :title="metaOf(wt.path)?.task"
          :style="{ color: 'var(--text-dim)' }">
          ▸ {{ metaOf(wt.path)?.task }}
        </div>

        <div class="mt-0.5 flex items-center gap-2 text-[10px] t3">
          <span
            v-if="wt.merged"
            class="rounded px-1"
            :style="{ background: 'var(--badge-head-bg)', color: 'var(--badge-head-fg)' }"
            title="该分支已合回主干"
          >
            已合回
          </span>
          <span
            v-if="metaOf(wt.path)?.agent"
            class="rounded px-1"
            :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }"
            :title="`由 ${metaOf(wt.path)?.agent} 使用`"
          >
            {{ metaOf(wt.path)?.agent }}
          </span>
          <span v-if="wt.dirty" style="color: var(--badge-tag-fg)">{{ wt.dirty }} 处改动</span>
          <span v-else>干净</span>
          <span v-if="wt.ahead" style="color: var(--accent)">↑{{ wt.ahead }}</span>
          <span v-if="wt.behind" style="color: var(--accent)">↓{{ wt.behind }}</span>
          <span
            v-if="wt.aiHints.length"
            class="rounded px-1"
            :style="{ background: 'var(--panel-3)' }"
            :title="wt.aiHints.join(', ')"
          >
            AI 配置
          </span>
          <span class="ml-auto">{{ lastActiveLabel(wt) }}</span>
        </div>

        <div class="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100" @click.stop>
          <IconButton v-if="!isCurrent(wt)" compact name="external" title="打开这个工作树" :size="12" @click="emit('open', wt.path)" />
          <IconButton compact name="copy" title="复制工作树路径" :size="12" @click="copyPath(wt.path)" />
          <IconButton compact name="user" title="标记使用这个工作树的 Agent" :size="12" @click="emit('set-agent', wt.path)" />
          <IconButton compact name="task" title="记录这个工作树在做什么" :size="12" @click="emit('set-task', wt.path)" />
          <IconButton
            v-if="!isCurrent(wt)"
            compact
            name="trash"
            title="移除工作树（目录删除，分支保留）"
            danger
            :size="12"
            @click="remove(wt)"
          />
        </div>
      </div>
    </div>

    <div class="line-t p-2 text-[10px] leading-relaxed t3">
      工作树让多个分支同时检出到不同目录，适合并行跑多个 AI 会话；每个工作树共用同一份 .git。
    </div>
  </div>
</template>

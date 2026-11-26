<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import IconButton from './IconButton.vue'
import type { StatusFile } from '../api/types'

const emit = defineEmits<{ (e: 'conflict', file: string): void; (e: 'hunks', payload: { file: string; staged: boolean }): void }>()

const repo = useRepoStore()
const settings = useSettingsStore()

type Zone = 'staged' | 'unstaged' | 'untracked'
const selected = ref<Set<string>>(new Set())
const selKey = (zone: Zone, path: string) => `${zone}:${path}`

function isSelected(zone: Zone, path: string) {
  return selected.value.has(selKey(zone, path))
}

function toggleSelect(zone: Zone, path: string) {
  const next = new Set(selected.value)
  const key = selKey(zone, path)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

/** Ctrl / Cmd 点击多选；普通点击仍然是打开 diff */
function onRowClick(e: MouseEvent, zone: Zone, f: StatusFile, staged = false) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    toggleSelect(zone, f.path)
    return
  }
  open(f, staged)
}

function picked(zone: Zone, list: StatusFile[]) {
  return list.filter((f) => isSelected(zone, f.path))
}

function clearSelection() {
  selected.value = new Set()
}

const selectedCount = computed(() => selected.value.size)

async function batch(zone: Zone, action: 'stage' | 'unstage' | 'discard' | 'delete') {
  const st = repo.status
  if (!st) return
  const list = zone === 'staged' ? st.staged : zone === 'unstaged' ? st.unstaged : st.untracked
  const files = picked(zone, list)
  if (!files.length) return
  if (action === 'stage') await repo.stage(files)
  else if (action === 'unstage') await repo.unstage(files)
  else if (action === 'discard') {
    if (settings.confirmDangerous && !window.confirm(`丢弃选中的 ${files.length} 个文件的改动？\n（会先自动打安全网快照）`)) return
    await repo.discard(files, false)
  } else {
    if (settings.confirmDangerous && !window.confirm(`删除选中的 ${files.length} 个未跟踪文件？`)) return
    await repo.discard(files, true)
  }
  clearSelection()
}

const st = computed(() => repo.status)
const hasStaged = computed(() => (st.value?.staged.length ?? 0) > 0)

const total = computed(() => {
  const s = st.value
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length
})

const stats = computed(() => {
  const s = st.value
  if (!s) return null
  return {
    staged: s.staged.length,
    unstaged: s.unstaged.length,
    untracked: s.untracked.length,
    conflicted: s.conflicted.length,
  }
})

function statusColor(s: string) {
  if (s === 'A' || s === '?') return 'var(--badge-head-fg)'
  if (s === 'D') return '#f87171'
  if (s === 'U') return '#fb923c'
  return 'var(--accent)'
}

async function discardOne(f: StatusFile, untracked = false) {
  if (settings.confirmDangerous) {
    const ok = window.confirm(`确定丢弃 ${f.path} 的改动？\n（会先自动创建安全网快照）`)
    if (!ok) return
  }
  await repo.discard([f], untracked)
}

function open(f: StatusFile, staged: boolean) {
  if (f.status === 'U' || st.value?.conflicted.some((c) => c.path === f.path)) {
    emit('conflict', f.path)
    return
  }
  repo.openWorktreeDiff(f.path, staged)
}

/** 选中行的底色 */
function rowStyle(zone: Zone, path: string) {
  return isSelected(zone, path) ? { background: 'var(--accent-weak)' } : {}
}
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex h-8 shrink-0 items-center gap-2 px-3">
      <span v-if="stats" class="flex items-center gap-2 text-[10px] t3">
        <span v-if="stats.staged" :style="{ color: 'var(--badge-head-fg)' }">已暂存 {{ stats.staged }}</span>
        <span v-if="stats.unstaged" :style="{ color: 'var(--accent)' }">未暂存 {{ stats.unstaged }}</span>
        <span v-if="stats.untracked">未跟踪 {{ stats.untracked }}</span>
        <span v-if="stats.conflicted" style="color: #fb923c">冲突 {{ stats.conflicted }}</span>
        <span v-if="!total">干净</span>
      </span>
      <span v-if="selectedCount" class="ml-2 text-[10px]" :style="{ color: 'var(--accent)' }">
        已选 {{ selectedCount }}
        <button class="ml-1 underline" @click="clearSelection">取消选择</button>
      </span>
      <IconButton class="ml-auto" compact name="refresh" title="刷新工作区" :size="13" @click="repo.refreshStatus()" />
    </div>

    <!-- 待推送 / 待拉取：直接在这里推拉 -->
    <div
      v-if="repo.status?.ahead || repo.status?.behind"
      class="line-b flex shrink-0 items-center gap-2 px-3 py-1 text-[11px]"
      :style="{ background: 'var(--panel-2)' }"
    >
      <span v-if="repo.status?.ahead" :style="{ color: 'var(--accent)' }">↑{{ repo.status.ahead }} 待推送</span>
      <span v-if="repo.status?.behind" class="t3">↓{{ repo.status.behind }} 待拉取</span>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <IconButton compact name="fetch" title="抓取（fetch）" :size="13" :disabled="!!repo.syncing" @click="repo.sync('fetch')" />
        <IconButton compact name="pull" title="拉取（pull）" :size="13" :disabled="!!repo.syncing" @click="repo.sync('pull')" />
        <IconButton compact name="push" title="推送（push）" :size="13" :disabled="!!repo.syncing" @click="repo.sync('push')" />
      </div>
    </div>

    <div
      v-if="repo.rebaseStatus?.inProgress"
      class="line-b shrink-0 px-3 py-1.5"
      :style="{ background: 'rgba(251,146,60,.10)' }"
    >
      <div class="flex items-center gap-2">
        <span class="text-[11px] font-medium" style="color: #fb923c">
          {{ repo.rebaseStatus.stopped && !repo.rebaseStatus.conflicts ? '变基已暂停' : '变基进行中' }}
        </span>
        <span v-if="repo.rebaseStatus.conflicts" class="text-[10px]" style="color: #fb923c">
          {{ repo.rebaseStatus.conflicted.length }} 个冲突
        </span>
        <div class="ml-auto flex gap-1">
          <button class="btn px-1.5 py-0 text-[10px]" :disabled="repo.rebaseStatus.conflicts" @click="repo.rebaseAction('continue')">继续</button>
          <button class="btn px-1.5 py-0 text-[10px]" @click="repo.rebaseAction('skip')">跳过</button>
          <button class="btn px-1.5 py-0 text-[10px]" style="color: #f87171" @click="repo.rebaseAction('abort')">中止</button>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!st" class="p-3 text-[12px] t3">{{ repo.statusLoading ? '读取中…' : '未打开仓库' }}</div>
      <div v-else-if="st.clean" class="p-3 text-[12px] t3">工作区干净，没有待处理的改动</div>

      <template v-else>
        <!-- 冲突 -->
        <section v-if="st.conflicted.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium" style="color: #fb923c">
            冲突 <span class="opacity-70">{{ st.conflicted.length }}</span>
          </div>
          <button
            v-for="f in st.conflicted"
            :key="'c' + f.path"
            class="row-hover flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12px]"
            @click="emit('conflict', f.path)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" style="color: #fb923c">!</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <span class="shrink-0 rounded px-1 text-[10px]" :style="{ background: 'rgba(251,146,60,.15)', color: '#fb923c' }">解决</span>
          </button>
        </section>

        <!-- 已暂存 -->
        <section v-if="st.staged.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            已暂存 <span class="opacity-70">{{ st.staged.length }}</span>
            <span class="ml-auto flex items-center gap-1">
              <template v-if="picked('staged', st.staged).length">
                <span class="text-[10px]" :style="{ color: 'var(--accent)' }">已选 {{ picked('staged', st.staged).length }}</span>
                <IconButton compact name="minus" title="取消暂存所选" :size="12" @click="batch('staged', 'unstage')" />
              </template>
              <IconButton compact name="minus" title="全部取消暂存" :size="12" @click="repo.unstage(st.staged)" />
            </span>
          </div>
          <div
            v-for="f in st.staged"
            :key="'s' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            :style="rowStyle('staged', f.path)"
            @click="onRowClick($event, 'staged', f, true)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <IconButton compact class="opacity-0 group-hover:opacity-100" name="blocks" title="按 diff 块取消暂存" :size="12" @click.stop="emit('hunks', { file: f.path, staged: true })" />
            <IconButton compact class="opacity-0 group-hover:opacity-100" name="minus" title="取消暂存这个文件" :size="12" @click.stop="repo.unstage([f])" />
          </div>
        </section>

        <!-- 未暂存 -->
        <section v-if="st.unstaged.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            未暂存 <span class="opacity-70">{{ st.unstaged.length }}</span>
            <span class="ml-auto flex items-center gap-1">
              <template v-if="picked('unstaged', st.unstaged).length">
                <span class="text-[10px]" :style="{ color: 'var(--accent)' }">已选 {{ picked('unstaged', st.unstaged).length }}</span>
                <IconButton compact name="plus" title="暂存所选" :size="12" @click="batch('unstaged', 'stage')" />
                <IconButton compact name="undo" title="丢弃所选改动" danger :size="12" @click="batch('unstaged', 'discard')" />
              </template>
              <IconButton compact name="plus" title="全部暂存" :size="12" @click="repo.stage(st.unstaged)" />
            </span>
          </div>
          <div
            v-for="f in st.unstaged"
            :key="'u' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            :style="rowStyle('unstaged', f.path)"
            @click="onRowClick($event, 'unstaged', f, false)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <IconButton compact class="opacity-60 hover:opacity-100" name="plus" title="暂存这个文件" :size="12" @click.stop="repo.stage([f])" />
            <IconButton compact class="opacity-60 hover:opacity-100" name="blocks" title="按 diff 块暂存 / 丢弃" :size="12" @click.stop="emit('hunks', { file: f.path, staged: false })" />
            <IconButton compact class="opacity-60 hover:opacity-100" name="undo" title="丢弃这个文件的改动" danger :size="12" @click.stop="discardOne(f)" />
          </div>
        </section>

        <!-- 未跟踪 -->
        <section v-if="st.untracked.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            未跟踪 <span class="opacity-70">{{ st.untracked.length }}</span>
            <span class="ml-auto flex items-center gap-1">
              <template v-if="picked('untracked', st.untracked).length">
                <span class="text-[10px]" :style="{ color: 'var(--accent)' }">已选 {{ picked('untracked', st.untracked).length }}</span>
                <IconButton compact name="plus" title="暂存所选" :size="12" @click="batch('untracked', 'stage')" />
                <IconButton compact name="trash" title="删除所选未跟踪文件" danger :size="12" @click="batch('untracked', 'delete')" />
              </template>
              <IconButton compact name="plus" title="全部暂存" :size="12" @click="repo.stage(st.untracked)" />
            </span>
          </div>
          <div
            v-for="f in st.untracked"
            :key="'n' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            :style="rowStyle('untracked', f.path)"
            @click="onRowClick($event, 'untracked', f, false)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" style="color: var(--badge-head-fg)">U</span>
            <span class="min-w-0 flex-1 truncate font-mono t2">{{ f.path }}</span>
            <IconButton compact class="opacity-60 hover:opacity-100" name="plus" title="暂存这个文件" :size="12" @click.stop="repo.stage([f])" />
            <IconButton compact class="opacity-60 hover:opacity-100" name="trash" title="删除这个未跟踪文件" danger :size="12" @click.stop="discardOne(f, true)" />
          </div>
        </section>
      </template>
    </div>

    <!-- 提交区 -->
    <div class="line-t shrink-0 p-2">
      <textarea
        v-model="repo.commitMessage"
        rows="2"
        placeholder="提交信息（Ctrl+Enter 提交）"
        class="field w-full resize-none px-2 py-1 text-[12px] leading-snug"
        @keydown.ctrl.enter.prevent="repo.commitChanges()"
      />
      <div class="mt-1 flex items-center gap-2">
        <label class="flex cursor-pointer items-center gap-1 text-[11px] t3">
          <input v-model="repo.amend" type="checkbox" class="h-3 w-3 accent-[var(--accent)]" />
          amend
        </label>
        <label class="flex cursor-pointer items-center gap-1 text-[11px] t3" title="提交成功后自动 push 当前分支">
          <input
            v-model="settings.autoPushAfterCommit"
            type="checkbox"
            class="h-3 w-3 accent-[var(--accent)]"
            @change="settings.save()"
          />
          提交后推送
        </label>
        <span class="text-[10px] t3">Ctrl 点击可多选文件</span>
        <button
          class="btn btn-primary ml-auto px-3 py-1 text-[12px]"
          :disabled="!repo.commitMessage.trim() || (!hasStaged && !repo.amend)"
          :style="!repo.commitMessage.trim() || (!hasStaged && !repo.amend) ? { opacity: 0.45 } : {}"
          @click="repo.commitChanges()"
        >
          提交{{ hasStaged ? ` (${st?.staged.length})` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

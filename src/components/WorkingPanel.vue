<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import type { StatusFile } from '../api/types'

const emit = defineEmits<{ (e: 'conflict', file: string): void }>()

const repo = useRepoStore()
const settings = useSettingsStore()

const st = computed(() => repo.status)
const hasStaged = computed(() => (st.value?.staged.length ?? 0) > 0)

const total = computed(() => {
  const s = st.value
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length
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
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">工作区</span>
      <span class="ml-2 text-[11px] t3">{{ total }} 项改动</span>
      <button class="btn ml-auto px-2 py-0.5 text-[11px]" @click="repo.refreshStatus()">刷新</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!st" class="p-3 text-[12px] t3">{{ repo.statusLoading ? '读取中…' : '未打开仓库' }}</div>
      <div v-else-if="st.clean" class="p-3 text-[12px] t3">工作区干净，没有待处理的改动</div>

      <template v-else>
        <!-- 冲突 -->
        <section v-if="st.conflicted.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium" style="color: #fb923c">
            冲突
            <span class="opacity-70">{{ st.conflicted.length }}</span>
          </div>
          <button
            v-for="f in st.conflicted"
            :key="'c' + f.path"
            class="row-hover flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12px]"
            @click="emit('conflict', f.path)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" style="color: #fb923c">!</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <span class="shrink-0 rounded px-1 text-[10px]" :style="{ background: 'rgba(251,146,60,.15)', color: '#fb923c' }">
              解决
            </span>
          </button>
        </section>

        <!-- 已暂存 -->
        <section v-if="st.staged.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            已暂存
            <span class="opacity-70">{{ st.staged.length }}</span>
            <button class="ml-auto text-[10px] accent hover:underline" @click="repo.unstage(st.staged)">全部取消</button>
          </div>
          <div
            v-for="f in st.staged"
            :key="'s' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            @click="open(f, true)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <button
              class="shrink-0 text-[10px] t3 opacity-0 hover:accent group-hover:opacity-100"
              @click.stop="repo.unstage([f])"
            >
              取消暂存
            </button>
          </div>
        </section>

        <!-- 未暂存 -->
        <section v-if="st.unstaged.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            未暂存
            <span class="opacity-70">{{ st.unstaged.length }}</span>
            <button class="ml-auto text-[10px] accent hover:underline" @click="repo.stage(st.unstaged)">全部暂存</button>
          </div>
          <div
            v-for="f in st.unstaged"
            :key="'u' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            @click="open(f, false)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" :style="{ color: statusColor(f.status) }">{{ f.status }}</span>
            <span class="min-w-0 flex-1 truncate font-mono t1">{{ f.path }}</span>
            <button class="shrink-0 text-[10px] accent opacity-0 group-hover:opacity-100" @click.stop="repo.stage([f])">
              暂存
            </button>
            <button class="shrink-0 text-[10px] text-rose-400 opacity-0 group-hover:opacity-100" @click.stop="discardOne(f)">
              丢弃
            </button>
          </div>
        </section>

        <!-- 未跟踪 -->
        <section v-if="st.untracked.length">
          <div class="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-medium t3">
            未跟踪
            <span class="opacity-70">{{ st.untracked.length }}</span>
            <button class="ml-auto text-[10px] accent hover:underline" @click="repo.stage(st.untracked)">全部暂存</button>
          </div>
          <div
            v-for="f in st.untracked"
            :key="'n' + f.path"
            class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[12px]"
            @click="repo.openWorktreeDiff(f.path, false)"
          >
            <span class="w-3 shrink-0 font-mono text-[10px]" style="color: var(--badge-head-fg)">U</span>
            <span class="min-w-0 flex-1 truncate font-mono t2">{{ f.path }}</span>
            <button class="shrink-0 text-[10px] accent opacity-0 group-hover:opacity-100" @click.stop="repo.stage([f])">
              暂存
            </button>
            <button class="shrink-0 text-[10px] text-rose-400 opacity-0 group-hover:opacity-100" @click.stop="discardOne(f, true)">
              删除
            </button>
          </div>
        </section>
      </template>
    </div>

    <!-- 提交区 -->
    <div class="line-t p-2">
      <textarea
        v-model="repo.commitMessage"
        rows="3"
        placeholder="提交信息（Ctrl+Enter 提交）"
        class="field w-full resize-none px-2 py-1.5 text-[12px] leading-snug"
        @keydown.ctrl.enter.prevent="repo.commitChanges()"
      />
      <div class="mt-1.5 flex items-center gap-2">
        <label class="flex cursor-pointer items-center gap-1 text-[11px] t3">
          <input v-model="repo.amend" type="checkbox" class="h-3 w-3 accent-[var(--accent)]" />
          amend
        </label>
        <button
          class="btn btn-primary ml-auto px-3 py-1 text-[12px]"
          :disabled="!repo.commitMessage.trim() || (!hasStaged && !repo.amend)"
          :style="!repo.commitMessage.trim() || (!hasStaged && !repo.amend) ? { opacity: 0.45 } : {}"
          @click="repo.commitChanges()"
        >
          提交 {{ hasStaged ? `(${st?.staged.length})` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRepoStore } from '../stores/repo'
import type { RebaseAction, RebaseCommit, RebaseStep } from '../api/types'

const repo = useRepoStore()

const base = ref(repo.rebaseBase || 'HEAD~5')
const steps = ref<RebaseStep[]>([])
const dragIndex = ref(-1)
const overIndex = ref(-1)

const ACTION_LABELS: Record<RebaseAction, string> = {
  pick: '保留',
  reword: '保留（改说明）',
  edit: '保留（停下来改）',
  squash: '合并到上一个',
  fixup: '合并（丢说明）',
  drop: '丢弃',
}

watch(
  () => repo.rebaseCommits,
  (commits: RebaseCommit[]) => {
    steps.value = commits.map((c, i) => ({
      oid: c.oid,
      action: i === 0 ? 'pick' : 'pick',
      subject: c.subject,
    }))
  },
  { immediate: true },
)

const summary = computed(() => {
  const kept = steps.value.filter((s) => s.action !== 'drop').length
  const merged = steps.value.filter((s) => s.action === 'squash' || s.action === 'fixup').length
  const dropped = steps.value.filter((s) => s.action === 'drop').length
  return { kept, merged, dropped, total: steps.value.length }
})

const firstInvalid = computed(() => {
  const firstKept = steps.value.find((s) => s.action !== 'drop')
  return !firstKept || !['pick', 'reword', 'edit'].includes(firstKept.action)
})

function commitOf(step: RebaseStep): RebaseCommit | undefined {
  return repo.rebaseCommits.find((c) => c.oid === step.oid)
}

function move(from: number, to: number) {
  if (to < 0 || to >= steps.value.length || from === to) return
  const arr = steps.value.slice()
  const [item] = arr.splice(from, 1)
  arr.splice(to, 0, item)
  steps.value = arr
}

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(i: number) {
  if (dragIndex.value >= 0) move(dragIndex.value, i)
  dragIndex.value = -1
  overIndex.value = -1
}

function setAction(i: number, action: RebaseAction) {
  steps.value = steps.value.map((s, idx) => (idx === i ? { ...s, action } : s))
}

async function loadBase() {
  await repo.loadRebasePreview(base.value.trim())
}

async function start() {
  await repo.startRebase(steps.value)
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[6vh]" @click.self="repo.closeRebase()">
    <div class="modal animate-pop flex max-h-[84vh] w-[720px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-3">
        <span class="text-[13px] font-semibold t1">交互式 rebase</span>
        <span class="text-[11px] t3">从基点之后的提交可以被重排、合并、丢弃</span>
        <button class="btn ml-auto" @click="repo.closeRebase()">关闭</button>
      </header>

      <div class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="shrink-0 text-[11px] t3">基点</span>
        <input
          v-model="base"
          class="field min-w-0 flex-1 px-2 py-1 font-mono text-[12px]"
          placeholder="HEAD~5 或某个分支名"
          @keydown.enter="loadBase"
        />
        <button class="btn shrink-0" @click="loadBase">加载</button>
        <button class="btn shrink-0" @click="base = 'HEAD~3'; loadBase()">~3</button>
        <button class="btn shrink-0" @click="base = 'HEAD~10'; loadBase()">~10</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div v-if="repo.rebaseLoading" class="p-4 text-[12px] t3">读取提交…</div>
        <div v-else-if="!steps.length" class="p-4 text-[12px] t3">
          没有可整理的提交，换个基点试试（基点必须是当前分支的祖先）。
        </div>

        <div
          v-for="(step, i) in steps"
          :key="step.oid"
          class="mb-1 flex items-center gap-2 rounded px-2 py-1.5"
          :style="{
            background: overIndex === i ? 'var(--accent-weak)' : 'var(--panel-2)',
            opacity: step.action === 'drop' ? 0.5 : 1,
          }"
          draggable="true"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent="overIndex = i"
          @dragleave="overIndex === i && (overIndex = -1)"
          @drop.prevent="onDrop(i)"
        >
          <span class="cursor-grab select-none text-[12px] t3" title="拖拽调整顺序">⋮⋮</span>
          <span class="w-6 shrink-0 text-right font-mono text-[10px] t3">{{ i + 1 }}</span>

          <select
            class="field w-[130px] shrink-0 px-1 py-0.5 text-[11px]"
            :value="step.action"
            @change="setAction(i, ($event.target as HTMLSelectElement).value as RebaseAction)"
          >
            <option v-for="(label, key) in ACTION_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>

          <span class="min-w-0 flex-1 truncate text-[12px] text-slate-200">{{ step.subject }}</span>
          <span class="shrink-0 font-mono text-[10px] t3">{{ commitOf(step)?.short }}</span>

          <button class="shrink-0 rounded px-1 text-[11px] t3 hover:opacity-70" title="上移" @click="move(i, i - 1)">↑</button>
          <button class="shrink-0 rounded px-1 text-[11px] t3 hover:opacity-70" title="下移" @click="move(i, i + 1)">↓</button>
        </div>
      </div>

      <footer class="line-t flex items-center gap-3 px-4 py-3">
        <span class="text-[11px] t3">
          共 {{ summary.total }} 个提交 · 保留 {{ summary.kept }} · 合并 {{ summary.merged }} · 丢弃 {{ summary.dropped }}
        </span>
        <span v-if="firstInvalid" class="text-[11px] text-rose-400">第一条保留提交必须是「保留」类动作</span>
        <button
          class="btn btn-primary ml-auto"
          :disabled="!steps.length || firstInvalid || repo.rebaseLoading"
          :style="!steps.length || firstInvalid ? { opacity: 0.45 } : {}"
          @click="start"
        >
          开始变基
        </button>
      </footer>
    </div>
  </div>
</template>

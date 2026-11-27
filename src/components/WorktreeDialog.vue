<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { pickFolder } from '../api/desktop'

const props = defineProps<{
  /** 起始引用（分支 / 远端分支），来自分支右键 */
  base?: string
  /** 预填的分支名 */
  branch?: string
  /** true = 从 base 新建分支；false = 直接检出已有分支 */
  newBranch?: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()
const repo = useRepoStore()

const AGENTS = ['claude', 'codex', 'cursor', 'copilot', 'gemini']

const parent = computed(() => (repo.path || '').replace(/[\\/][^\\/]+$/, ''))
const repoName = computed(() => repo.info?.name || 'repo')
const baseRef = computed(() => (props.base || 'HEAD').trim() || 'HEAD')
const fromBranch = computed(() => baseRef.value !== 'HEAD')

const branch = ref(props.branch || '')
const newBranch = ref(props.newBranch !== false)
const dir = ref('')
const agent = ref('')
const task = ref('')
const picking = ref(false)
const creating = ref(false)

/** 由分支名生成安全的目录名：feat/x → feat-x */
function branchLeaf() {
  return (
    (branch.value || 'session')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '') || 'session'
  )
}

const target = computed(
  () =>
    dir.value.trim() ||
    `${parent.value.replace(/[\\/]+$/, '')}/${repoName.value}-worktrees/${branchLeaf()}`,
)

const valid = computed(() => /^[A-Za-z0-9._\-/]+$/.test(branch.value.trim()) && !!branch.value.trim())

async function chooseDir() {
  if (picking.value) return
  picking.value = true
  try {
    const picked = await pickFolder('选择工作树存放目录')
    if (!picked) return
    const sep = picked.includes('\\') ? '\\' : '/'
    dir.value = `${picked.replace(/[\\/]+$/, '')}${sep}${branchLeaf()}`
  } finally {
    picking.value = false
  }
}

async function create() {
  if (!valid.value || creating.value) return
  creating.value = true
  try {
    const created = await repo.addWorktree({
      target: target.value,
      branch: branch.value.trim(),
      newBranch: newBranch.value,
      base: newBranch.value ? baseRef.value : undefined,
      agent: agent.value.trim(),
      task: task.value.trim(),
    })
    if (created) emit('close')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[16vh]" @click.self="emit('close')">
    <div class="modal animate-pop w-[560px] overflow-hidden">
      <div class="line-b px-4 py-3">
        <div class="text-[13px] font-medium t1">新建工作树</div>
        <div class="mt-0.5 text-[11px] t3">给并行会话开一个独立工作副本（共用同一份 .git）</div>
      </div>

      <div class="space-y-3 px-4 py-4">
        <div>
          <label class="mb-1 block text-[11px] t3">
            {{ newBranch ? `新分支名（从 ${baseRef} 拉出）` : `要检出的分支（${baseRef}）` }}
          </label>
          <input v-model="branch" class="field w-full px-2.5 py-1.5 font-mono text-[12px]" placeholder="feat/ai-session-1" />
          <label v-if="fromBranch" class="mt-1.5 flex items-center gap-1.5 text-[11px] t3">
            <input v-model="newBranch" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" />
            新建分支（不勾选则直接检出该分支；当前分支已被占用时请保持勾选）
          </label>
        </div>

        <div>
          <label class="mb-1 block text-[11px] t3">目录（留空自动生成，也可选一个存放目录）</label>
          <div class="flex items-center gap-1.5">
            <input v-model="dir" class="field min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[11px]" :placeholder="target" />
            <button class="btn shrink-0 px-2 py-1 text-[11px]" :disabled="picking" @click="chooseDir">
              {{ picking ? '选择中…' : '选择目录' }}
            </button>
          </div>
          <div class="mt-1 truncate font-mono text-[10px] t3" :title="target">实际路径：{{ target }}</div>
        </div>

        <div>
          <label class="mb-1 block text-[11px] t3">Agent 标签（谁用这个副本）</label>
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="a in AGENTS"
              :key="a"
              class="btn px-2 py-0.5 text-[11px]"
              :style="agent === a ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
              @click="agent = agent === a ? '' : a"
            >
              {{ a }}
            </button>
            <input v-model="agent" class="field ml-1 w-[110px] px-2 py-0.5 text-[11px]" placeholder="自定义" />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-[11px] t3">这个副本要做什么（prompt / issue 链接，可选）</label>
          <textarea
            v-model="task"
            rows="2"
            class="field w-full resize-none px-2.5 py-1.5 text-[11px]"
            placeholder="例如：修复登录超时；https://github.com/org/repo/issues/123"
          />
        </div>
      </div>

      <div class="line-t flex items-center justify-end gap-2 px-4 py-3">
        <span v-if="!valid" class="mr-auto text-[11px] t3">分支名只允许字母数字与 . _ - /</span>
        <span v-else-if="creating" class="mr-auto text-[11px]" :style="{ color: 'var(--accent)' }">
          正在检出到新目录，大仓库需要一会儿…
        </span>
        <button class="btn" :disabled="creating" @click="emit('close')">取消</button>
        <button
          class="btn btn-primary"
          :disabled="!valid || creating"
          :style="!valid || creating ? { opacity: 0.45 } : {}"
          @click="create"
        >
          {{ creating ? '创建中…' : '创建工作树' }}
        </button>
      </div>
    </div>
  </div>
</template>

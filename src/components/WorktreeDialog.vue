<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRepoStore } from '../stores/repo'
import { pickFolder } from '../api/desktop'
import type { RepoRef } from '../api/types'

const props = defineProps<{
  /** 预填的起始引用（分支 / 远端分支） */
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

/* ── 分支来源：搜索已有分支 + 新建 / 检出两种场景 ── */
const mode = ref<'new' | 'existing'>(props.newBranch === false ? 'existing' : 'new')
const refQuery = ref('')
const selected = ref(
  props.newBranch === false
    ? props.branch || ''
    : props.base && props.base !== 'HEAD'
      ? props.base
      : repo.info?.branch || '',
)

/** 远端名字集合，用来把 origin/feature/x 显示成 feature/x */
const remotes = computed(() => {
  const set = new Set<string>()
  for (const r of repo.info?.refs || []) {
    if (r.kind !== 'remote') continue
    const i = r.name.indexOf('/')
    if (i > 0) set.add(r.name.slice(0, i))
  }
  return set
})

function shortName(name: string) {
  const i = name.indexOf('/')
  if (i > 0 && remotes.value.has(name.slice(0, i))) return name.slice(i + 1)
  return name
}

/** 本地 + 远端分支，按名字去重 */
const branchRefs = computed<RepoRef[]>(() => {
  const out: RepoRef[] = []
  const seen = new Set<string>()
  for (const r of repo.info?.refs || []) {
    if (r.kind !== 'branch' && r.kind !== 'head' && r.kind !== 'remote') continue
    if (r.kind === 'remote' && r.name.endsWith('/HEAD')) continue
    if (seen.has(r.name)) continue
    seen.add(r.name)
    out.push(r)
  }
  return out
})

const selectedIsRemote = computed(() =>
  (repo.info?.refs || []).some((r) => r.kind === 'remote' && r.name === selected.value),
)

const shownRefs = computed(() => {
  const kw = refQuery.value.trim().toLowerCase()
  return branchRefs.value
    .filter((r) => !kw || r.name.toLowerCase().includes(kw))
    .slice(0, 80)
})

const branch = ref(props.branch || (mode.value === 'existing' ? selected.value : ''))
const branchTouched = ref(!!props.branch)

function pickRef(name: string) {
  selected.value = name
  if (mode.value === 'existing') {
    branch.value = name
    return
  }
  if (!branchTouched.value) branch.value = `${shortName(name)}-wt`
}

watch(mode, (m) => {
  if (m === 'existing') {
    if (selected.value) branch.value = selected.value
    return
  }
  if (!branchTouched.value) {
    branch.value = selected.value ? `${shortName(selected.value)}-wt` : ''
  }
})

const dir = ref('')
const agent = ref('')
const task = ref('')
const picking = ref(false)
const creating = ref(false)

/** 由分支名生成安全的目录名：feat/x → feat-x（远端分支去掉 origin/） */
function branchLeaf() {
  return (
    shortName(branch.value || 'session')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '') || 'session'
  )
}

const target = computed(
  () =>
    dir.value.trim() ||
    `${parent.value.replace(/[\\/]+$/, '')}/${repoName.value}-worktrees/${branchLeaf()}`,
)

const valid = computed(() => {
  if (mode.value === 'existing') return !!selected.value
  return /^[A-Za-z0-9._\-/]+$/.test(branch.value.trim()) && !!branch.value.trim()
})

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
    const name = mode.value === 'existing' ? selected.value : branch.value.trim()
    const created = await repo.addWorktree({
      target: target.value,
      branch: name,
      newBranch: mode.value === 'new',
      base: mode.value === 'new' ? selected.value || 'HEAD' : undefined,
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
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[8vh]" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[84vh] w-[580px] flex-col overflow-hidden">
      <div class="line-b px-4 py-3">
        <div class="text-[13px] font-medium t1">新建工作树</div>
        <div class="mt-0.5 text-[11px] t3">给并行会话开一个独立工作副本（共用同一份 .git）</div>
      </div>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div class="flex items-center gap-1">
          <button
            class="btn flex-1 px-2 py-1 text-[11px]"
            :style="mode === 'new' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
            @click="mode = 'new'"
          >
            新建分支
          </button>
          <button
            class="btn flex-1 px-2 py-1 text-[11px]"
            :style="mode === 'existing' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
            @click="mode = 'existing'"
          >
            检出已有分支
          </button>
        </div>

        <div>
          <label class="mb-1 block text-[11px] t3">
            {{ mode === 'new' ? '创建来源（新分支从哪个分支拉出）' : '选择要检出的分支（远端分支会建同名本地跟踪分支）' }}
          </label>
          <input
            v-model="refQuery"
            class="field w-full px-2.5 py-1.5 text-[11px]"
            placeholder="搜索分支…（本地 / 远端都可以）"
          />
          <div class="mt-1 max-h-[168px] overflow-y-auto rounded border" :style="{ borderColor: 'var(--border)' }">
            <button
              v-for="r in shownRefs"
              :key="r.name"
              class="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] row-hover"
              :style="selected === r.name ? { background: 'var(--accent-weak)', color: 'var(--accent)' } : {}"
              :title="r.name"
              @click="pickRef(r.name)"
            >
              <span class="shrink-0 rounded px-1 text-[9px]" :style="{ background: 'var(--panel-3)' }">
                {{ r.kind === 'remote' ? '远端' : '本地' }}
              </span>
              <span class="min-w-0 flex-1 truncate font-mono">{{ r.name }}</span>
              <span v-if="r.name === repo.info?.branch" class="shrink-0 text-[9px]">当前</span>
              <span v-else-if="selected === r.name" class="shrink-0">✓</span>
            </button>
            <div v-if="!shownRefs.length" class="px-2 py-2 text-[11px] t3">没有匹配的分支</div>
          </div>
        </div>

        <div v-if="mode === 'new'">
          <label class="mb-1 block text-[11px] t3">
            新分支名（从 {{ selected || 'HEAD' }} 拉出）
          </label>
          <input
            v-model="branch"
            class="field w-full px-2.5 py-1.5 font-mono text-[12px]"
            placeholder="feat/ai-session-1"
            @input="branchTouched = true"
          />
        </div>
        <div v-else class="rounded px-2 py-1.5 font-mono text-[11px]" :style="{ background: 'var(--panel-2)' }">
          将检出：{{ selected || '（请选择一个分支）' }}
          <span v-if="selectedIsRemote" class="ml-1 t3">→ 自动建同名本地跟踪分支</span>
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
        <span v-if="!valid" class="mr-auto text-[11px] t3">
          {{ mode === 'new' ? '分支名只允许字母数字与 . _ - /' : '请选择要检出的分支' }}
        </span>
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

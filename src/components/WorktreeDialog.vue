<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'

const emit = defineEmits<{ (e: 'close'): void }>()
const repo = useRepoStore()

const AGENTS = ['claude', 'codex', 'cursor', 'copilot', 'gemini']

const parent = computed(() => (repo.path || '').replace(/[\\/][^\\/]+$/, ''))
const repoName = computed(() => repo.info?.name || 'repo')

const branch = ref('')
const dir = ref('')
const agent = ref('')
const task = ref('')

const target = computed(
  () =>
    dir.value.trim() ||
    `${parent.value}\\${repoName.value}-worktrees\\${(branch.value || 'session').replace(/[\\/]/g, '-')}`,
)

const valid = computed(() => /^[A-Za-z0-9._\-/]+$/.test(branch.value.trim()) && !!branch.value.trim())

async function create() {
  if (!valid.value) return
  await repo.addWorktree({
    target: target.value,
    branch: branch.value.trim(),
    newBranch: true,
    base: 'HEAD',
    agent: agent.value.trim(),
    task: task.value.trim(),
  })
  emit('close')
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[16vh]" @click.self="emit('close')">
    <div class="modal animate-pop w-[540px] overflow-hidden">
      <div class="line-b px-4 py-3">
        <div class="text-[13px] font-medium t1">新建工作树</div>
        <div class="mt-0.5 text-[11px] t3">给并行会话开一个独立工作副本（共用同一份 .git）</div>
      </div>

      <div class="space-y-3 px-4 py-4">
        <div>
          <label class="mb-1 block text-[11px] t3">新分支名（从当前 HEAD 拉出）</label>
          <input v-model="branch" class="field w-full px-2.5 py-1.5 font-mono text-[12px]" placeholder="feat/ai-session-1" />
        </div>

        <div>
          <label class="mb-1 block text-[11px] t3">目录（留空自动生成）</label>
          <input v-model="dir" class="field w-full px-2.5 py-1.5 font-mono text-[11px]" :placeholder="target" />
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
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!valid" :style="!valid ? { opacity: 0.45 } : {}" @click="create">
          创建工作树
        </button>
      </div>
    </div>
  </div>
</template>

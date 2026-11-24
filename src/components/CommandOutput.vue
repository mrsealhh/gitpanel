<script setup lang="ts">
import { useRepoStore } from '../stores/repo'

const repo = useRepoStore()

function copyAll() {
  const out = repo.commandOutput
  if (!out) return
  navigator.clipboard?.writeText(`${out.stdout}${out.stderr ? `\n[stderr]\n${out.stderr}` : ''}`)
  repo.notify('ok', '已复制输出')
}
</script>

<template>
  <div v-if="repo.commandOutput" class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="repo.closeCommandOutput()">
    <div class="modal animate-pop flex max-h-[76vh] w-[720px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">{{ repo.commandOutput.title }}</span>
        <span
          class="badge"
          :style="{
            background: repo.commandOutput.code === 0 ? 'var(--badge-head-bg)' : 'var(--badge-tag-bg)',
            color: repo.commandOutput.code === 0 ? 'var(--badge-head-fg)' : 'var(--badge-tag-fg)',
          }"
        >
          退出码 {{ repo.commandOutput.code }} · {{ repo.commandOutput.durationMs }} ms
        </span>
        <button class="btn ml-auto" @click="copyAll">复制</button>
        <button class="btn" @click="repo.closeCommandOutput()">关闭</button>
      </header>
      <pre
        class="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed"
        :style="{ color: 'var(--text-dim)', background: 'var(--panel-2)' }"
      >{{ repo.commandOutput.stdout || '（无输出）' }}<template v-if="repo.commandOutput.stderr">

[stderr]
{{ repo.commandOutput.stderr }}</template></pre>
    </div>
  </div>
</template>

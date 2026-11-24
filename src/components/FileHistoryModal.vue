<script setup lang="ts">
import { useRepoStore } from '../stores/repo'
import { relativeTime } from '../utils/time'

const repo = useRepoStore()

async function openDiff(oid: string) {
  const file = repo.fileHistoryFile
  repo.closeFileHistory()
  await repo.openFileDiffAt(oid, file)
}
</script>

<template>
  <div v-if="repo.fileHistoryFile" class="overlay fixed inset-0 z-50 flex items-center justify-center"
    @click.self="repo.closeFileHistory()">
    <div class="modal animate-pop flex max-h-[76vh] w-[720px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">文件历史</span>
        <span class="truncate font-mono text-[11px] t3">{{ repo.fileHistoryFile }}</span>
        <span class="text-[11px] t3">{{ repo.fileHistory.length }} 次提交</span>
        <button class="btn ml-auto" @click="repo.closeFileHistory()">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!repo.fileHistory.length" class="p-4 text-[12px] t3">没有历史记录</div>
        <button v-for="c in repo.fileHistory" :key="c.oid"
          class="row-hover flex w-full items-center gap-3 px-4 py-2 text-left"
          :title="`查看 ${c.short} 中该文件的改动`" @click="openDiff(c.oid)">
          <span class="min-w-0 flex-1 truncate text-[12px] t1">{{ c.subject }}</span>
          <span class="shrink-0 text-[11px] t3">{{ c.author }}</span>
          <span class="w-24 shrink-0 text-right text-[11px] t3">{{ relativeTime(c.time) }}</span>
          <span class="w-14 shrink-0 text-right font-mono text-[10px] t3">{{ c.short }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

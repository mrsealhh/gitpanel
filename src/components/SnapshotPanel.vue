<script setup lang="ts">
import { onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import { formatDate } from '../utils/time'

const repo = useRepoStore()

onMounted(() => repo.loadSnapshots())

async function restore(ref: string) {
  if (!window.confirm('确定回滚到该快照？\n回滚前会为当前状态再打一份快照，可以再回来。')) return
  await repo.restoreSnapshot(ref)
}
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">安全网</span>
      <span class="ml-2 text-[11px] t3">{{ repo.snapshots.length }} 个快照</span>
      <button class="btn ml-auto px-2 py-0.5 text-[11px]" @click="repo.loadSnapshots()">刷新</button>
    </div>

    <div class="px-3 py-2 text-[11px] leading-relaxed t3">
      丢弃改动、拉取、回滚等破坏性操作前会自动打一份快照，随时可以回到操作前。
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <div v-if="repo.snapshotsLoading" class="p-3 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.snapshots.length" class="p-3 text-[12px] t3">还没有快照</div>
      <div
        v-for="s in repo.snapshots"
        :key="s.ref"
        class="row-hover group flex items-start gap-2 px-3 py-1.5"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="rounded px-1 py-0.5 text-[10px]" :style="{ background: 'var(--panel-3)', color: 'var(--text-dim)' }">
              {{ s.label }}
            </span>
            <span class="font-mono text-[10px] t3">{{ s.short }}</span>
          </div>
          <div class="mt-0.5 truncate text-[11px] t3">{{ formatDate(s.time) }} · {{ s.subject }}</div>
        </div>
        <button
          class="btn shrink-0 px-2 py-0.5 text-[10px]"
          @click="restore(s.ref)"
        >
          回滚
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import { relativeTime } from '../utils/time'
const repo = useRepoStore()

onMounted(() => {
  repo.loadSnapshots()
  repo.loadReflog()
})

async function restore(ref: string) {
  if (!window.confirm('确定回滚到该快照？\n回滚前会为当前状态再打一份快照，可以再回来。')) return
  await repo.restoreSnapshot(ref)
}

async function removeOne(ref: string) {
  if (!window.confirm('彻底删除这个快照？删除后无法再用它回滚。')) return
  await repo.deleteSnapshot(ref)
}

async function purgeAll() {
  if (!window.confirm(`彻底删除全部 ${repo.snapshots.length} 个快照？\n只删安全网引用，不影响分支和提交。`)) return
  await repo.purgeSnapshots()
}

async function reset(oid: string, mode: 'soft' | 'mixed' | 'hard') {
  const tips = {
    soft: '只移动 HEAD，改动全部保留在暂存区',
    mixed: '移动 HEAD 并重置暂存区，工作区改动保留',
    hard: '移动 HEAD 并丢弃暂存区与工作区改动',
  }
  if (!window.confirm(`确定执行 ${mode} 重置到 ${oid.slice(0, 7)}？\n${tips[mode]}\n（操作前会自动打快照）`)) return
  await repo.resetTo(oid, mode)
}
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">安全网</span>
      <span class="ml-2 text-[11px] t3">{{ repo.snapshots.length }} 个快照</span>
      <button
        v-if="repo.snapshots.length"
        class="btn ml-auto px-2 py-0.5 text-[11px]"
        style="color: #f87171"
        title="彻底删除所有安全网快照，释放引用"
        @click="purgeAll"
      >
        清空
      </button>
      <button class="btn ml-1 px-2 py-0.5 text-[11px]" @click="repo.loadSnapshots(); repo.loadReflog()">刷新</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="px-3 py-2 text-[11px] leading-relaxed t3">
        丢弃、合并、拉取、回滚等操作前会自动打快照，随时能回到操作前。
        <div class="mt-1.5 space-y-0.5">
          <div><span class="rounded px-1" :style="{ background: 'var(--panel-3)' }">软</span> 只移动分支指针，改动全部保留在暂存区</div>
          <div><span class="rounded px-1" :style="{ background: 'var(--panel-3)' }">混</span> 移动指针并清空暂存区，工作区文件改动保留</div>
          <div><span class="rounded px-1" :style="{ background: 'var(--panel-3)' }">硬</span> 移动指针并丢弃暂存区与工作区的全部改动</div>
        </div>
      </div>

      <div v-if="repo.snapshotsLoading" class="px-3 py-2 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.snapshots.length" class="px-3 py-2 text-[12px] t3">还没有快照</div>
      <div v-for="s in repo.snapshots" :key="s.ref" class="row-hover flex items-center gap-2 px-3 py-1.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="rounded px-1 py-0.5 text-[10px]" :style="{ background: 'var(--panel-3)', color: 'var(--text-dim)' }">
              {{ s.label }}
            </span>
            <span class="font-mono text-[10px] t3">{{ s.short }}</span>
            <span class="ml-auto shrink-0 text-[10px] t3">{{ relativeTime(s.time) }}</span>
          </div>
          <div class="mt-0.5 truncate text-[11px] t3">{{ s.subject }}</div>
        </div>
        <button class="btn shrink-0 px-2 py-0.5 text-[10px]" @click="restore(s.ref)">回滚</button>
        <button
          class="btn shrink-0 px-1.5 py-0.5 text-[10px]"
          style="color: #f87171"
          title="彻底删除这个快照"
          @click="removeOne(s.ref)"
        >
          删除
        </button>
      </div>

      <div class="line-t mx-3 my-2" />
      <div class="px-3 pb-1 text-[11px] font-medium t3">最近操作（reflog）</div>

      <div v-if="repo.reflogLoading" class="px-3 py-2 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.reflog.length" class="px-3 py-2 text-[12px] t3">没有记录</div>
      <div v-for="e in repo.reflog" :key="e.selector + e.oid" class="row-hover px-3 py-1.5">
        <div class="flex items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate text-[11px] t2">{{ e.action }}</span>
          <span class="shrink-0 font-mono text-[10px] t3">{{ e.short }}</span>
        </div>
        <div class="mt-0.5 flex items-center gap-1">
          <span class="truncate font-mono text-[10px] t3">{{ e.selector }}</span>
          <span class="shrink-0 text-[10px] t3">· {{ relativeTime(e.time) }}</span>
          <div class="ml-auto flex shrink-0 gap-1">
            <button class="btn px-1.5 py-0 text-[10px]" title="只移动 HEAD，改动保留在暂存区" @click="reset(e.oid, 'soft')">软</button>
            <button class="btn px-1.5 py-0 text-[10px]" title="重置暂存区，工作区改动保留" @click="reset(e.oid, 'mixed')">混</button>
            <button class="btn px-1.5 py-0 text-[10px]" title="丢弃暂存区与工作区改动" style="color: #f87171" @click="reset(e.oid, 'hard')">硬</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

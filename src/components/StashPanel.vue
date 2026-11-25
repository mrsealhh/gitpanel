<script setup lang="ts">
import { onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import IconButton from './IconButton.vue'
import { relativeTime } from '../utils/time'

const emit = defineEmits<{ (e: 'create'): void }>()
const repo = useRepoStore()

onMounted(() => repo.loadStashes())
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">储藏</span>
      <span class="ml-2 text-[11px] t3">{{ repo.stashes.length }}</span>
      <IconButton class="ml-auto" compact name="plus" title="新建储藏（git stash）" :size="13" @click="emit('create')" />
      <IconButton class="ml-1" compact name="refresh" title="刷新储藏" :size="13" @click="repo.loadStashes()" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="repo.stashesLoading" class="p-3 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.stashes.length" class="p-3 text-[12px] leading-relaxed t3">
        还没有储藏记录。
        <div class="mt-1 text-[11px]">
          这里是 git stash：点「新建」把当前改动临时收起来（工作区变干净），之后可以应用 / 弹出 / 删除。
          已暂存（staged）的改动在「工作区」里，不在这里。
        </div>
      </div>
      <div
        v-for="s in repo.stashes"
        :key="s.ref"
        class="row-hover group px-3 py-1.5"
      >
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] t3">{{ s.ref }}</span>
          <span class="ml-auto shrink-0 text-[10px] t3">{{ relativeTime(s.time) }}</span>
        </div>
        <div class="mt-0.5 truncate text-[12px] t1">{{ s.message || '(无描述)' }}</div>
        <div class="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <IconButton compact name="download" title="应用这个储藏（保留记录）" :size="12" @click="repo.stashAction(s.ref, 'apply')" />
          <IconButton compact name="push" title="弹出这个储藏（应用后删除）" :size="12" @click="repo.stashAction(s.ref, 'pop')" />
          <IconButton compact name="eye" title="查看储藏内容" :size="12" @click="repo.openStashDiff(s.ref)" />
          <IconButton compact name="trash" title="删除这个储藏" danger :size="12" @click="repo.stashAction(s.ref, 'drop')" />
        </div>
      </div>
    </div>
  </div>
</template>

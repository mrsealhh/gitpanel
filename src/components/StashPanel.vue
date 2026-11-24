<script setup lang="ts">
import { onMounted } from 'vue'
import { useRepoStore } from '../stores/repo'
import { relativeTime } from '../utils/time'

const emit = defineEmits<{ (e: 'create'): void }>()
const repo = useRepoStore()

onMounted(() => repo.loadStashes())
</script>

<template>
  <div class="flex h-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b flex items-center px-3 py-2">
      <span class="text-[12px] font-semibold t1">暂存</span>
      <span class="ml-2 text-[11px] t3">{{ repo.stashes.length }}</span>
      <button class="btn ml-auto px-2 py-0.5 text-[11px]" @click="emit('create')">新建</button>
      <button class="btn ml-1 px-2 py-0.5 text-[11px]" @click="repo.loadStashes()">刷新</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="repo.stashesLoading" class="p-3 text-[12px] t3">读取中…</div>
      <div v-else-if="!repo.stashes.length" class="p-3 text-[12px] t3">还没有暂存</div>
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
          <button class="btn px-1.5 py-0 text-[10px]" @click="repo.stashAction(s.ref, 'apply')">应用</button>
          <button class="btn px-1.5 py-0 text-[10px]" @click="repo.stashAction(s.ref, 'pop')">弹出</button>
          <button class="btn px-1.5 py-0 text-[10px]" @click="repo.openStashDiff(s.ref)">查看</button>
          <button
            class="btn px-1.5 py-0 text-[10px]"
            style="color: #f87171"
            @click="repo.stashAction(s.ref, 'drop')"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

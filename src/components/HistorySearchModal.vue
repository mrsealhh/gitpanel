<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRepoStore } from '../stores/repo'
import { relativeTime } from '../utils/time'
import Icon from './Icon.vue'
import IconButton from './IconButton.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'open', oid: string): void }>()
const repo = useRepoStore()
const input = ref<HTMLInputElement | null>(null)
let timer: number | undefined

function run() {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => void repo.searchHistory(repo.historySearchQuery), 320)
}

watch(() => repo.historySearchQuery, run)

onMounted(async () => {
  await nextTick()
  input.value?.focus()
})

function choose(oid: string) {
  emit('open', oid)
  emit('close')
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[78vh] w-[760px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">内容历史搜索</span>
        <span class="text-[10px] t3">git log -S：找出新增 / 删除过这段文本的提交</span>
        <IconButton class="ml-auto" compact name="close" title="关闭" :size="14" @click="emit('close')" />
      </header>

      <div class="line-b px-4 py-2">
        <div class="relative">
          <input
            ref="input"
            v-model="repo.historySearchQuery"
            class="field w-full py-1.5 pl-8 pr-8 text-[12px]"
            placeholder="输入一段代码 / 文案，搜索它的变更历史"
            @keydown.enter.prevent="repo.searchHistory(repo.historySearchQuery)"
            @keydown.esc.prevent="emit('close')"
          />
          <span class="pointer-events-none absolute left-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center t3">
            <Icon name="search" :size="14" />
          </span>
          <button
            v-if="repo.historySearchQuery"
            class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded t3 hover:bg-[var(--hover)]"
            title="清除"
            @click="repo.historySearchQuery = ''; repo.historySearchHits = []"
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="repo.historySearchLoading" class="flex items-center justify-center gap-2 p-6 text-[12px] t3">
          <span class="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent" />
          正在搜索内容变更…
        </div>
        <div v-else-if="!repo.historySearchQuery.trim()" class="p-6 text-center text-[12px] t3">
          输入关键字，查找「这行代码 / 这段文案」是在哪个提交里加入或删除的。
        </div>
        <div v-else-if="!repo.historySearchHits.length" class="p-6 text-center text-[12px] t3">
          没有找到包含这段内容变更的提交
        </div>
        <button
          v-for="h in repo.historySearchHits"
          :key="h.oid"
          class="row-hover flex w-full items-center gap-3 px-4 py-2 text-left"
          :title="`${h.short} ${h.subject}`"
          @click="choose(h.oid)"
        >
          <span class="min-w-0 flex-1 truncate text-[12px] t1">{{ h.subject }}</span>
          <span class="shrink-0 text-[11px] t3">{{ h.author }}</span>
          <span class="w-24 shrink-0 text-right text-[11px] t3">{{ relativeTime(h.time) }}</span>
          <span class="w-14 shrink-0 text-right font-mono text-[10px] t3">{{ h.short }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

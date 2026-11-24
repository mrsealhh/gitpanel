<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RepoRef } from '../api/types'

const props = defineProps<{
  refs: RepoRef[]
  branch: string
  tip: string
  name: string
}>()

const emit = defineEmits<{ (e: 'filter', tip: string): void }>()

const q = ref('')

const groups = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const pick = (kinds: string[]) =>
    props.refs
      .filter((r) => kinds.includes(r.kind) && (!kw || r.name.toLowerCase().includes(kw)))
      .sort((a, b) => a.name.localeCompare(b.name))
  return [
    { key: 'branch', title: '本地分支', items: pick(['branch', 'head']) },
    { key: 'remote', title: '远程分支', items: pick(['remote']) },
    { key: 'tag', title: '标签', items: pick(['tag']) },
  ].filter((g) => g.items.length > 0)
})

const open = ref<Record<string, boolean>>({ branch: true, remote: true, tag: false })
</script>

<template>
  <aside class="flex h-full w-[220px] shrink-0 flex-col border-r border-white/5 bg-[#12151d]">
    <div class="border-b border-white/5 px-3 py-2">
      <div class="truncate text-[13px] font-semibold text-slate-200">{{ name }}</div>
      <div class="mt-0.5 truncate text-[11px] text-slate-500">{{ branch }}</div>
    </div>

    <div class="p-2">
      <input
        v-model="q"
        placeholder="过滤分支 / 标签"
        class="w-full rounded border border-white/5 bg-black/30 px-2 py-1 text-[12px] text-slate-300 placeholder:text-slate-600 focus:border-sky-500/40 focus:outline-none"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <button
        class="mx-2 mb-1 w-[calc(100%-16px)] rounded px-2 py-1 text-left text-[12px] text-slate-400 hover:bg-white/5"
        :class="tip === '' ? 'bg-white/5 text-slate-200' : ''"
        @click="emit('filter', '')"
      >
        全部提交
      </button>

      <div v-for="g in groups" :key="g.key">
        <button
          class="flex w-full items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300"
          @click="open[g.key] = !open[g.key]"
        >
          <span class="text-[9px]">{{ open[g.key] ? '▾' : '▸' }}</span>
          {{ g.title }}
          <span class="ml-auto text-slate-600">{{ g.items.length }}</span>
        </button>
        <div v-show="open[g.key]">
          <button
            v-for="r in g.items"
            :key="r.kind + r.name"
            class="block w-full truncate px-5 py-[3px] text-left text-[12px] hover:bg-white/5"
            :class="tip === r.name ? 'text-sky-300' : 'text-slate-400'"
            @click="emit('filter', r.name)"
          >
            {{ r.name }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

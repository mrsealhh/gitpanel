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
  <aside class="flex h-full w-full flex-col" :style="{ background: 'var(--panel)' }">
    <div class="line-b px-3 py-2">
      <div class="truncate text-[13px] font-semibold t1">{{ name }}</div>
      <div class="mt-0.5 flex items-center gap-1.5 text-[11px] t3">
        <span class="h-1.5 w-1.5 rounded-full" style="background: var(--accent)" />
        {{ branch }}
      </div>
    </div>

    <div class="p-2">
      <input
        v-model="q"
        placeholder="过滤分支 / 标签"
        class="field w-full px-2 py-1 text-[12px]"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <button
        class="mx-2 mb-1 w-[calc(100%-16px)] rounded px-2 py-1 text-left text-[12px] t2 row-hover"
        :class="tip === '' ? 'row-selected' : ''"
        :style="tip === '' ? { color: 'var(--text)' } : {}"
        @click="emit('filter', '')"
      >
        全部提交
      </button>

      <div v-for="g in groups" :key="g.key">
        <button
          class="flex w-full items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3 hover:opacity-80"
          @click="open[g.key] = !open[g.key]"
        >
          <span class="text-[9px]">{{ open[g.key] ? '▾' : '▸' }}</span>
          {{ g.title }}
          <span class="ml-auto opacity-60">{{ g.items.length }}</span>
        </button>
        <div v-show="open[g.key]">
          <button
            v-for="r in g.items"
            :key="r.kind + r.name"
            class="block w-full truncate px-5 py-[3px] text-left text-[12px] row-hover"
            :style="tip === r.name ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
            @click="emit('filter', r.name)"
          >
            {{ r.name }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

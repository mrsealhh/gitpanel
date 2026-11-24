<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RepoRef } from '../api/types'

const props = defineProps<{
  refs: RepoRef[]
  branch: string
  tip: string
  name: string
}>()

const emit = defineEmits<{
  (e: 'filter', tip: string): void
  (e: 'context', payload: { ref: RepoRef; x: number; y: number }): void
  (e: 'create-tag'): void
}>()

const q = ref('')

interface BranchRow {
  ref: RepoRef
  current: boolean
  remotes: RepoRef[]
}

const branches = computed<BranchRow[]>(() => {
  const kw = q.value.trim().toLowerCase()
  const locals = props.refs.filter((r) => r.kind === 'branch' || r.kind === 'head')
  const remotes = props.refs.filter((r) => r.kind === 'remote')

  const rows: BranchRow[] = locals.map((b) => ({
    ref: b,
    current: b.name === props.branch,
    remotes: remotes.filter((r) => r.name.endsWith(`/${b.name}`)),
  }))

  if (!kw) return rows
  return rows.filter(
    (row) =>
      row.ref.name.toLowerCase().includes(kw) ||
      row.remotes.some((r) => r.name.toLowerCase().includes(kw)),
  )
})

/** 没有对应本地分支的远端（例如只在远端存在的分支） */
const orphanRemotes = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const localNames = new Set(
    props.refs.filter((r) => r.kind === 'branch' || r.kind === 'head').map((r) => r.name),
  )
  return props.refs
    .filter((r) => r.kind === 'remote')
    .filter((r) => ![...localNames].some((n) => r.name.endsWith(`/${n}`)))
    .filter((r) => !kw || r.name.toLowerCase().includes(kw))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const tags = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return props.refs
    .filter((r) => r.kind === 'tag' && (!kw || r.name.toLowerCase().includes(kw)))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const open = ref<Record<string, boolean>>({ remote: true, tag: true })

function onCtx(e: MouseEvent, r: RepoRef) {
  e.preventDefault()
  emit('context', { ref: r, x: e.clientX, y: e.clientY })
}
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
      <input v-model="q" placeholder="过滤分支 / 标签" class="field w-full px-2 py-1 text-[12px]" />
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

      <!-- 本地分支（每个分支下面挂它的远端跟踪分支） -->
      <div class="flex items-center pr-2">
        <span class="flex flex-1 items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3">
          本地分支
          <span class="ml-1 opacity-60">{{ branches.length }}</span>
        </span>
      </div>
      <div v-for="row in branches" :key="row.ref.name">
        <button
          class="flex w-full items-center gap-1.5 truncate px-4 py-[3px] text-left text-[12px] row-hover"
          :style="tip === row.ref.name ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
          @click="emit('filter', row.ref.name)"
          @contextmenu="onCtx($event, row.ref)"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{ background: row.current ? 'var(--accent)' : 'transparent' }"
          />
          <span class="truncate" :style="row.current ? { color: 'var(--accent)', fontWeight: 500 } : {}">
            {{ row.ref.name }}
          </span>
          <span
            v-if="row.current"
            class="ml-auto shrink-0 rounded px-1 text-[9px]"
            :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }"
          >
            当前
          </span>
        </button>

        <button
          v-for="rm in row.remotes"
          :key="rm.name"
          class="flex w-full items-center gap-1.5 truncate pl-8 pr-4 py-[2px] text-left text-[11px] row-hover"
          :style="{ color: 'var(--text-mute)' }"
          :title="rm.name"
          @click="emit('filter', rm.name)"
          @contextmenu="onCtx($event, rm)"
        >
          <span class="truncate">{{ rm.name }}</span>
        </button>
      </div>

      <!-- 只有远端、没有本地对应分支 -->
      <div v-if="orphanRemotes.length">
        <div class="flex items-center pr-2">
          <button
            class="flex flex-1 items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3"
            @click="open.remote = !open.remote"
          >
            <span class="text-[9px]">{{ open.remote ? '▾' : '▸' }}</span>
            其他远端分支
            <span class="ml-1 opacity-60">{{ orphanRemotes.length }}</span>
          </button>
        </div>
        <div v-show="open.remote">
          <button
            v-for="r in orphanRemotes"
            :key="r.name"
            class="block w-full truncate px-5 py-[3px] text-left text-[12px] row-hover"
            :style="{ color: 'var(--text-dim)' }"
            @click="emit('filter', r.name)"
            @contextmenu="onCtx($event, r)"
          >
            {{ r.name }}
          </button>
        </div>
      </div>

      <!-- 标签 -->
      <div v-if="tags.length">
        <div class="flex items-center pr-2">
          <button
            class="flex flex-1 items-center gap-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide t3"
            @click="open.tag = !open.tag"
          >
            <span class="text-[9px]">{{ open.tag ? '▾' : '▸' }}</span>
            标签
            <span class="ml-1 opacity-60">{{ tags.length }}</span>
          </button>
          <button class="px-1 text-[12px] t3 hover:opacity-80" title="新建标签" @click="emit('create-tag')">＋</button>
        </div>
        <div v-show="open.tag">
          <button
            v-for="r in tags"
            :key="r.name"
            class="block w-full truncate px-5 py-[3px] text-left text-[12px] row-hover"
            :style="tip === r.name ? { color: 'var(--accent)' } : { color: 'var(--text-dim)' }"
            @click="emit('filter', r.name)"
            @contextmenu="onCtx($event, r)"
          >
            {{ r.name }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

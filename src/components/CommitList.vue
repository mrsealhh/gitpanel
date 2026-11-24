<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GraphCanvas from './GraphCanvas.vue'
import type { CommitRow } from '../api/types'
import { useSettingsStore } from '../stores/settings'
import { formatDate, relativeTime } from '../utils/time'

const props = withDefaults(
  defineProps<{
    rows: CommitRow[]
    selectedOid?: string
    loading?: boolean
  }>(),
  { rows: () => [] },
)

const emit = defineEmits<{
  (e: 'select', row: CommitRow): void
  (e: 'loadMore'): void
  (e: 'context', payload: { row: CommitRow; x: number; y: number }): void
}>()

const settings = useSettingsStore()
const ROW_H = computed(() => settings.rowHeight)

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewH = ref(600)

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H.value) - 6))
const end = computed(() =>
  Math.min(props.rows.length, Math.ceil((scrollTop.value + viewH.value) / ROW_H.value) + 6),
)
const visible = computed(() => props.rows.slice(start.value, end.value))
const totalH = computed(() => props.rows.length * ROW_H.value)
const selectedIndex = computed(() => props.rows.findIndex((r) => r.oid === props.selectedOid))

let raf = 0
function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const el = scroller.value
    if (!el) return
    scrollTop.value = el.scrollTop
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) emit('loadMore')
  })
}

let ro: ResizeObserver | null = null
onMounted(() => {
  const el = scroller.value
  if (!el) return
  viewH.value = el.clientHeight
  ro = new ResizeObserver(() => {
    viewH.value = el.clientHeight
  })
  ro.observe(el)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (raf) cancelAnimationFrame(raf)
})

watch(
  () => props.selectedOid,
  (oid) => {
    const idx = props.rows.findIndex((r) => r.oid === oid)
    const el = scroller.value
    if (!el || idx < 0) return
    const top = idx * ROW_H.value
    if (top < el.scrollTop || top + ROW_H.value > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight / 2
    }
  },
)

function onContext(e: MouseEvent, row: CommitRow) {
  e.preventDefault()
  emit('context', { row, x: e.clientX, y: e.clientY })
}

function timeText(row: CommitRow) {
  return settings.relativeTime ? relativeTime(row.time) : formatDate(row.time)
}
</script>

<template>
  <div class="relative flex h-full min-h-0">
    <div v-if="settings.showGraph" class="relative shrink-0" :style="{ background: 'var(--panel-2)' }">
      <GraphCanvas
        :rows="rows"
        :scroll-top="scrollTop"
        :height="viewH"
        :row-height="ROW_H"
        :selected-index="selectedIndex"
      />
      <div class="absolute inset-y-0 right-0 w-px" :style="{ background: 'var(--border)' }" />
    </div>

    <div ref="scroller" class="relative min-w-0 flex-1 overflow-y-auto" @scroll="onScroll">
      <div :style="{ height: totalH + 'px', position: 'relative' }">
        <div
          v-for="(row, i) in visible"
          :key="row.oid"
          class="absolute inset-x-0 flex cursor-default select-none items-center gap-2 px-3"
          :class="row.oid === selectedOid ? 'row-selected' : 'row-hover'"
          :style="{ top: (start + i) * ROW_H + 'px', height: ROW_H + 'px', fontSize: '13px' }"
          @click="emit('select', row)"
          @contextmenu="onContext($event, row)"
        >
          <span
            v-for="b in row.refs.slice(0, 3)"
            :key="b.kind + b.name"
            class="badge shrink-0"
            :class="`badge-${b.kind}`"
          >
            {{ b.name }}
          </span>
          <span class="truncate t1">{{ row.summary }}</span>
          <span class="ml-auto shrink-0 text-[11px] t3">{{ row.author }}</span>
          <span class="w-24 shrink-0 text-right text-[11px] t3">{{ timeText(row) }}</span>
          <span class="w-14 shrink-0 text-right font-mono text-[11px] t3">{{ row.short }}</span>
        </div>
      </div>

      <div v-if="loading && rows.length === 0" class="p-6 text-sm t3">加载提交历史…</div>
      <div v-else-if="rows.length === 0" class="p-6 text-sm t3">没有匹配的提交</div>
    </div>
  </div>
</template>

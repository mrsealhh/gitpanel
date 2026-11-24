<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { CommitRow } from '../api/types'
import { useSettingsStore } from '../stores/settings'

const props = withDefaults(
  defineProps<{
    rows: CommitRow[]
    scrollTop: number
    height: number
    rowHeight?: number
    laneWidth?: number
    selectedIndex?: number
  }>(),
  { rowHeight: 28, laneWidth: 14, selectedIndex: -1 },
)

const settings = useSettingsStore()
const palette = computed(() => settings.palette)
const ring = ref('#0f1117')

function readRing() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--graph-node-ring').trim()
  if (v) ring.value = v
}
watch(() => settings.theme, readRing)

const canvas = ref<HTMLCanvasElement | null>(null)
const width = computed(() =>
  Math.max(56, (props.rows.reduce((m, r) => Math.max(m, r.lane), 0) + 1) * props.laneWidth + 16),
)

let frame = 0

function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    draw()
  })
}

function draw() {
  const el = canvas.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const w = width.value
  const h = props.height
  if (el.width !== Math.floor(w * dpr) || el.height !== Math.floor(h * dpr)) {
    el.width = Math.floor(w * dpr)
    el.height = Math.floor(h * dpr)
    el.style.width = `${w}px`
    el.style.height = `${h}px`
  }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'

  const rh = props.rowHeight
  const start = Math.max(0, Math.floor(props.scrollTop / rh) - 1)
  const end = Math.min(props.rows.length, Math.ceil((props.scrollTop + h) / rh) + 1)
  const colors = palette.value

  if (props.selectedIndex >= 0 && props.selectedIndex >= start && props.selectedIndex < end) {
    ctx.fillStyle = 'var(--selected)'
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--selected').trim() || 'rgba(91,157,255,0.1)'
    ctx.fillRect(0, props.selectedIndex * rh - props.scrollTop, w, rh)
  }

  for (let i = start; i < end; i++) {
    const row = props.rows[i]
    if (!row) continue
    const top = i * rh - props.scrollTop
    for (const s of row.segments) {
      const x1 = s.x1 * props.laneWidth + props.laneWidth / 2 + 4
      const x2 = s.x2 * props.laneWidth + props.laneWidth / 2 + 4
      const y1 = top + s.y1 * rh
      const y2 = top + s.y2 * rh
      ctx.strokeStyle = colors[s.color % colors.length]
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      if (s.curve) {
        const mid = (y1 + y2) / 2
        ctx.bezierCurveTo(x1, mid, x2, mid, x2, y2)
      } else {
        ctx.lineTo(x2, y2)
      }
      ctx.stroke()
    }
  }

  for (let i = start; i < end; i++) {
    const row = props.rows[i]
    if (!row) continue
    const cx = row.lane * props.laneWidth + props.laneWidth / 2 + 4
    const cy = i * rh + rh / 2 - props.scrollTop
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fillStyle = colors[row.color % colors.length]
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = ring.value
    ctx.stroke()
  }
}

watch(
  () => [props.rows, props.scrollTop, props.height, props.selectedIndex, settings.theme, props.rowHeight],
  schedule,
)
onMounted(() => {
  readRing()
  schedule()
})
</script>

<template>
  <canvas ref="canvas" class="block h-full" />
</template>

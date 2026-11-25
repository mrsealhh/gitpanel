<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { FileDiff } from '../api/types'
import { useSettingsStore } from '../stores/settings'
import { languageFor as loadLanguage } from '../lib/lang'

const props = defineProps<{
  file: string
  diff: FileDiff | null
  loading?: boolean
  fullscreen?: boolean
  /** 大文件阈值（KB），超过就提示已按性能优先分段显示 */
  largeKB?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-fullscreen'): void
  (e: 'load-more'): void
}>()

const settings = useSettingsStore()
const host = ref<HTMLElement | null>(null)
let view: MergeView | null = null
let seq = 0

/** 当前两版各显示了多少行（用于「已显示 x / y 行」） */
const shownLines = computed(() => ({
  old: props.diff ? props.diff.oldFrom + countLines(props.diff.oldText) : 0,
  new: props.diff ? props.diff.newFrom + countLines(props.diff.newText) : 0,
}))

const largeBytes = computed(() => {
  const d = props.diff
  if (!d) return 0
  return Math.max(d.oldBytes, d.newBytes)
})

/** 是否属于「大文件」：超过阈值就明确提示分段加载 */
const isLarge = computed(() => {
  const kb = props.largeKB ?? 512
  return kb > 0 && largeBytes.value > kb * 1024
})

const sizeLabel = computed(() => {
  const b = largeBytes.value
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
})

function countLines(text: string): number {
  if (!text) return 0
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n + 1
}

const highlight = HighlightStyle.define([
  { tag: tags.comment, color: '#6b7688', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#c084fc' },
  { tag: [tags.string, tags.special(tags.string)], color: '#4ade80' },
  { tag: [tags.number, tags.bool, tags.null], color: '#fbbf24' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#60a5fa' },
  { tag: [tags.typeName, tags.className], color: '#2dd4bf' },
  { tag: tags.propertyName, color: '#7dd3fc' },
  { tag: [tags.operator, tags.punctuation], color: '#94a3b8' },
  { tag: tags.heading, color: '#f0abfc', fontWeight: '600' },
])

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 每次构建都从 CSS 变量取值，切主题后重建即可同步 */
function themeExtensions(): Extension {
  const dark = settings.theme !== 'light'
  return EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: cssVar('--text', '#cbd5e1'), height: '100%' },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', Consolas, 'Cascadia Code', monospace",
        fontSize: '12px',
        lineHeight: '1.6',
        overflow: 'auto',
      },
      '.cm-content': { caretColor: 'transparent' },
      '.cm-gutters': {
        backgroundColor: cssVar('--panel-2', '#0e1117'),
        color: cssVar('--text-mute', '#3f4855'),
        border: 'none',
        fontSize: '11px',
      },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-selectionBackground': { backgroundColor: cssVar('--accent-weak', '') + ' !important' },
    },
    { dark },
  )
}

function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    themeExtensions(),
    syntaxHighlighting(highlight),
  ]
}

async function languageFor(file: string): Promise<Extension> {
  return loadLanguage(file)
}

function destroy() {
  view?.destroy()
  view = null
  if (host.value) host.value.innerHTML = ''
}

async function build() {
  if (!host.value || !props.diff || props.diff.isBinary) {
    destroy()
    return
  }
  const mine = ++seq
  const lang = await languageFor(props.file)
  if (mine !== seq || !host.value) return

  // 重建前记住滚动位置，追加后续分段时不会跳回顶部
  const prevScroller = host.value.querySelector('.cm-scroller') as HTMLElement | null
  const prevScrollTop = prevScroller?.scrollTop ?? 0

  destroy()
  const ext = [...baseExtensions(), lang]
  view = new MergeView({
    a: { doc: props.diff.oldText, extensions: ext },
    b: { doc: props.diff.newText, extensions: ext },
    parent: host.value,
    collapseUnchanged: { margin: 3, minSize: 5 },
    highlightChanges: true,
    gutter: true,
  })
  if (prevScrollTop > 0) {
    requestAnimationFrame(() => {
      host.value?.querySelectorAll('.cm-scroller').forEach((el) => {
        ;(el as HTMLElement).scrollTop = prevScrollTop
      })
    })
  }
}

watch(() => [props.diff, props.file, settings.theme], build, { deep: false })
onMounted(build)
onBeforeUnmount(() => {
  seq++
  destroy()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" :style="{ background: 'var(--bg)' }">
    <header class="line-b flex h-10 shrink-0 items-center gap-3 px-4" :style="{ background: 'var(--panel)' }">
      <span class="min-w-0 flex-1 truncate font-mono text-[12px] t2" :title="file">{{ file }}</span>
      <span v-if="diff && !diff.isBinary" class="shrink-0 whitespace-nowrap text-[11px] t3">
        已显示 {{ shownLines.old }} / {{ diff.oldTotalLines }} 行 · {{ sizeLabel }}
      </span>
      <span
        v-if="isLarge"
        class="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
        :style="{ background: 'var(--badge-tag-bg)', color: 'var(--badge-tag-fg)' }"
        title="超过大文件阈值，按性能优先分段加载，内容不会丢"
      >
        大文件 · 分段加载
      </span>
      <button
        v-if="diff?.hasMore"
        class="btn shrink-0 whitespace-nowrap"
        :disabled="loading"
        :title="`继续读取后面的内容（每段 ${settings.diffMaxLines || '不限'} 行）`"
        @click="emit('load-more')"
      >
        {{ loading ? '加载中…' : settings.diffMaxLines ? `继续加载 ${settings.diffMaxLines} 行` : '加载全部' }}
      </button>
      <button
        class="btn ml-auto shrink-0 whitespace-nowrap"
        :title="fullscreen ? '退出全屏' : '全屏查看'"
        @click="emit('toggle-fullscreen')"
      >
        {{ fullscreen ? '退出全屏' : '全屏' }}
      </button>
      <button class="btn shrink-0 whitespace-nowrap" @click="emit('close')">关闭 (Esc)</button>
    </header>

    <div v-if="loading" class="p-6 text-sm t3">加载文件内容…</div>
    <div v-else-if="!diff" class="p-6 text-sm t3">没有可显示的内容</div>
    <div v-else-if="diff.isBinary" class="p-6 text-sm t3">二进制文件，暂不支持文本对比</div>
    <div v-show="diff && !diff.isBinary" ref="host" class="min-h-0 flex-1 overflow-hidden" />
  </div>
</template>

<style>
/* 让并排 diff 真正可滚动：外层定高、每侧独立滚动，横竖都能滚 */
.cm-mergeView {
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}
.cm-mergeView .cm-mergeViewEditors {
  height: 100%;
  max-height: 100%;
  display: flex;
  overflow: hidden;
}
.cm-mergeView .cm-mergeViewEditor {
  height: 100%;
  max-height: 100%;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
}
.cm-mergeView .cm-editor {
  height: 100%;
  max-height: 100%;
}
.cm-mergeView .cm-scroller {
  height: 100%;
  max-height: 100%;
  overflow: auto !important;
}
.cm-mergeView .cm-mergeViewEditor:first-child {
  border-right: 1px solid var(--border);
}
.cm-changedLine {
  background: var(--diff-change) !important;
}
.cm-changedText {
  background: var(--diff-change-strong) !important;
  border-radius: 2px;
}
.cm-insertedLine {
  background: var(--diff-insert) !important;
}
.cm-deletedLine {
  background: var(--diff-delete) !important;
}
.cm-changedLineGutter {
  background: var(--diff-change-strong) !important;
}
.cm-collapsedLines {
  background: var(--panel-3) !important;
  color: var(--text-mute) !important;
  font-size: 11px;
}
.cm-mergeGutter {
  background: var(--panel-2);
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { FileDiff } from '../api/types'
import { useSettingsStore } from '../stores/settings'

const props = defineProps<{
  file: string
  diff: FileDiff | null
  loading?: boolean
  fullscreen?: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'toggle-fullscreen'): void }>()

const settings = useSettingsStore()
const host = ref<HTMLElement | null>(null)
let view: MergeView | null = null
let seq = 0

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
  const ext = (file.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'jsx' })
    case 'ts':
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: ext === 'tsx',
      })
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'css':
    case 'scss':
    case 'less':
      return (await import('@codemirror/lang-css')).css()
    case 'html':
    case 'htm':
    case 'vue':
      return (await import('@codemirror/lang-html')).html()
    case 'md':
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'py':
      return (await import('@codemirror/lang-python')).python()
    default:
      return []
  }
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
      <span class="truncate font-mono text-[12px] t2">{{ file }}</span>
      <span v-if="diff && !diff.isBinary" class="shrink-0 text-[11px] t3">
        {{ diff.oldText.split('\n').length }} → {{ diff.newText.split('\n').length }} 行
      </span>
      <span v-if="diff?.truncated" class="shrink-0 rounded px-1.5 py-0.5 text-[11px]" :style="{ background: 'var(--badge-tag-bg)', color: 'var(--badge-tag-fg)' }">
        文件过大，已截断
      </span>
      <button class="btn ml-auto" :title="fullscreen ? '退出全屏' : '全屏查看'" @click="emit('toggle-fullscreen')">
        {{ fullscreen ? '退出全屏' : '全屏' }}
      </button>
      <button class="btn" @click="emit('close')">关闭 (Esc)</button>
    </header>

    <div v-if="loading" class="p-6 text-sm t3">加载文件内容…</div>
    <div v-else-if="!diff" class="p-6 text-sm t3">没有可显示的内容</div>
    <div v-else-if="diff.isBinary" class="p-6 text-sm t3">二进制文件，暂不支持文本对比</div>
    <div v-show="diff && !diff.isBinary" ref="host" class="min-h-0 flex-1 overflow-hidden" />
  </div>
</template>

<style>
.cm-mergeView {
  height: 100%;
}
.cm-mergeView .cm-mergeViewEditors {
  height: 100%;
  display: flex;
}
.cm-mergeView .cm-mergeViewEditor {
  height: 100%;
  flex: 1 1 0;
  min-width: 0;
}
.cm-mergeView .cm-editor {
  height: 100%;
}
.cm-mergeView .cm-scroller {
  overflow: auto;
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

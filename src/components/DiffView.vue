<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { FileDiff } from '../api/types'

const props = defineProps<{
  file: string
  diff: FileDiff | null
  loading?: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const host = ref<HTMLElement | null>(null)
let view: MergeView | null = null
let seq = 0

const highlight = HighlightStyle.define([
  { tag: tags.comment, color: '#5b6472', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#c084fc' },
  { tag: [tags.string, tags.special(tags.string)], color: '#86efac' },
  { tag: [tags.number, tags.bool, tags.null], color: '#fbbf24' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#60a5fa' },
  { tag: [tags.typeName, tags.className], color: '#5eead4' },
  { tag: tags.propertyName, color: '#93c5fd' },
  { tag: [tags.operator, tags.punctuation], color: '#94a3b8' },
  { tag: tags.heading, color: '#f0abfc', fontWeight: '600' },
])

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#cbd5e1', height: '100%' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', Consolas, 'Cascadia Code', monospace",
      fontSize: '12px',
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'transparent' },
    '.cm-gutters': {
      backgroundColor: '#0e1117',
      color: '#3f4855',
      border: 'none',
      fontSize: '11px',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(91,157,255,.18) !important' },
  },
  { dark: true },
)

const common: Extension[] = [
  lineNumbers(),
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  theme,
  syntaxHighlighting(highlight),
]

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
  const ext = [...common, lang]
  view = new MergeView({
    a: { doc: props.diff.oldText, extensions: ext },
    b: { doc: props.diff.newText, extensions: ext },
    parent: host.value,
    collapseUnchanged: { margin: 3, minSize: 5 },
    highlightChanges: true,
    gutter: true,
  })
}

watch(() => [props.diff, props.file], build, { deep: false })
onMounted(build)
onBeforeUnmount(() => {
  seq++
  destroy()
})
</script>

<template>
  <div class="fixed inset-0 z-40 flex flex-col bg-[#0b0d12]">
    <header class="flex h-11 shrink-0 items-center gap-3 border-b border-white/5 bg-[#12151d] px-4">
      <span class="truncate font-mono text-[12px] text-slate-300">{{ file }}</span>
      <span v-if="diff && !diff.isBinary" class="shrink-0 text-[11px] text-slate-500">
        {{ diff.oldText.split('\n').length }} → {{ diff.newText.split('\n').length }} 行
      </span>
      <span v-if="diff?.truncated" class="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
        文件过大，已截断
      </span>
      <button
        class="ml-auto rounded border border-white/10 px-2.5 py-[3px] text-[12px] text-slate-400 hover:border-white/20 hover:text-slate-200"
        @click="emit('close')"
      >
        关闭 (Esc)
      </button>
    </header>

    <div v-if="loading" class="p-6 text-sm text-slate-500">加载文件内容…</div>
    <div v-else-if="!diff" class="p-6 text-sm text-slate-500">没有可显示的内容</div>
    <div v-else-if="diff.isBinary" class="p-6 text-sm text-slate-500">
      二进制文件，暂不支持文本对比
    </div>
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
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.cm-changedLine {
  background: rgba(91, 157, 255, 0.08) !important;
}
.cm-changedText {
  background: rgba(91, 157, 255, 0.2) !important;
  border-radius: 2px;
}
.cm-insertedLine {
  background: rgba(34, 197, 94, 0.08) !important;
}
.cm-deletedLine {
  background: rgba(244, 63, 94, 0.08) !important;
}
.cm-changedLineGutter {
  background: rgba(91, 157, 255, 0.14) !important;
}
.cm-collapsedLines {
  background: #12151d !important;
  color: #64748b !important;
  font-size: 11px;
}
.cm-mergeGutter {
  background: #0e1117;
}
</style>

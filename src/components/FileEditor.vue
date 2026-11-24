<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { languageFor } from '../lib/lang'
import { useSettingsStore } from '../stores/settings'
import Icon from './Icon.vue'

const props = defineProps<{
  file: string
  content: string
  dirty?: boolean
  saving?: boolean
  loading?: boolean
  editable?: boolean
  encoding?: string
  size?: number
  lines?: number
  truncated?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'save'): void
  (e: 'reload'): void
  (e: 'close'): void
}>()

const settings = useSettingsStore()
const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
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
])

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

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
      '.cm-content': { caretColor: cssVar('--accent', '#5b9dff') },
      '.cm-gutters': {
        backgroundColor: cssVar('--panel-2', '#0e1117'),
        color: cssVar('--text-mute', '#3f4855'),
        border: 'none',
        fontSize: '11px',
      },
      '.cm-activeLine': { backgroundColor: cssVar('--panel-2', '#0e1117') + '80' },
      '.cm-activeLineGutter': { backgroundColor: cssVar('--panel-2', '#0e1117') },
      '.cm-selectionBackground': { backgroundColor: cssVar('--accent-weak', '') + ' !important' },
    },
    { dark },
  )
}

const sizeLabel = computed(() => {
  const b = props.size ?? 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
})

function destroy() {
  view?.destroy()
  view = null
  if (host.value) host.value.innerHTML = ''
}

async function build() {
  if (!host.value) return
  const mine = ++seq
  const lang = await languageFor(props.file)
  if (mine !== seq || !host.value) return
  destroy()

  const readOnly = props.editable === false
  view = new EditorView({
    state: EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        themeExtensions(),
        syntaxHighlighting(highlight),
        lang,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              emit('save')
              return true
            },
          },
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('change', u.state.doc.toString())
        }),
      ],
    }),
    parent: host.value,
  })
}

watch(() => [props.file, settings.theme], build)
onMounted(build)
onBeforeUnmount(() => {
  seq++
  destroy()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" :style="{ background: 'var(--bg)' }">
    <header class="line-b flex h-10 shrink-0 items-center gap-2 px-3" :style="{ background: 'var(--panel)' }">
      <Icon name="file" :size="13" class="shrink-0 t3" />
      <span class="min-w-0 truncate font-mono text-[12px] t2">{{ file }}</span>
      <span v-if="dirty" class="shrink-0 rounded px-1.5 text-[10px]" :style="{ background: 'var(--accent-weak)', color: 'var(--accent)' }">
        未保存
      </span>
      <span class="shrink-0 text-[11px] t3">{{ lines ?? 0 }} 行 · {{ sizeLabel }}</span>

      <span class="ml-auto flex shrink-0 items-center gap-1">
        <span v-if="editable === false" class="mr-1 text-[10px] t3">
          {{ encoding !== 'utf8' && encoding !== 'utf8bom' ? '非 UTF-8，只读' : '过大，只读预览' }}
        </span>
        <button class="btn" :disabled="loading" @click="emit('reload')">重新加载</button>
        <button
          class="btn btn-primary"
          :disabled="!editable || !dirty || saving"
          :style="!editable || !dirty ? { opacity: 0.5 } : {}"
          title="保存 (Ctrl+S)"
          @click="emit('save')"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button class="btn" @click="emit('close')">关闭 (Esc)</button>
      </span>
    </header>

    <div v-if="loading" class="p-6 text-sm t3">加载文件…</div>
    <div v-show="!loading" ref="host" class="min-h-0 flex-1 overflow-hidden" />
  </div>
</template>

<style>
.cm-editor {
  height: 100%;
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, lineNumbers, keymap, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { convertFileSrc } from '@tauri-apps/api/core'
import { languageFor } from '../lib/lang'
import { codeHighlight } from '../lib/codeHighlight'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import { isTauri, openExternal } from '../api/desktop'
import Icon from './Icon.vue'
import IconButton from './IconButton.vue'

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
  hasMore?: boolean
  loadingMore?: boolean
  loadedBytes?: number
}>()

const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'save'): void
  (e: 'reload'): void
  (e: 'close'): void
  (e: 'load-more'): void
}>()

const settings = useSettingsStore()
const repo = useRepoStore()
const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let seq = 0
let removeScroll: (() => void) | null = null
let streamArmed = true

const isMarkdown = computed(() => /\.(md|markdown|mdx)$/i.test(props.file))
const previewMode = ref(false)

/** 把 Markdown 里的仓库相对图片路径解析成 Tauri 资源地址 */
function resolveLocalAsset(src: string): string | null {
  const root = (repo.path || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!isTauri || !root) return null
  if (!src || src.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  let rel = src.split('#')[0].split('?')[0]
  try {
    rel = decodeURI(rel)
  } catch {
    /* 保留原样 */
  }
  if (!rel) return null
  if (!rel.startsWith('/')) {
    const dir = props.file.split('/').slice(0, -1).join('/')
    rel = dir ? `${dir}/${rel}` : rel
  }
  const parts: string[] = []
  for (const seg of rel.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  if (!parts.length) return null
  return convertFileSrc(`${root}/${parts.join('/')}`)
}

const renderedMarkdown = computed(() => {
  if (!isMarkdown.value || !previewMode.value) return ''
  const html = marked.parse(props.content || '', { async: false }) as string
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  if (!isTauri || !repo.path) return clean
  const box = document.createElement('div')
  box.innerHTML = clean
  let changed = false
  for (const img of Array.from(box.querySelectorAll('img'))) {
    const asset = resolveLocalAsset(img.getAttribute('src') || '')
    if (asset) {
      img.setAttribute('src', asset)
      changed = true
    }
  }
  return changed ? box.innerHTML : clean
})

function onPreviewClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (href.startsWith('#')) return
  e.preventDefault()
  if (/^https?:\/\//i.test(href)) void openExternal(href)
}

watch(
  () => props.file,
  () => {
    previewMode.value = isMarkdown.value
  },
  { immediate: true },
)

/* ── 文件内搜索（Ctrl+F） ── */
const searchOpen = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const matchCount = ref(0)
const matchIndex = ref(0)
let matchPositions: number[] = []

/** Markdown 预览内搜索：在渲染后的 DOM 文本节点上包 <mark>，避免破坏链接与结构 */
const previewEl = ref<HTMLElement | null>(null)
let previewMarks: HTMLElement[] = []

function clearPreviewMarks() {
  if (!previewMarks.length) return
  const parents = new Set<Node>()
  for (const mark of previewMarks) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parents.add(parent)
  }
  for (const p of parents) (p as Node).normalize()
  previewMarks = []
}

function jumpPreview(idx: number) {
  if (!previewMarks.length) return
  const i = ((idx % previewMarks.length) + previewMarks.length) % previewMarks.length
  previewMarks.forEach((m) => m.classList.remove('md-hit-current'))
  const mark = previewMarks[i]
  mark.classList.add('md-hit-current')
  mark.scrollIntoView({ block: 'center', inline: 'nearest' })
  matchIndex.value = i
}

function computePreviewMatches(jump = true) {
  clearPreviewMarks()
  matchCount.value = 0
  const box = previewEl.value
  const needle = query.value.trim().toLowerCase()
  if (!box || !needle) return

  const nodes: Text[] = []
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent || !node.nodeValue) continue
    if (parent.closest('script,style')) continue
    if (!node.nodeValue.toLowerCase().includes(needle)) continue
    nodes.push(node)
  }

  const marks: HTMLElement[] = []
  for (const node of nodes) {
    const value = node.nodeValue || ''
    const hay = value.toLowerCase()
    let at = hay.indexOf(needle)
    if (at < 0) continue
    const frag = document.createDocumentFragment()
    let last = 0
    while (at >= 0 && marks.length < 3000) {
      if (at > last) frag.appendChild(document.createTextNode(value.slice(last, at)))
      const mark = document.createElement('mark')
      mark.className = 'md-hit'
      mark.textContent = value.slice(at, at + needle.length)
      frag.appendChild(mark)
      marks.push(mark)
      last = at + needle.length
      at = hay.indexOf(needle, last)
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }

  previewMarks = marks
  matchCount.value = marks.length
  if (matchIndex.value >= marks.length) matchIndex.value = 0
  if (jump && marks.length) jumpPreview(matchIndex.value)
}

/** 所有搜索匹配的高亮装饰（当前匹配仍用原生选区强调） */
const setSearchMatches = StateEffect.define<{ from: number; to: number }[]>()
const searchMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setSearchMatches)) {
        next = Decoration.set(
          e.value.map(({ from, to }) => Decoration.mark({ class: 'cm-searchMatch' }).range(from, to)),
          true,
        )
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

function clearSearchMatches() {
  matchPositions = []
  matchCount.value = 0
  view?.dispatch({ effects: setSearchMatches.of([]) })
  clearPreviewMarks()
}

function computeMatches(jump = true) {
  if (isMarkdown.value && previewMode.value) {
    computePreviewMatches(jump)
    return
  }
  const v = view
  const q = query.value
  if (!v || !q) {
    clearSearchMatches()
    return
  }
  const doc = v.state.doc.toString()
  const hay = doc.toLowerCase()
  const needle = q.toLowerCase()
  const hits: number[] = []
  let i = hay.indexOf(needle)
  while (i >= 0 && hits.length < 5000) {
    hits.push(i)
    i = hay.indexOf(needle, i + Math.max(1, needle.length))
  }
  matchPositions = hits
  matchCount.value = hits.length
  if (matchIndex.value >= hits.length) matchIndex.value = 0
  v.dispatch({
    effects: setSearchMatches.of(hits.map((from) => ({ from, to: from + q.length }))),
  })
  if (jump) jumpTo(matchIndex.value)
}

function jumpTo(idx: number) {
  const v = view
  if (!v || !matchPositions.length) return
  const pos = matchPositions[(idx + matchPositions.length) % matchPositions.length]
  v.dispatch({
    selection: { anchor: pos, head: pos + query.value.length },
    scrollIntoView: true,
  })
  matchIndex.value = (idx + matchPositions.length) % matchPositions.length
}

function step(delta: number) {
  if (isMarkdown.value && previewMode.value) {
    if (!previewMarks.length) computePreviewMatches(false)
    if (!previewMarks.length) return
    jumpPreview(matchIndex.value + delta)
    return
  }
  if (!matchPositions.length) computeMatches()
  if (!matchPositions.length) return
  jumpTo(matchIndex.value + delta)
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

function closeSearch() {
  searchOpen.value = false
  clearSearchMatches()
  if (!(isMarkdown.value && previewMode.value)) view?.focus()
}

/** 预览态下 Ctrl+F 也能打开文件内搜索（捕获阶段先于全局快捷键） */
function onPreviewKey(e: KeyboardEvent) {
  if (!isMarkdown.value || !previewMode.value) return
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    openSearch()
  }
}

watch([previewMode, () => props.file], () => {
  clearPreviewMarks()
  if (searchOpen.value) nextTick(() => computeMatches())
})

watch(renderedMarkdown, () => {
  if (searchOpen.value && isMarkdown.value && previewMode.value) {
    nextTick(() => computePreviewMatches(true))
  }
})

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
      '.cm-searchMatch': {
        backgroundColor: 'rgba(250, 204, 21, .38)',
        borderRadius: '2px',
      },
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

const loadedLabel = computed(() => {
  const b = props.loadedBytes ?? 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
})

function destroy() {
  removeScroll?.()
  removeScroll = null
  view?.destroy()
  view = null
  if (host.value) host.value.innerHTML = ''
}

/** 大文件预览：滚动到接近底部时自动续读下一段 */
function attachStream() {
  const el = view?.scrollDOM
  if (!el) return
  const onScroll = () => {
    if (!props.hasMore || props.loadingMore || !streamArmed) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 420) {
      streamArmed = false
      emit('load-more')
    }
  }
  el.addEventListener('scroll', onScroll, { passive: true })
  removeScroll = () => el.removeEventListener('scroll', onScroll)
}

async function build() {
  if (!host.value) return
  const mine = ++seq
  const lang = await languageFor(props.file)
  if (mine !== seq || !host.value) return
  const prevTop = view?.scrollDOM.scrollTop ?? 0
  destroy()

  const readOnly = props.editable === false
  view = new EditorView({
    state: EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        themeExtensions(),
        syntaxHighlighting(codeHighlight(settings.theme)),
        searchMatchField,
        lang,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        keymap.of([
          {
            key: 'Mod-f',
            preventDefault: true,
            run: () => {
              openSearch()
              return true
            },
          },
          {
            key: 'Escape',
            run: () => {
              if (searchOpen.value) {
                closeSearch()
                return true
              }
              return false
            },
          },
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
          if (u.docChanged) {
            emit('change', u.state.doc.toString())
            if (searchOpen.value && query.value) {
              // 续读/外部更新后重新计算匹配位置（避免装饰错位）
              window.setTimeout(() => {
                if (searchOpen.value && query.value) computeMatches(false)
              }, 0)
            }
          }
        }),
      ],
    }),
    parent: host.value,
  })
  attachStream()
  if (prevTop > 0) {
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = prevTop
    })
  }
}

watch(() => [props.file, settings.theme, props.editable], build)

watch(
  () => props.loadingMore,
  (v) => {
    if (!v) streamArmed = true
  },
)

/**
 * 内容从外面变了（刚读完文件 / 点了重新加载 / 保存成功 / 滚动续读）时同步进编辑器。
 * 自己敲字时 props.content 会跟着变，此时 doc 已经等于它，不会重建。
 * 续读是在末尾追加，只插入新增部分，保留滚动位置。
 */
watch(
  () => props.content,
  (next) => {
    if (!view) {
      build()
      return
    }
    const old = view.state.doc.toString()
    if (old === next) return
    if (next.startsWith(old) && next.length > old.length) {
      view.dispatch({ changes: { from: old.length, insert: next.slice(old.length) } })
      return
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    })
  },
)

onMounted(() => {
  window.addEventListener('keydown', onPreviewKey, true)
  build()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPreviewKey, true)
  clearPreviewMarks()
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
      <span v-if="hasMore" class="shrink-0 text-[11px] t3">
        已加载 {{ loadedLabel }} / {{ sizeLabel }} · 滚动继续
      </span>
      <span v-else class="shrink-0 text-[11px] t3">{{ lines ?? 0 }} 行 · {{ sizeLabel }}</span>
      <span v-if="loadingMore" class="inline-flex shrink-0 items-center gap-1 text-[11px]" :style="{ color: 'var(--accent)' }">
        <span class="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-r-transparent" />
        加载中…
      </span>

      <span class="ml-auto flex shrink-0 items-center gap-1">
        <span v-if="editable === false" class="mr-1 text-[10px] t3">
          {{ encoding !== 'utf8' && encoding !== 'utf8bom' ? '非 UTF-8，只读' : hasMore ? '分段加载中，读完可编辑' : '过大，只读预览' }}
        </span>
        <button
          v-if="isMarkdown"
          class="btn shrink-0 px-2 py-0 text-[11px]"
          :style="previewMode ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
          :title="previewMode ? '切换到 Markdown 源码' : '预览 Markdown'"
          @click="previewMode = !previewMode"
        >
          {{ previewMode ? '源码' : '预览' }}
        </button>
        <IconButton name="search" title="在文件内搜索 (Ctrl+F)" @click="openSearch" />
        <IconButton name="refresh" title="重新加载" :disabled="loading" @click="emit('reload')" />
        <IconButton
          name="save"
          :title="saving ? '保存中…' : '保存 (Ctrl+S)'"
          :active="!!dirty && editable !== false"
          :disabled="!editable || !dirty || saving"
          @click="emit('save')"
        />
        <IconButton name="close" title="关闭 (Esc)" @click="emit('close')" />
      </span>
    </header>

    <div v-if="searchOpen" class="line-b flex h-8 shrink-0 items-center gap-2 px-3" :style="{ background: 'var(--panel-2)' }">
      <span class="shrink-0 text-[11px] t3">文件内搜索</span>
      <input
        ref="searchInput"
        v-model="query"
        class="field w-[220px] px-2 py-0.5 text-[11px]"
        placeholder="输入关键字，回车下一个"
        @input="computeMatches()"
        @keydown.enter.prevent="step(1)"
        @keydown.esc.prevent="closeSearch"
      />
      <span class="shrink-0 text-[11px] t3">
        {{ matchCount ? `${matchIndex + 1} / ${matchCount}` : query ? '无匹配' : '' }}
      </span>
      <IconButton compact name="chevron-up" title="上一个匹配" :size="13" @click="step(-1)" />
      <IconButton compact name="chevron-down" title="下一个匹配" :size="13" @click="step(1)" />
      <IconButton class="ml-auto" compact name="close" title="关闭搜索" :size="13" @click="closeSearch" />
    </div>

    <div v-if="loading" class="p-6 text-sm t3">加载文件…</div>
    <div
      v-else-if="isMarkdown && previewMode"
      ref="previewEl"
      class="md-preview min-h-0 flex-1 overflow-y-auto px-7 py-5"
      @click="onPreviewClick"
      v-html="renderedMarkdown"
    />
    <div
      v-show="!loading && !(isMarkdown && previewMode)"
      ref="host"
      class="min-h-0 flex-1 overflow-hidden"
    />
  </div>
</template>

<style>
.cm-editor {
  height: 100%;
}

.md-preview {
  color: var(--text);
  font-size: 14px;
  line-height: 1.75;
  max-width: 980px;
  margin: 0 auto;
}
.md-preview h1,
.md-preview h2,
.md-preview h3,
.md-preview h4 {
  color: var(--text);
  font-weight: 650;
  line-height: 1.3;
  margin: 1.4em 0 0.6em;
}
.md-preview h1 {
  font-size: 1.75em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.35em;
}
.md-preview h2 {
  font-size: 1.4em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25em;
}
.md-preview h3 {
  font-size: 1.18em;
}
.md-preview p {
  margin: 0.75em 0;
}
.md-preview a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md-preview ul,
.md-preview ol {
  padding-left: 1.6em;
  margin: 0.7em 0;
}
.md-preview li {
  margin: 0.25em 0;
}
.md-preview blockquote {
  margin: 0.9em 0;
  padding: 0.2em 0 0.2em 1em;
  border-left: 3px solid var(--accent);
  color: var(--text-dim);
  background: var(--panel-2);
}
.md-preview code {
  font-family: 'JetBrains Mono', Consolas, 'Cascadia Code', monospace;
  font-size: 0.9em;
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.md-preview pre {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow: auto;
  margin: 0.9em 0;
}
.md-preview pre code {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  line-height: 1.6;
}
.md-preview table {
  border-collapse: collapse;
  margin: 0.9em 0;
  width: 100%;
  font-size: 0.92em;
}
.md-preview th,
.md-preview td {
  border: 1px solid var(--border);
  padding: 0.4em 0.7em;
  text-align: left;
}
.md-preview th {
  background: var(--panel-3);
  font-weight: 600;
}
.md-preview img {
  max-width: 100%;
  border-radius: 8px;
}
.md-preview mark.md-hit {
  background: rgba(250, 204, 21, 0.34);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
.md-preview mark.md-hit-current {
  background: #f59e0b;
  color: #111827;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.35);
}
.md-preview hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}
</style>

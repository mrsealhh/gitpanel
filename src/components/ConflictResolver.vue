<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRepoStore } from '../stores/repo'

const repo = useRepoStore()

type Choice = 'ours' | 'theirs' | 'both' | 'none'
const choices = ref<Record<number, Choice>>({})

const detail = computed(() => repo.conflict)

watch(
  () => repo.conflict,
  (c) => {
    choices.value = {}
    if (!c) return
    c.blocks.forEach((b, i) => {
      if (b.type === 'conflict') choices.value[i] = 'ours'
    })
  },
)

const conflicts = computed(() =>
  (detail.value?.blocks ?? []).map((b, i) => ({ b, i })).filter(({ b }) => b.type === 'conflict'),
)

const resolvedText = computed(() => {
  const d = detail.value
  if (!d) return ''
  return d.blocks
    .map((b, i) => {
      if (b.type !== 'conflict') return b.text ?? ''
      const c = choices.value[i] ?? 'ours'
      if (c === 'theirs') return b.theirs ?? ''
      if (c === 'both') return `${b.ours ?? ''}\n${b.theirs ?? ''}`
      if (c === 'none') return ''
      return b.ours ?? ''
    })
    .join('\n')
})

const lineCount = computed(() => resolvedText.value.split('\n').length)

function setAll(c: Choice) {
  for (const { i } of conflicts.value) choices.value[i] = c
}

function setChoice(i: number, c: Choice) {
  choices.value[i] = c
}

async function save() {
  await repo.saveResolution(resolvedText.value)
}

function previewLines(t: string | undefined, max = 8) {
  const lines = (t ?? '').split('\n')
  return { text: lines.slice(0, max).join('\n'), more: Math.max(0, lines.length - max) }
}
</script>

<template>
  <div class="fixed inset-0 z-[45] flex flex-col" :style="{ background: 'var(--bg)' }">
    <header class="line-b flex h-11 shrink-0 items-center gap-2 px-4" :style="{ background: 'var(--panel)' }">
      <span class="text-[11px] font-semibold" style="color: #fb923c">冲突</span>
      <span class="truncate font-mono text-[12px] t1">{{ repo.conflictFile }}</span>
      <span class="shrink-0 text-[11px] t3">{{ conflicts.length }} 处冲突</span>
      <button class="btn ml-auto" @click="repo.resolveSide('ours')">整文件采用我方</button>
      <button class="btn" @click="repo.resolveSide('theirs')">整文件采用对方</button>
      <button class="btn" @click="repo.closeConflict()">关闭</button>
    </header>

    <div v-if="repo.conflictLoading" class="p-6 text-sm t3">读取冲突内容…</div>
    <div v-else-if="!detail" class="p-6 text-sm t3">没有可显示的冲突</div>

    <div v-else class="flex min-h-0 flex-1">
      <!-- 块级解决 -->
      <div class="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <div v-if="!detail.hasMarkers" class="mb-3 rounded-lg border p-3 text-[12px] t2" :style="{ borderColor: 'var(--border)' }">
          该文件没有文本冲突标记（可能是删除/重命名冲突），请直接选择「整文件采用我方 / 对方」。
        </div>

        <template v-for="(b, i) in detail.blocks" :key="i">
          <!-- 普通上下文 -->
          <pre
            v-if="b.type === 'text' && (b.text ?? '').trim()"
            class="mb-2 max-h-40 overflow-y-auto rounded border px-3 py-2 font-mono text-[11px] leading-relaxed t3"
            :style="{ borderColor: 'var(--border)', background: 'var(--panel-2)' }"
          >{{ previewLines(b.text).text }}<span v-if="previewLines(b.text).more" class="block opacity-60">… 还有 {{ previewLines(b.text).more }} 行</span></pre>

          <!-- 冲突块 -->
          <div
            v-else-if="b.type === 'conflict'"
            class="mb-3 overflow-hidden rounded-lg border"
            :style="{ borderColor: 'rgba(251,146,60,.35)' }"
          >
            <div class="flex items-center gap-2 px-3 py-1.5 text-[11px]" :style="{ background: 'rgba(251,146,60,.10)' }">
              <span style="color: #fb923c">冲突 {{ conflicts.findIndex((c) => c.i === i) + 1 }}</span>
              <span class="text-[10px] t3">{{ b.oursLabel }} ⇄ {{ b.theirsLabel }}</span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  v-for="opt in (['ours', 'theirs', 'both', 'none'] as Choice[])"
                  :key="opt"
                  class="rounded px-1.5 py-0.5 text-[10px]"
                  :style="
                    choices[i] === opt
                      ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                      : { background: 'var(--panel-3)', color: 'var(--text-dim)' }
                  "
                  @click="setChoice(i, opt)"
                >
                  {{ opt === 'ours' ? '我方' : opt === 'theirs' ? '对方' : opt === 'both' ? '两者都要' : '都不要' }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 divide-x" :style="{ borderColor: 'var(--border)' }">
              <div
                class="p-2"
                :style="choices[i] === 'ours' || choices[i] === 'both' ? { background: 'var(--diff-insert)' } : {}"
              >
                <div class="mb-1 text-[10px] t3">我方 (ours)</div>
                <pre class="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed t1">{{ b.ours || '（空）' }}</pre>
              </div>
              <div
                class="p-2"
                :style="choices[i] === 'theirs' || choices[i] === 'both' ? { background: 'var(--diff-insert)' } : {}"
              >
                <div class="mb-1 text-[10px] t3">对方 (theirs)</div>
                <pre class="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed t1">{{ b.theirs || '（空）' }}</pre>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 结果预览 -->
      <aside class="flex w-[380px] shrink-0 flex-col" :style="{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }">
        <div class="line-b flex items-center px-3 py-2 text-[11px] t3">
          解决结果预览
          <span class="ml-auto">{{ lineCount }} 行</span>
        </div>
        <pre
          class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed"
          :style="{ background: 'var(--panel-2)', color: 'var(--text-dim)' }"
        >{{ resolvedText }}</pre>
        <div class="line-t flex items-center gap-2 p-2">
          <button class="btn px-2 py-1 text-[11px]" @click="setAll('ours')">全部我方</button>
          <button class="btn px-2 py-1 text-[11px]" @click="setAll('theirs')">全部对方</button>
          <button class="btn btn-primary ml-auto px-3 py-1 text-[12px]" @click="save">保存并标记已解决</button>
        </div>
      </aside>
    </div>
  </div>
</template>

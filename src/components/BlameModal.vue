<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'
import { formatDate } from '../utils/time'

const repo = useRepoStore()

const shown = computed(() => repo.blameLines.slice(0, 1500))
const truncated = computed(() => repo.blameLines.length > 1500)

/** 相邻行同一次提交时给相同的底色，便于看出代码块归属 */
function sameAsPrev(i: number) {
  return i > 0 && shown.value[i]?.oid === shown.value[i - 1]?.oid
}
</script>

<template>
  <div v-if="repo.blameFile" class="overlay fixed inset-0 z-50 flex items-center justify-center"
    @click.self="repo.closeBlame()">
    <div class="modal animate-pop flex max-h-[86vh] w-[1000px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">Blame</span>
        <span class="truncate font-mono text-[11px] t3">{{ repo.blameFile }}</span>
        <span class="text-[11px] t3">{{ repo.blameLines.length }} 行</span>
        <button class="btn ml-auto" @click="repo.closeBlame()">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto" :style="{ background: 'var(--panel-2)' }">
        <table class="w-full border-collapse font-mono text-[11px]">
          <tbody>
            <tr v-for="(l, i) in shown" :key="l.line"
              :style="{ background: sameAsPrev(i) ? 'transparent' : 'rgba(128,128,128,.05)' }">
              <td class="w-12 select-none border-r px-2 text-right align-top t3"
                :style="{ borderColor: 'var(--border)', paddingTop: '2px', paddingBottom: '2px' }">
                {{ l.line }}
              </td>
              <td class="w-16 select-none border-r px-2 align-top"
                :style="{ borderColor: 'var(--border)', color: 'var(--accent)' }" :title="l.author + ' · ' + formatDate(l.time)">
                {{ sameAsPrev(i) ? '' : l.short }}
              </td>
              <td class="w-28 truncate border-r px-2 align-top t3"
                :style="{ borderColor: 'var(--border)' }">
                {{ sameAsPrev(i) ? '' : l.author }}
              </td>
              <td class="whitespace-pre px-2 align-top t1">{{ l.content || ' ' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="truncated" class="p-3 text-[11px] t3">仅显示前 1500 行</div>
      </div>
    </div>
  </div>
</template>

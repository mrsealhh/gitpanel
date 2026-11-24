<script setup lang="ts">
import { computed } from 'vue'
import { useRepoStore } from '../stores/repo'

const repo = useRepoStore()

function copyOid(oid: string) {
  void navigator.clipboard?.writeText(oid)
  repo.notify('ok', '已复制对象 ID')
}

function mb(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const stats = computed(() => {
  const h = repo.health
  if (!h) return []
  return [
    { label: '.git 目录', value: mb(h.gitSize) },
    { label: 'pack 体积', value: mb(h.packSize) },
    { label: 'pack 数', value: String(h.packCount) },
    { label: '松散对象', value: String(h.looseObjects) },
    { label: '包内对象', value: String(h.inPack) },
    { label: '垃圾对象', value: String(h.garbage) },
    { label: '提交', value: String(h.commits) },
    { label: '分支', value: String(h.branches) },
    { label: '标签', value: String(h.tags) },
    { label: '跟踪文件', value: String(h.files) },
  ]
})
</script>

<template>
  <div v-if="repo.health || repo.healthLoading" class="overlay fixed inset-0 z-50 flex items-center justify-center"
    @click.self="repo.closeHealth()">
    <div class="modal animate-pop flex max-h-[80vh] w-[640px] flex-col overflow-hidden">
      <header class="line-b flex items-center px-4 py-2.5">
        <span class="text-[13px] font-medium t1">仓库体检</span>
        <button class="btn ml-auto" @click="repo.closeHealth()">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div v-if="repo.healthLoading" class="py-6 text-center text-[12px] t3">正在统计（大仓库可能需要几秒）…</div>

        <template v-else-if="repo.health">
          <div class="grid grid-cols-5 gap-2">
            <div v-for="s in stats" :key="s.label" class="rounded-lg border px-2 py-1.5"
              :style="{ borderColor: 'var(--border)', background: 'var(--panel-2)' }">
              <div class="text-[10px] t3">{{ s.label }}</div>
              <div class="mt-0.5 text-[13px] font-medium t1">{{ s.value }}</div>
            </div>
          </div>

          <div v-if="repo.health.suggestions.length" class="mt-4">
            <div class="mb-1 text-[11px] font-medium t3">建议</div>
            <ul class="space-y-1">
              <li v-for="(s, i) in repo.health.suggestions" :key="i"
                class="rounded px-2 py-1 text-[11px]"
                :style="{ background: 'rgba(251,146,60,.10)', color: '#fb923c' }">
                {{ s }}
              </li>
            </ul>
          </div>

          <div v-if="repo.health.largeObjects.length" class="mt-4">
            <div class="mb-1 text-[11px] font-medium t3">历史中最大的对象（前 8）</div>
            <div v-for="o in repo.health.largeObjects" :key="o.oid"
              class="flex items-center gap-2 border-b py-1 text-[11px]"
              :style="{ borderColor: 'var(--border)' }">
              <span class="font-mono t3">{{ o.short }}</span>
              <span class="ml-auto t2">{{ mb(o.size) }}</span>
              <button class="text-[10px] accent" @click="copyOid(o.oid)">复制</button>
            </div>
            <div class="mt-1 text-[10px] t3">定位路径：git log --all --oneline --find-object=&lt;oid&gt;</div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

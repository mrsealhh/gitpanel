<script setup lang="ts">
import { ref } from 'vue'
import CommitList from './components/CommitList.vue'
import DetailPanel from './components/DetailPanel.vue'
import SidePanel from './components/SidePanel.vue'
import { useRepoStore } from './stores/repo'

const store = useRepoStore()
const pathInput = ref('F:\\gitlab\\gitpanel')

async function open() {
  await store.open(pathInput.value)
}
</script>

<template>
  <div class="flex h-screen flex-col bg-[#0b0d12] text-slate-300">
    <header class="flex h-11 shrink-0 items-center gap-2 border-b border-white/5 bg-[#12151d] px-3">
      <div class="mr-2 flex items-center gap-2">
        <div class="h-4 w-4 rounded bg-gradient-to-br from-sky-400 to-violet-500" />
        <span class="text-[13px] font-semibold text-slate-100">GitPanel</span>
      </div>
      <input
        v-model="pathInput"
        class="w-[420px] rounded border border-white/5 bg-black/40 px-2 py-1 font-mono text-[12px] text-slate-300 placeholder:text-slate-600 focus:border-sky-500/40 focus:outline-none"
        placeholder="仓库路径，例如 F:\\gitlab\\myrepo"
        @keydown.enter="open"
      />
      <button
        class="rounded bg-sky-500/90 px-3 py-1 text-[12px] font-medium text-white hover:bg-sky-400"
        @click="open"
      >
        打开
      </button>
      <span v-if="store.loading" class="text-[11px] text-slate-500">加载中…</span>
      <span v-if="store.error" class="truncate text-[11px] text-rose-400">{{ store.error }}</span>
      <div class="ml-auto text-[11px] text-slate-600">{{ store.rows.length }} commits</div>
    </header>

    <main v-if="store.info" class="flex min-h-0 flex-1">
      <SidePanel
        :refs="store.info.refs"
        :branch="store.info.branch"
        :tip="store.tip"
        :name="store.info.name"
        @filter="store.setTip($event)"
      />
      <CommitList
        class="min-w-0 flex-1"
        :rows="store.rows"
        :selected-oid="store.selected?.oid"
        :loading="store.loading"
        @select="store.select($event)"
        @load-more="store.loadMore()"
      />
      <DetailPanel :detail="store.detail" :loading="store.detailLoading" />
    </main>

    <main v-else class="flex min-h-0 flex-1">
      <div class="m-auto w-[520px] max-w-full px-6 text-center">
        <div class="mb-6 text-[13px] text-slate-500">打开一个 Git 仓库开始浏览</div>
        <div class="space-y-1 text-left">
          <button
            v-for="p in store.recent"
            :key="p"
            class="block w-full truncate rounded border border-white/5 bg-white/[0.02] px-3 py-2 text-left font-mono text-[12px] text-slate-400 hover:border-sky-500/30 hover:text-slate-200"
            @click="pathInput = p; open()"
          >
            {{ p }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

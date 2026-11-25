<script setup lang="ts">
import { ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { openExternal } from '../api/desktop'
import IconButton from './IconButton.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const repo = useRepoStore()

const draft = ref<Record<string, string>>({})
const newName = ref('')
const newUrl = ref('')

function urlOf(name: string, original: string) {
  return draft.value[name] ?? original
}

function setDraft(name: string, value: string) {
  draft.value = { ...draft.value, [name]: value }
}

async function save(remote: { name: string; url: string }) {
  const url = urlOf(remote.name, remote.url).trim()
  if (!url || url === remote.url) return
  await repo.setRemoteUrl(remote.name, url)
  const next = { ...draft.value }
  delete next[remote.name]
  draft.value = next
}

async function remove(remote: { name: string }) {
  if (!window.confirm(`确定删除远端 ${remote.name}？\n只删除本地仓库里的 remote 配置，不会删除远端仓库。`)) return
  await repo.removeRemote(remote.name)
  const next = { ...draft.value }
  delete next[remote.name]
  draft.value = next
}

async function add() {
  const name = newName.value.trim()
  const url = newUrl.value.trim()
  if (!name || !url) {
    repo.notify('err', '远端名称和地址都要填')
    return
  }
  await repo.addRemote(name, url)
  newName.value = ''
  newUrl.value = ''
}

function openWeb(url?: string) {
  if (url) void openExternal(url)
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[78vh] w-[680px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">远端仓库</span>
        <span class="text-[11px] t3">{{ repo.remotes.length }} 个</span>
        <span class="text-[10px] t3">只改本地 remote 配置，不会动远端仓库</span>
        <button class="btn ml-auto" @click="emit('close')">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div v-if="!repo.remotes.length" class="p-3 text-[12px] t3">
          还没有配置远端。添加一个 remote 后就可以 fetch / pull / push。
        </div>

        <div
          v-for="r in repo.remotes"
          :key="r.name"
          class="mb-2 rounded border px-2.5 py-2"
          :style="{ borderColor: 'var(--border)' }"
        >
          <div class="mb-1.5 flex items-center gap-2">
            <span class="rounded px-1.5 py-0.5 font-mono text-[11px]" :style="{ background: 'var(--panel-3)', color: 'var(--text-dim)' }">
              {{ r.name }}
            </span>
            <span class="truncate text-[10px] t3">{{ r.web || r.url }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <input
              :value="urlOf(r.name, r.url)"
              class="field min-w-0 flex-1 px-2 py-1 font-mono text-[11px]"
              placeholder="https://github.com/owner/repo.git"
              @input="setDraft(r.name, ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="save(r)"
            />
            <IconButton
              compact
              name="check"
              title="保存这个远端地址"
              :size="13"
              :disabled="urlOf(r.name, r.url).trim() === r.url"
              @click="save(r)"
            />
            <IconButton
              v-if="r.web"
              compact
              name="external"
              title="在浏览器打开远端仓库"
              :size="13"
              @click="openWeb(r.web)"
            />
            <IconButton compact name="trash" title="删除这个远端配置" danger :size="13" @click="remove(r)" />
          </div>
        </div>

        <div class="mt-3 rounded border p-2.5" :style="{ borderColor: 'var(--border)' }">
          <div class="mb-1.5 text-[11px] font-medium t2">添加远端</div>
          <div class="flex items-center gap-1.5">
            <input
              v-model="newName"
              class="field w-[110px] px-2 py-1 font-mono text-[11px]"
              placeholder="名称，如 origin"
              @keydown.enter.prevent="add"
            />
            <input
              v-model="newUrl"
              class="field min-w-0 flex-1 px-2 py-1 font-mono text-[11px]"
              placeholder="https://... 或 git@host:owner/repo.git"
              @keydown.enter.prevent="add"
            />
            <IconButton compact name="plus" title="添加远端" :size="14" @click="add" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

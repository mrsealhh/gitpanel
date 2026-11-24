<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import Icon from './Icon.vue'

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'rename', path: string): void
  (e: 'clone', url: string): void
  (e: 'browse'): void
}>()

const repo = useRepoStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLElement | null>(null)
const search = ref('')
const url = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

/** 下拉用 fixed 定位，避免被标题栏的 overflow-hidden 裁掉 */
const pos = ref({ left: 0, top: 0, maxHeight: 520 })

const current = computed(() => {
  const path = repo.info?.path
  const hit = repo.recents.find((r) => r.path === path)
  return hit?.alias || hit?.name || repo.info?.name || '未打开项目'
})

const items = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return repo.recents
  return repo.recents.filter(
    (r) =>
      (r.alias || '').toLowerCase().includes(kw) ||
      r.name.toLowerCase().includes(kw) ||
      r.path.toLowerCase().includes(kw),
  )
})

const canClone = computed(() => /^(https?:\/\/|git@|ssh:\/\/)/.test(url.value.trim()))

/** 粘贴的是本地路径（盘符 / UNC）时，直接当「打开本地仓库」 */
const isLocalPath = computed(
  () => /^[a-zA-Z]:[\\/]/.test(url.value.trim()) || url.value.trim().startsWith('\\\\'),
)

const canSubmit = computed(() => canClone.value || isLocalPath.value)

function place() {
  const r = btn.value?.getBoundingClientRect()
  if (!r) return
  pos.value = {
    left: Math.max(8, Math.min(r.left, window.innerWidth - 400)),
    top: r.bottom + 6,
    maxHeight: Math.max(240, window.innerHeight - r.bottom - 24),
  }
}

async function toggle() {
  if (!open.value) {
    search.value = ''
    url.value = ''
    place()
    open.value = true
    await nextTick()
    searchInput.value?.focus()
  } else {
    open.value = false
  }
}

function pick(path: string) {
  emit('open', path)
  open.value = false
}

function doClone() {
  if (!canSubmit.value) return
  if (isLocalPath.value) {
    emit('open', url.value.trim())
  } else {
    emit('clone', url.value.trim())
  }
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('keydown', onEsc)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div ref="root" class="shrink-0">
    <button
      ref="btn"
      class="btn flex max-w-[240px] items-center gap-1.5"
      :title="repo.info?.path || '选择 / 打开项目'"
      @click="toggle"
    >
      <Icon name="folder" :size="13" class="shrink-0" />
      <span class="truncate">{{ current }}</span>
      <span class="shrink-0 text-[9px] t3">▾</span>
    </button>

    <div
      v-if="open"
      class="modal animate-pop fixed z-[60] flex w-[392px] flex-col overflow-hidden"
      :style="{ left: pos.left + 'px', top: pos.top + 'px', maxHeight: pos.maxHeight + 'px' }"
    >
      <!-- 搜索已保存项目 -->
      <div class="line-b px-2 py-2">
        <div class="relative">
          <input
            ref="searchInput"
            v-model="search"
            class="field w-full py-1 pl-7 pr-2 text-[12px]"
            placeholder="搜索已保存的项目 / 路径"
            @keydown.enter="items[0] && pick(items[0].path)"
          />
          <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] t3">⌕</span>
        </div>
      </div>

      <div class="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wider t3">
        全部项目（{{ repo.recents.length }}）
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-for="r in items"
          :key="r.path"
          class="row-hover group flex cursor-pointer items-center gap-2 px-3 py-1.5"
          @click="pick(r.path)"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{ background: r.path === repo.info?.path ? 'var(--accent)' : 'transparent' }"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-[12px]"
              :style="{ color: r.path === repo.info?.path ? 'var(--accent)' : 'var(--text)' }"
            >
              {{ r.alias || r.name }}
              <span v-if="r.pinned" class="ml-1 text-[10px] t3">📌</span>
            </span>
            <span class="block truncate font-mono text-[10px] t3">{{ r.path }}</span>
          </span>
          <button
            class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:opacity-100 group-hover:opacity-100"
            :title="r.pinned ? '取消置顶' : '置顶'"
            @click.stop="repo.pinRecent(r.path, !r.pinned)"
          >
            {{ r.pinned ? '取消置顶' : '置顶' }}
          </button>
          <button
            class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:opacity-100 group-hover:opacity-100"
            title="重命名"
            @click.stop="emit('rename', r.path); open = false"
          >
            改名
          </button>
          <button
            class="shrink-0 px-1 text-[10px] t3 opacity-0 hover:text-rose-400 group-hover:opacity-100"
            title="从列表移除（不删除磁盘文件）"
            @click.stop="repo.forget(r.path)"
          >
            移除
          </button>
        </div>
        <div v-if="!items.length" class="px-3 py-3 text-[11px] t3">
          {{ repo.recents.length ? '没有匹配的项目' : '还没有打开过项目' }}
        </div>
      </div>

      <!-- 打开本地 / 粘贴地址克隆 -->
      <div class="line-t px-2 py-2">
        <div class="mb-2 flex gap-1">
          <button class="btn flex-1 px-2 py-1 text-[11px]" @click="emit('browse'); open = false">
            打开本地仓库…
          </button>
        </div>
        <div class="flex gap-1">
          <input
            v-model="url"
            class="field min-w-0 flex-1 px-2 py-1 font-mono text-[11px]"
            placeholder="粘贴 .git 地址或本地路径，例如 https://github.com/o/r.git"
            @keydown.enter="doClone"
          />
          <button
            class="btn btn-primary shrink-0 px-2 py-1 text-[11px]"
            :disabled="!canSubmit"
            :style="!canSubmit ? { opacity: 0.45 } : {}"
            @click="doClone"
          >
            {{ isLocalPath ? '打开' : '克隆' }}
          </button>
        </div>
        <div class="mt-1 text-[10px] t3">
          支持 https / ssh / git@ 地址（克隆目录再选一次），也可以直接粘贴本机仓库路径
        </div>
      </div>
    </div>
  </div>
</template>

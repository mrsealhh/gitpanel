<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { useSettingsStore } from '../stores/settings'
import { pickFolder } from '../api/desktop'
import IconButton from './IconButton.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const repo = useRepoStore()
const settings = useSettingsStore()
const scanning = ref(false)

const rows = computed(() =>
  [...repo.recents].sort(
    (a, b) =>
      a.groupPath.localeCompare(b.groupPath, 'zh-CN') ||
      a.sortOrder - b.sortOrder ||
      (a.alias || a.name).localeCompare(b.alias || b.name, 'zh-CN'),
  ),
)

/** 已有分组路径 + 它们的父级，供 datalist 提示 */
const groups = computed(() => {
  const set = new Set<string>()
  for (const r of repo.recents) {
    const parts = r.groupPath.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i += 1) set.add(parts.slice(0, i).join('/'))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

function nameOf(r: { alias: string; name: string }) {
  return r.alias || r.name
}

async function setGroup(path: string, value: string) {
  await repo.setRepoGroup(path, value)
}

async function move(path: string, delta: number) {
  await repo.moveRepoInGroup(path, delta)
}

async function scan() {
  const dir = await pickFolder('选择包含 Git 项目的文件夹')
  if (!dir) return
  scanning.value = true
  try {
    await repo.scanAndImport(dir)
  } catch (e) {
    repo.notify('err', String((e as Error).message || e))
  } finally {
    scanning.value = false
  }
}

async function remove(path: string) {
  if (!window.confirm('从仓库列表移除？不会删除磁盘文件。')) return
  await repo.forget(path)
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[84vh] w-[880px] flex-col overflow-hidden">
      <header class="line-b flex items-center gap-2 px-4 py-2.5">
        <span class="text-[13px] font-medium t1">整理仓库</span>
        <span class="text-[11px] t3">{{ repo.recents.length }} 个</span>
        <span class="text-[10px] t3">分组最多三级，例如 公司/前端/重点项目</span>
        <div class="ml-auto flex items-center gap-1">
          <select
            v-model="settings.repoSort"
            class="field px-2 py-1 text-[11px]"
            title="排序方式"
            @change="settings.save()"
          >
            <option value="manual">手动排序</option>
            <option value="name">按名称</option>
            <option value="recent">最近打开</option>
          </select>
          <button class="btn px-2 py-1 text-[11px]" :disabled="scanning" @click="scan">
            {{ scanning ? '扫描中…' : '扫描文件夹导入…' }}
          </button>
          <IconButton compact name="close" title="关闭" :size="14" @click="emit('close')" />
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div v-if="!rows.length" class="p-4 text-center text-[12px] t3">
          还没有仓库。可以「扫描文件夹导入」，或从项目下拉里打开本地仓库。
        </div>

        <div
          v-for="r in rows"
          :key="r.path"
          class="mb-1.5 flex items-center gap-2 rounded border px-2.5 py-1.5"
          :style="{ borderColor: r.path === repo.info?.path ? 'var(--accent)' : 'var(--border)' }"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{ background: r.path === repo.info?.path ? 'var(--accent)' : 'transparent' }"
          />
          <div class="min-w-0 w-[230px] shrink-0">
            <div class="truncate text-[12px] t1">{{ nameOf(r) }}</div>
            <div class="truncate font-mono text-[10px] t3" :title="r.path">{{ r.path }}</div>
          </div>
          <input
            :value="r.groupPath"
            list="gitpanel-groups"
            class="field w-[190px] shrink-0 px-2 py-1 text-[11px]"
            placeholder="分组，如 公司/前端"
            title="最多三级；留空表示不分组"
            @change="setGroup(r.path, ($event.target as HTMLInputElement).value)"
          />
          <div class="flex shrink-0 items-center gap-0.5">
            <IconButton compact name="chevron-up" title="分组内上移" :size="12" @click="move(r.path, -1)" />
            <IconButton compact name="chevron-down" title="分组内下移" :size="12" @click="move(r.path, 1)" />
            <IconButton
              compact
              name="pin"
              :title="r.pinned ? '取消置顶' : '置顶（顶部出现快速切换 tab）'"
              :active="r.pinned"
              :size="12"
              @click="repo.pinRecent(r.path, !r.pinned)"
            />
            <IconButton compact name="trash" title="从列表移除" danger :size="12" @click="remove(r.path)" />
          </div>
          <span class="ml-auto shrink-0 text-[10px] t3">{{ r.sortOrder }}</span>
        </div>

        <datalist id="gitpanel-groups">
          <option v-for="g in groups" :key="g" :value="g" />
        </datalist>
      </div>

      <footer class="line-t px-4 py-2 text-[10px] t3">
        分组会同步到项目下拉；置顶仓库会出现在顶部 tab，超出后可横向滚动。扫描导入会按文件夹层级自动分组（最多三级）。
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { THEME_LABELS, useSettingsStore } from '../stores/settings'
import type { ThemeId } from '../stores/settings'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'settings'): void
  (e: 'dashboard'): void
}>()

const repo = useRepoStore()
const settings = useSettingsStore()
const q = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

interface Item {
  id: string
  title: string
  hint?: string
  group: string
  run: () => void
}

const items = computed<Item[]>(() => {
  const list: Item[] = [
    {
      id: 'settings',
      title: '打开设置',
      hint: 'Ctrl + ,',
      group: '应用',
      run: () => emit('settings'),
    },
    {
      id: 'refresh',
      title: '刷新提交历史',
      group: '仓库',
      run: () => repo.reload(),
    },
    {
      id: 'stash-create',
      title: '新建储藏 (stash)',
      group: '仓库',
      run: () => repo.createStash(`wip ${new Date().toLocaleString()}`),
    },
    {
      id: 'stash-pop',
      title: '弹出最近一次储藏',
      hint: repo.stashes[0]?.ref ?? '无',
      group: '仓库',
      run: () => repo.stashes[0] && repo.stashAction(repo.stashes[0].ref, 'pop'),
    },
    {
      id: 'snapshots',
      title: '查看安全网快照',
      group: '仓库',
      run: () => repo.loadSnapshots(),
    },
    {
      id: 'rebase',
      title: '交互式 rebase…',
      hint: '拖拽重排 / squash / drop',
      group: '仓库',
      run: () => repo.openRebase(),
    },
    {
      id: 'worktrees',
      title: '刷新工作树列表',
      group: '仓库',
      run: () => repo.loadWorktrees(),
    },
    {
      id: 'dashboard',
      title: '多仓库看板',
      hint: '所有项目的漂移 / 脏改动',
      group: '仓库',
      run: () => emit('dashboard'),
    },
    {
      id: 'health',
      title: '仓库体检',
      hint: '体积 / 大对象 / gc 建议',
      group: '仓库',
      run: () => repo.openHealth(),
    },
    {
      id: 'all',
      title: '查看全部提交',
      group: '仓库',
      run: () => repo.setTip(''),
    },
    ...(Object.keys(THEME_LABELS) as ThemeId[]).map((id) => ({
      id: `theme-${id}`,
      title: `切换主题：${THEME_LABELS[id]}`,
      hint: settings.theme === id ? '当前' : '',
      group: '外观',
      run: () => settings.setTheme(id),
    })),
  ]

  if (repo.selected) {
    const oid = repo.selected.oid
    list.push(
      {
        id: 'copy-sha',
        title: '复制当前提交 SHA',
        group: '提交',
        run: () => {
          navigator.clipboard?.writeText(oid)
          repo.notify('ok', '已复制 SHA')
        },
      },
      {
        id: 'copy-summary',
        title: '复制当前提交说明',
        group: '提交',
        run: () => {
          navigator.clipboard?.writeText(repo.selected?.summary ?? '')
          repo.notify('ok', '已复制提交说明')
        },
      },
    )
  }

  if (repo.originWeb) {
    list.push({
      id: 'open-web',
      title: '在远端网页打开仓库',
      hint: repo.originWeb,
      group: '仓库',
      run: () => window.open(repo.originWeb, '_blank'),
    })
  }

  for (const c of repo.commands) {
    list.push({
      id: `cmd-${c.id}`,
      title: c.title,
      hint: c.source === 'repo' ? '仓库插件' : '用户插件',
      group: '插件',
      run: () => repo.runCommand(c.id, c.title),
    })
  }

  return list
})

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return items.value
  return items.value.filter((i) => `${i.group} ${i.title} ${i.hint ?? ''}`.toLowerCase().includes(kw))
})

const groups = computed(() => {
  const map = new Map<string, Item[]>()
  for (const it of filtered.value) {
    const arr = map.get(it.group) || []
    arr.push(it)
    map.set(it.group, arr)
  }
  return [...map.entries()]
})

const flat = computed(() => groups.value.flatMap(([, arr]) => arr))

function pick(item: Item) {
  emit('close')
  item.run()
}

function move(delta: number) {
  if (!flat.value.length) return
  active.value = (active.value + delta + flat.value.length) % flat.value.length
}

onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[68vh] w-[600px] flex-col overflow-hidden" @keydown.esc="emit('close')">
      <div class="line-b flex items-center gap-2 px-4 py-3">
        <span class="text-[13px] t3">›</span>
        <input
          ref="input"
          v-model="q"
          placeholder="输入命令或搜索…"
          class="w-full bg-transparent text-[13px] t1 outline-none placeholder:t3"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="flat[active] && pick(flat[active])"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <div v-if="!filtered.length" class="px-4 py-6 text-center text-[12px] t3">没有匹配的命令</div>
        <template v-for="[group, list] in groups" :key="group">
          <div class="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider t3">{{ group }}</div>
          <button
            v-for="item in list"
            :key="item.id"
            class="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px]"
            :style="flat[active]?.id === item.id ? { background: 'var(--selected)' } : {}"
            @mouseenter="active = flat.findIndex((x) => x.id === item.id)"
            @click="pick(item)"
          >
            <span class="t1">{{ item.title }}</span>
            <span v-if="item.hint" class="ml-auto truncate text-[11px] t3">{{ item.hint }}</span>
          </button>
        </template>
      </div>

      <div class="line-t flex items-center gap-3 px-4 py-2 text-[11px] t3">
        <span>↑↓ 选择</span>
        <span>Enter 执行</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DENSITY_LABELS, THEME_LABELS, useSettingsStore } from '../stores/settings'
import type { Density, ThemeId } from '../stores/settings'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()

const themes = computed(() =>
  (Object.keys(THEME_LABELS) as ThemeId[]).map((id) => ({
    id,
    label: THEME_LABELS[id],
    active: settings.theme === id,
  })),
)

const densities = computed(() =>
  (Object.keys(DENSITY_LABELS) as Density[]).map((id) => ({
    id,
    label: DENSITY_LABELS[id],
    active: settings.density === id,
  })),
)

const shortcuts = [
  { keys: 'Ctrl + K', desc: '打开命令面板' },
  { keys: 'Ctrl + ,', desc: '打开设置' },
  { keys: 'Ctrl + F', desc: '搜索提交' },
  { keys: '↑ / ↓', desc: '切换提交' },
  { keys: 'Enter', desc: '查看变更文件 Diff' },
  { keys: 'Esc', desc: '关闭当前面板' },
]
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" @click.self="emit('close')">
    <div class="modal animate-pop flex max-h-[76vh] w-[640px] flex-col overflow-hidden">
      <header class="line-b flex items-center px-5 py-3">
        <h2 class="text-[14px] font-semibold t1">设置</h2>
        <button class="btn ml-auto" @click="emit('close')">关闭</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">主题</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="t in themes"
              :key="t.id"
              class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition"
              :style="{
                borderColor: t.active ? 'var(--accent)' : 'var(--border)',
                background: t.active ? 'var(--accent-weak)' : 'transparent',
              }"
              @click="settings.setTheme(t.id)"
            >
              <span
                class="h-6 w-6 shrink-0 rounded-full border"
                :style="{
                  background: `linear-gradient(135deg, ${t.id === 'light' ? '#ffffff' : '#12151d'} 50%, ${t.id === 'contrast' ? '#00e5ff' : t.id === 'midnight' ? '#38bdf8' : t.id === 'light' ? '#2563eb' : '#5b9dff'} 50%)`,
                  borderColor: 'var(--border-strong)',
                }"
              />
              <span class="text-[12px] t1">{{ t.label }}</span>
              <span v-if="t.active" class="ml-auto text-[11px] accent">✓</span>
            </button>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">列表密度</h3>
          <div class="flex gap-2">
            <button
              v-for="d in densities"
              :key="d.id"
              class="btn"
              :style="d.active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
              @click="settings.density = d.id; settings.save()"
            >
              {{ d.label }}
            </button>
          </div>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">显示</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">显示分支图</span>
            <input
              type="checkbox"
              v-model="settings.showGraph"
              class="h-4 w-4 accent-[var(--accent)]"
              @change="settings.save()"
            />
          </label>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">相对时间（15 hours ago）</span>
            <input
              type="checkbox"
              v-model="settings.relativeTime"
              class="h-4 w-4 accent-[var(--accent)]"
              @change="settings.save()"
            />
          </label>
        </section>

        <section class="mb-6">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">行为</h3>
          <label class="flex cursor-pointer items-center justify-between py-1.5">
            <span class="text-[12px] t2">危险操作需二次确认</span>
            <input
              type="checkbox"
              v-model="settings.confirmDangerous"
              class="h-4 w-4 accent-[var(--accent)]"
              @change="settings.save()"
            />
          </label>
        </section>

        <section>
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider t3">快捷键</h3>
          <div class="rounded-lg border" :style="{ borderColor: 'var(--border)' }">
            <div
              v-for="(s, i) in shortcuts"
              :key="s.keys"
              class="flex items-center justify-between px-3 py-1.5 text-[12px]"
              :class="i > 0 ? 'line-t' : ''"
            >
              <span class="t2">{{ s.desc }}</span>
              <kbd class="rounded border px-1.5 py-0.5 font-mono text-[11px] t3" :style="{ borderColor: 'var(--border)' }">
                {{ s.keys }}
              </kbd>
            </div>
          </div>
        </section>
      </div>

      <footer class="line-t flex items-center px-5 py-3">
        <span class="text-[11px] t3">设置保存在本地，随主题即时生效</span>
        <button class="btn ml-auto" @click="settings.reset()">恢复默认</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepoStore } from '../stores/repo'
import { pickFolder } from '../api/desktop'

const emit = defineEmits<{ (e: 'close'): void; (e: 'cloned', path: string): void }>()
const repo = useRepoStore()

const url = ref('')
const target = ref('')
const busy = ref(false)
const error = ref('')

const canClone = computed(
  () => /^(https?:\/\/|git@|ssh:\/\/)/.test(url.value.trim()) && !!target.value.trim() && !busy.value,
)

async function browse() {
  const dir = await pickFolder('选择克隆到的文件夹')
  if (dir) target.value = dir
}

async function doClone() {
  if (!canClone.value) return
  busy.value = true
  error.value = ''
  try {
    const path = await repo.cloneAndOpen(url.value.trim(), target.value.trim())
    if (path) {
      emit('cloned', path)
      emit('close')
    }
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[18vh]" @click.self="emit('close')">
    <div class="modal animate-pop w-[560px] overflow-hidden">
      <div class="line-b px-4 py-3">
        <div class="text-[13px] font-medium t1">克隆仓库</div>
        <div class="mt-0.5 text-[11px] t3">凭据由本机 git 处理，GitPanel 不保存任何账号信息</div>
      </div>

      <div class="space-y-3 px-4 py-4">
        <div>
          <label class="mb-1 block text-[11px] t3">仓库地址</label>
          <input
            v-model="url"
            class="field w-full px-2.5 py-1.5 font-mono text-[12px]"
            placeholder="https://github.com/owner/repo.git 或 git@github.com:owner/repo.git"
          />
        </div>
        <div>
          <label class="mb-1 block text-[11px] t3">目标文件夹（空目录或不存在）</label>
          <div class="flex gap-2">
            <input v-model="target" class="field min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[11px]" placeholder="D:\\code\\my-repo" />
            <button class="btn shrink-0" @click="browse">浏览…</button>
          </div>
        </div>
        <p v-if="error" class="text-[11px] text-rose-400">{{ error }}</p>
        <p class="text-[11px] leading-relaxed t3">
          首次从私有仓库克隆时，git 会在本机终端弹出登录验证；完成一次后由系统凭据管理器保存，GitPanel 不做任何存储。
        </p>
      </div>

      <div class="line-t flex justify-end gap-2 px-4 py-3">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!canClone" :style="!canClone ? { opacity: 0.45 } : {}" @click="doClone">
          {{ busy ? '克隆中…' : '开始克隆' }}
        </button>
      </div>
    </div>
  </div>
</template>

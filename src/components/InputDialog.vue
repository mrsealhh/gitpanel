<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    label?: string
    placeholder?: string
    value?: string
    confirmText?: string
  }>(),
  { label: '', placeholder: '', value: '', confirmText: '确定' },
)

const emit = defineEmits<{ (e: 'confirm', value: string): void; (e: 'close'): void }>()

const text = ref(props.value)
const input = ref<HTMLInputElement | null>(null)

function submit() {
  const v = text.value.trim()
  if (!v) return
  emit('confirm', v)
}

onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[24vh]" @click.self="emit('close')">
    <div class="modal animate-pop w-[440px] overflow-hidden">
      <div class="line-b px-4 py-3 text-[13px] font-medium t1">{{ title }}</div>
      <div class="px-4 py-4">
        <label v-if="label" class="mb-1.5 block text-[11px] t3">{{ label }}</label>
        <input
          ref="input"
          v-model="text"
          class="field w-full px-2.5 py-1.5 font-mono text-[12px]"
          :placeholder="placeholder"
          @keydown.enter="submit"
          @keydown.esc="emit('close')"
        />
      </div>
      <div class="line-t flex justify-end gap-2 px-4 py-3">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!text.trim()" @click="submit">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

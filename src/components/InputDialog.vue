<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    label?: string
    placeholder?: string
    value?: string
    confirmText?: string
    secondLabel?: string
    secondPlaceholder?: string
    secondValue?: string
  }>(),
  {
    label: '',
    placeholder: '',
    value: '',
    confirmText: '确定',
    secondLabel: '',
    secondPlaceholder: '',
    secondValue: '',
  },
)

const emit = defineEmits<{
  (e: 'confirm', value: string, second: string): void
  (e: 'close'): void
}>()

const text = ref(props.value)
const second = ref(props.secondValue)
const input = ref<HTMLInputElement | null>(null)

function submit() {
  const v = text.value.trim()
  if (!v) return
  emit('confirm', v, second.value.trim())
}

onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})
</script>

<template>
  <div class="overlay fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" @click.self="emit('close')">
    <div class="modal animate-pop w-[460px] overflow-hidden">
      <div class="line-b px-4 py-3 text-[13px] font-medium t1">{{ title }}</div>
      <div class="space-y-3 px-4 py-4">
        <div>
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
        <div v-if="secondLabel">
          <label class="mb-1.5 block text-[11px] t3">{{ secondLabel }}</label>
          <input
            v-model="second"
            class="field w-full px-2.5 py-1.5 text-[12px]"
            :placeholder="secondPlaceholder"
            @keydown.enter="submit"
            @keydown.esc="emit('close')"
          />
        </div>
      </div>
      <div class="line-t flex justify-end gap-2 px-4 py-3">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!text.trim()" @click="submit">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

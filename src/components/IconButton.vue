<script setup lang="ts">
import Icon from './Icon.vue'

withDefaults(
  defineProps<{
    name: string
    title: string
    size?: number
    active?: boolean
    disabled?: boolean
    danger?: boolean
    compact?: boolean
  }>(),
  { size: 16, active: false, disabled: false, danger: false, compact: false },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
</script>

<template>
  <button
    :title="title"
    :aria-label="title"
    :disabled="disabled"
    class="icon-btn"
    :class="{ 'is-active': active, 'is-danger': danger, 'is-compact': compact }"
    @click="emit('click', $event)"
  >
    <Icon :name="name" :size="size" />
  </button>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-dim);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon-btn.is-active {
  color: var(--accent);
  background: var(--accent-weak);
}
.icon-btn.is-danger:hover:not(:disabled) {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}
.icon-btn.is-compact {
  width: 22px;
  height: 20px;
  border-radius: 5px;
}
</style>

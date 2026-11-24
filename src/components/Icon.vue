<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'fetch'">
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </template>
    <template v-else-if="name === 'pull'">
      <path d="M12 4v14M6 12l6 6 6-6" />
    </template>
    <template v-else-if="name === 'push'">
      <path d="M12 20V6M6 12l6-6 6 6" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M21 12a9 9 0 1 1-3.2-6.9M21 4v5h-5" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2.4" />
      <circle cx="15" cy="17" r="2.4" />
    </template>
    <template v-else-if="name === 'theme'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'command'">
      <path d="M9 6a2.5 2.5 0 1 0 0 5h6a2.5 2.5 0 1 0 0-5M9 13a2.5 2.5 0 1 0 0 5h6a2.5 2.5 0 1 0 0-5" />
      <path d="M9 11h6v2H9z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'github'">
      <path
        fill="currentColor"
        stroke="none"
        d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.1c-3.2.7-3.88-1.4-3.88-1.4-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"
      />
    </template>
    <template v-else-if="name === 'minus'">
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'maximize'">
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </template>
    <template v-else-if="name === 'restore'">
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12M18 6L6 18" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </template>
    <template v-else-if="name === 'pin'">
      <path d="M9 3h6l-1.2 6.2L17 12H7l3.2-2.8L9 3zM12 12v9" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 4v10M7 10l5 5 5-5M5 20h14" />
    </template>
    <template v-else-if="name === 'alert'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.01" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </template>
    <template v-else-if="name === 'panel-left'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
    <template v-else-if="name === 'panel-right'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="M4 12.5l5 5L20 6.5" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
      <path d="M13 3v6h6" />
    </template>
    <template v-else-if="name === 'save'">
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h7V3M8 21v-7h8v7" />
    </template>
  </svg>
</template>

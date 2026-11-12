<script setup lang="ts">
import SiteButton from './SiteButton.vue'
defineProps<{ kind: 'loading' | 'empty' | 'error'; title: string; description?: string; retry?: boolean }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <section class="page-state" :class="`state-${kind}`" :aria-busy="kind === 'loading'" :role="kind === 'error' ? 'alert' : 'status'">
    <span v-if="kind === 'loading'" class="spinner" aria-hidden="true" />
    <h2>{{ title }}</h2>
    <p v-if="description" class="muted">{{ description }}</p>
    <SiteButton v-if="retry" @click="$emit('retry')">重新加载</SiteButton>
    <slot />
  </section>
</template>

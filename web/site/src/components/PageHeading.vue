<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <div class="page-heading">
    <div><h1>{{ title }}</h1><p v-if="description" class="muted">{{ description }}</p></div>
    <div v-if="$slots.actions" class="page-actions"><slot name="actions" /></div>
  </div>
</template>

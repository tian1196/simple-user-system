<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
withDefaults(defineProps<{
  to?: RouteLocationRaw
  variant?: 'primary' | 'secondary' | 'danger'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
}>(), { variant: 'secondary', type: 'button', disabled: false, loading: false })
</script>

<template>
  <RouterLink v-if="to" :to="to" class="site-button" :class="`is-${variant}`"><slot /></RouterLink>
  <button v-else :type="type" class="site-button" :class="`is-${variant}`" :disabled="disabled || loading" :aria-busy="loading">
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

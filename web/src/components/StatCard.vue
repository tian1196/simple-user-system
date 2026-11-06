<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    label: string
    value: string | number
    icon: Component
    hint?: string
    tone?: 'primary' | 'success' | 'warning' | 'violet'
  }>(),
  { tone: 'primary', hint: '' },
)
</script>

<template>
  <div class="stat-card" :class="`is-${tone}`">
    <div class="stat-card__icon">
      <el-icon :size="20"><component :is="icon" /></el-icon>
    </div>
    <div class="stat-card__body">
      <p class="stat-card__label">{{ label }}</p>
      <p class="stat-card__value">{{ value }}</p>
      <p v-if="hint" class="stat-card__hint">{{ hint }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.stat-card {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 20px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow-sm);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--app-shadow);
  }
}

.stat-card__icon {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  color: var(--app-primary);
  background: rgba(47, 107, 255, 0.1);
  border-radius: 12px;
}

.stat-card__body {
  min-width: 0;
}

.stat-card__label {
  margin: 0;
  color: var(--app-muted);
  font-size: 13px;
}

.stat-card__value {
  margin: 3px 0 0;
  color: var(--app-text);
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.stat-card__hint {
  margin: 5px 0 0;
  color: var(--app-muted);
  font-size: 12px;
}

.is-success .stat-card__icon {
  color: var(--app-success);
  background: rgba(18, 183, 106, 0.1);
}

.is-warning .stat-card__icon {
  color: var(--app-warning);
  background: rgba(247, 144, 9, 0.12);
}

.is-violet .stat-card__icon {
  color: #7a5af8;
  background: rgba(122, 90, 248, 0.1);
}
</style>

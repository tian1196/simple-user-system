<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import { useAppStore } from '@/stores/app'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'

const appStore = useAppStore()
const media = window.matchMedia('(max-width: 900px)')

function handleViewportChange(): void {
  appStore.syncViewport()
}

onMounted(() => {
  appStore.syncViewport()
  media.addEventListener('change', handleViewportChange)
})

onBeforeUnmount(() => {
  media.removeEventListener('change', handleViewportChange)
})
</script>

<template>
  <div
    class="app-layout"
    :class="{
      'is-collapsed': appStore.sidebarCollapsed && !appStore.isMobile,
      'is-mobile': appStore.isMobile,
      'is-mobile-open': appStore.mobileSidebarOpen,
    }"
  >
    <AppSidebar />

    <div
      v-if="appStore.isMobile && appStore.mobileSidebarOpen"
      class="sidebar-mask"
      @click="appStore.closeMobileSidebar()"
    />

    <div class="app-body">
      <AppHeader />
      <main class="app-main">
        <router-view v-slot="{ Component, route }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" :key="route.path" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  display: flex;
  width: 100%;
  min-height: 100%;
  background:
    radial-gradient(circle at 100% 0%, rgba(47, 107, 255, 0.05), transparent 34%), var(--app-bg);
}

.app-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  min-width: 0;
}

.sidebar-mask {
  position: fixed;
  z-index: 25;
  inset: 0;
  background: rgba(15, 23, 42, 0.44);
  backdrop-filter: blur(2px);
}
</style>

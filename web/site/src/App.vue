<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { router } from './router'
import PageState from './components/PageState.vue'
const failure = ref('')
router.onError((error: Error) => { failure.value = error.message })
onErrorCaptured((error: Error) => { failure.value = error.message; return false })
function retry() { window.location.reload() }
</script>
<template>
  <div v-if="failure" class="site-container page-container">
    <PageState kind="error" title="暂时无法加载" :description="failure" retry @retry="retry" />
  </div>
  <RouterView v-else v-slot="{ Component }">
    <Suspense><component :is="Component" /><template #fallback><PageState kind="loading" title="正在加载…" /></template></Suspense>
  </RouterView>
</template>

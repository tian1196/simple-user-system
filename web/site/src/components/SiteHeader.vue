<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'
import SiteButton from './SiteButton.vue'
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const open = ref(false)
const busy = ref(false)
const error = ref('')
watch(() => route.fullPath, () => { open.value = false; error.value = '' })
async function signOut() {
  busy.value = true
  error.value = ''
  try { await session.logout(); await router.push('/') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '退出失败，请重试' }
  finally { busy.value = false }
}
</script>
<template>
  <header class="site-header">
    <div class="site-container header-inner">
      <RouterLink class="brand" to="/" aria-label="设备台账首页"><img src="/favicon.svg" alt="" width="28" height="28" />设备台账</RouterLink>
      <button class="menu-toggle" :aria-expanded="open" aria-controls="site-navigation" @click="open = !open">{{ open ? '关闭菜单' : '菜单' }}</button>
      <nav id="site-navigation" class="site-navigation" :class="{ 'is-open': open }" aria-label="主导航" @keydown.esc="open = false">
        <RouterLink to="/demo" :aria-current="route.name === 'site-demo' ? 'page' : undefined">体验示例</RouterLink>
        <RouterLink to="/about" :aria-current="route.name === 'site-about' ? 'page' : undefined">关于项目</RouterLink>
        <RouterLink v-if="session.authenticated" to="/app/account">账户与数据</RouterLink>
        <SiteButton to="/app">我的设备</SiteButton>
        <SiteButton v-if="session.authenticated" :loading="busy" @click="signOut">退出登录</SiteButton>
      </nav>
    </div>
    <p v-if="error" class="header-error" role="alert">{{ error }}</p>
  </header>
</template>

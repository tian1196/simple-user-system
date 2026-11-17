<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'
import SiteButton from './SiteButton.vue'
import { useFeedbackDraft } from '../stores/feedbackDraft'
import { useRemindersStore } from '../stores/reminders'
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const reminders = useRemindersStore()
let owner: string | undefined
let timer: ReturnType<typeof setInterval> | undefined
function refreshReminders() {
  if (session.authenticated && document.visibilityState === 'visible' && !reminders.loading) void reminders.refresh()
}
watch(() => [session.user?.id, route.fullPath], () => {
  if (owner !== session.user?.id) { owner = session.user?.id; reminders.reset() }
  if (session.authenticated) void reminders.refresh()
  else reminders.reset()
}, { immediate: true })
onMounted(() => {
  window.addEventListener('focus', refreshReminders)
  document.addEventListener('visibilitychange', refreshReminders)
  timer = setInterval(refreshReminders, 60_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('focus', refreshReminders)
  document.removeEventListener('visibilitychange', refreshReminders)
})
const open = ref(false)
const busy = ref(false)
const error = ref('')
watch(() => route.fullPath, () => { open.value = false; error.value = '' })
async function signOut() {
  busy.value = true
  error.value = ''
  try { await session.logout(); useFeedbackDraft().reset(); await router.push('/') }
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
        <RouterLink v-if="session.authenticated" to="/app/reminders" :aria-current="route.path.startsWith('/app/reminders') ? 'page' : undefined" :title="reminders.error ? '待办数量尚未更新，进入待办页可重试' : '进入提醒窗口且未暂缓的事项'">待办<span class="reminder-badge">{{ reminders.data?.counts.all ?? '—' }}{{ reminders.error ? ' · 未更新' : '' }}</span></RouterLink>
        <RouterLink v-if="session.authenticated" to="/app/ledger" :aria-current="route.name === 'site-ledger' ? 'page' : undefined">记账</RouterLink>
        <RouterLink v-if="session.authenticated" to="/app/account">账户与数据</RouterLink>
        <RouterLink v-if="session.authenticated" :to="{ name: 'site-feedback', query: { from: route.path } }" :aria-current="route.path.startsWith('/app/feedback') ? 'page' : undefined">意见反馈</RouterLink>
        <SiteButton to="/app">我的设备</SiteButton>
        <SiteButton v-if="session.authenticated" :loading="busy" @click="signOut">退出登录</SiteButton>
      </nav>
    </div>
    <p v-if="error" class="header-error" role="alert">{{ error }}</p>
  </header>
</template>

import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { pinia } from './stores'
import { useSessionStore } from './stores/session'
import { onSessionExpired } from './api/request'
import './styles/tokens.css'
import './styles/base.css'

const app = createApp(App)
app.use(pinia)
app.use(router)

onSessionExpired(() => {
  useSessionStore(pinia).reset()
  const route = router.currentRoute.value
  if (route.meta.requiresUser) {
    void router.replace({ name: 'site-login', query: { redirect: route.fullPath } })
  }
})

app.mount('#app')

import { createApp } from 'vue'
import { ElLoading } from 'element-plus'

import 'element-plus/es/components/loading/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

import App from './App.vue'
import router from './router'
import { pinia } from './stores'
import { useAuthStore } from './stores/auth'
import { onUnauthorized } from './utils/auth-bus'

import '@/styles/index.scss'

const app = createApp(App)

app.use(pinia)
app.use(ElLoading)
app.use(router)

let redirecting = false

// 任意接口返回 401 时：清理本地登录态，记录来源地址并回到登录页
onUnauthorized(() => {
  const auth = useAuthStore(pinia)
  auth.reset()

  const current = router.currentRoute.value
  if (current.name === 'Login') return
  if (redirecting) return

  redirecting = true
  const redirect = current.fullPath && current.fullPath !== '/' ? current.fullPath : undefined

  void router.replace({ name: 'Login', query: redirect ? { redirect } : {} }).finally(() => {
    window.setTimeout(() => {
      redirecting = false
    }, 500)
  })
})

app.mount('#app')

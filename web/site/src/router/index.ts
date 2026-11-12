import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { pinia } from '../stores'
import { useSessionStore } from '../stores/session'

export const router = createRouter({
  history: createWebHistory('/'),
  routes,
  scrollBehavior: (to) => {
    if ((to.name === 'site-about' || to.name === 'site-privacy') && /^#(?:about|privacy)-[a-z-]+$/.test(to.hash)) {
      return { el: to.hash, top: 24 }
    }
    return { top: 0 }
  },
})

router.beforeEach(async to => {
  if (!to.meta.requiresUser) return true
  const session = useSessionStore(pinia)
  await session.restore()
  if (!session.authenticated) {
    return { name: 'site-login', query: { redirect: to.fullPath } }
  }
  return true
})

router.afterEach(to => {
  document.title = to.meta.title ? `${to.meta.title} · 设备台账` : '设备台账'
})

import { ElMessage } from 'element-plus'
import type { Router } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { pinia } from '@/stores'

/** 登录态、角色权限与页面标题 */
export function setupRouterGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const auth = useAuthStore(pinia)

    // 刷新页面后先用 Cookie 会话恢复身份；只探测一次
    if (!auth.initialized) {
      await auth.fetchProfile()
    }

    if (to.meta.public) {
      if (to.name === 'Login' && auth.isAuthenticated) {
        return { name: 'Dashboard' }
      }
      return true
    }

    if (!auth.isAuthenticated) {
      return {
        name: 'Login',
        query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {},
      }
    }

    if (to.meta.roles && auth.user && !to.meta.roles.includes(auth.user.role)) {
      ElMessage.warning('当前账号没有访问该页面的权限')
      return { name: 'Dashboard' }
    }

    return true
  })

  router.afterEach((to) => {
    const appTitle = import.meta.env.VITE_APP_TITLE || '设备台账管理后台'
    document.title = to.meta.title ? `${to.meta.title} · ${appTitle}` : appTitle
  })
}

import type { AdminRole } from '@/api/types'

export {}

declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标题与页面标题 */
    title?: string
    /** 未登录也可访问 */
    public?: boolean
    /** 允许访问的角色，不配置表示所有已登录管理员 */
    roles?: AdminRole[]
    /** 是否在侧边菜单隐藏 */
    hidden?: boolean
  }
}

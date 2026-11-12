import type { PermissionKey } from '@/constants/access'

export {}

declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标题与页面标题 */
    title?: string
    /** 未登录也可访问 */
    public?: boolean
    /** 访问该页需要的权限，不配置表示所有已登录后台账号 */
    permission?: PermissionKey
    /** 是否在侧边菜单隐藏 */
    hidden?: boolean
  }
}

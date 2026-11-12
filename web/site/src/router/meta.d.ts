import 'vue-router'
export {}
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresUser?: boolean
    siteGroup?: 'public' | 'auth' | 'member'
  }
}

import type { RouteRecordRaw } from 'vue-router'
import SiteLayout from '../layouts/SiteLayout.vue'

const placeholder = () => import('../views/PagePlaceholder.vue')

/** 已确认的页面入口；尚未开发的页面使用统一占位视图。 */
export const sitePages = [
  { path: '', name: 'site-home', title: '首页', group: 'public' },
  { path: 'demo', name: 'site-demo', title: '示例体验', group: 'public' },
  { path: 'login', name: 'site-login', title: '用户登录', group: 'auth' },
  { path: 'register', name: 'site-register', title: '邀请注册', group: 'auth' },
  { path: 'recover', name: 'site-recover', title: '账号恢复', group: 'auth' },
  { path: 'app', name: 'site-devices', title: '我的设备', group: 'member' },
  { path: 'app/devices/new', name: 'site-device-new', title: '新增设备', group: 'member' },
  { path: 'app/devices/:id', name: 'site-device-detail', title: '设备详情', group: 'member' },
  { path: 'app/account', name: 'site-account', title: '账户与数据', group: 'member' },
  { path: 'about', name: 'site-about', title: '关于项目', group: 'public' },
  { path: 'privacy', name: 'site-privacy', title: '隐私说明', group: 'public' },
] as const

export const routes: RouteRecordRaw[] = [{
  path: '/',
  component: SiteLayout,
  children: [
    ...sitePages.map(page => ({
      path: page.path,
      name: page.name,
      component: page.name === 'site-home'
        ? () => import('../views/HomeView.vue')
        : page.name === 'site-demo' ? () => import('../views/DemoView.vue')
        : page.name === 'site-devices' ? () => import('../views/DevicesView.vue')
        : page.name === 'site-device-new' ? () => import('../views/NewDeviceView.vue')
        : page.name === 'site-device-detail' ? () => import('../views/DeviceDetailView.vue')
        : page.name === 'site-account' ? () => import('../views/AccountView.vue')
        : (page.name === 'site-about' || page.name === 'site-privacy') ? () => import('../views/InformationView.vue')
        : page.group === 'auth' ? () => import('../views/AuthView.vue') : placeholder,
      meta: { title: page.title, requiresUser: page.group === 'member', siteGroup: page.group },
    })),
    {
      path: ':pathMatch(.*)*',
      name: 'site-not-found',
      component: () => import('../views/NotFound.vue'),
      meta: { title: '页面不存在' },
    },
  ],
}]

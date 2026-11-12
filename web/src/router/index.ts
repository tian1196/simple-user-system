import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import AdminLayout from '@/layout/index.vue'

import { setupRouterGuard } from './guard'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AdminLayout,
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '运营概览', permission: 'overview.read' },
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/users/index.vue'),
        meta: { title: '账号管理', permission: 'users.read' },
      },
      {
        // 兼容旧后台 /admin/users/:id 深链接，页面会直接打开详情抽屉
        path: 'users/:id',
        name: 'UserDetail',
        component: () => import('@/views/users/index.vue'),
        meta: { title: '账号详情', permission: 'users.read' },
      },
      {
        path: 'invites',
        name: 'Invites',
        component: () => import('@/views/invites/index.vue'),
        meta: { title: '邀请管理', permission: 'invites.manage' },
      },
      {
        path: 'accounts',
        name: 'Accounts',
        component: () => import('@/views/accounts/index.vue'),
        meta: { title: '系统账号', permission: 'accounts.manage' },
      },
      {
        path: 'permissions',
        name: 'Permissions',
        component: () => import('@/views/permissions/index.vue'),
        meta: { title: '权限管理', permission: 'permissions.read' },
      },
      {
        path: 'saas',
        name: 'Saas',
        component: () => import('@/views/saas/index.vue'),
        meta: { title: '套餐工作区', permission: 'saas.manage' },
      },
      {
        path: 'ledger',
        name: 'Ledger',
        component: () => import('@/views/ledger/index.vue'),
        meta: { title: '消费记账', permission: 'ledger.read' },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/settings/index.vue'),
        meta: { title: '运营配置', permission: 'settings.manage' },
      },
      {
        path: 'audit',
        name: 'Audit',
        component: () => import('@/views/audit/index.vue'),
        meta: { title: '操作审计', permission: 'audit.read' },
      },
    ],
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '管理员登录', public: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '页面不存在', public: true },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

setupRouterGuard(router)

export default router

<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Avatar,
  Document,
  Notebook,
  Odometer,
  Setting,
  Ticket,
  User,
} from '@element-plus/icons-vue'

import type { AdminRole } from '@/api/types'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

interface MenuEntry {
  path: string
  title: string
  icon: Component
  roles: AdminRole[]
}

const menu: MenuEntry[] = [
  { path: '/dashboard', title: '运营概览', icon: Odometer, roles: ['owner', 'operator'] },
  { path: '/users', title: '账号管理', icon: User, roles: ['owner', 'operator'] },
  { path: '/invites', title: '邀请管理', icon: Ticket, roles: ['owner', 'operator'] },
  { path: '/accounts', title: '系统账号', icon: Avatar, roles: ['owner'] },
  { path: '/settings', title: '运营配置', icon: Setting, roles: ['owner'] },
  { path: '/audit', title: '操作审计', icon: Document, roles: ['owner'] },
]

const route = useRoute()
const auth = useAuthStore()
const appStore = useAppStore()

const collapsed = computed(() => appStore.sidebarCollapsed && !appStore.isMobile)
const visibleMenu = computed(() => {
  const role = auth.user?.role
  if (!role) return []
  return menu.filter((item) => item.roles.includes(role))
})

// 子页面（如后续扩展详情页）仍保持父级菜单高亮
const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/users')) return '/users'
  if (path.startsWith('/invites')) return '/invites'
  return path
})

function handleSelect(): void {
  if (appStore.isMobile) appStore.closeMobileSidebar()
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{
      'is-collapsed': collapsed,
      'is-mobile-open': appStore.isMobile && appStore.mobileSidebarOpen,
    }"
  >
    <div class="brand">
      <div class="brand__mark">
        <el-icon :size="19"><Notebook /></el-icon>
      </div>
      <div v-if="!collapsed" class="brand__text">
        <strong>设备台账</strong>
        <span>ADMIN CONSOLE</span>
      </div>
    </div>

    <el-scrollbar class="sidebar__scroll">
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        class="sidebar__menu"
        @select="handleSelect"
      >
        <el-menu-item v-for="item in visibleMenu" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-scrollbar>

    <div class="sidebar__footer">
      <span v-if="!collapsed">v0.1.0 · 运营端</span>
      <span v-else class="sidebar__version">0.1</span>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  position: relative;
  z-index: 30;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: 232px;
  background:
    radial-gradient(circle at 20% 0%, rgba(47, 107, 255, 0.28), transparent 42%), var(--app-sidebar);
  transition: width 0.22s ease;
}

.brand {
  display: flex;
  gap: 11px;
  align-items: center;
  height: 64px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.brand__mark {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, #4f8bff, #1e4fd8);
  border-radius: 10px;
  box-shadow: 0 6px 16px rgba(47, 107, 255, 0.4);
}

.brand__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;

  strong {
    overflow: hidden;
    color: #f8fafc;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    margin-top: 2px;
    color: #7f8ea8;
    font-size: 9px;
    letter-spacing: 0.16em;
    white-space: nowrap;
  }
}

.sidebar__scroll {
  flex: 1;
  min-height: 0;
}

.sidebar__menu {
  padding: 12px 10px;
  background: transparent;
  border-right: 0;

  :deep(.el-menu-item) {
    height: 46px;
    margin: 4px 0;
    color: #a9b6ca;
    border-radius: 10px;
  }

  :deep(.el-menu-item .el-icon) {
    font-size: 18px;
  }

  :deep(.el-menu-item:hover) {
    color: #fff;
    background: rgba(255, 255, 255, 0.07);
  }

  :deep(.el-menu-item.is-active) {
    color: #fff;
    background: linear-gradient(100deg, rgba(47, 107, 255, 0.98), rgba(47, 107, 255, 0.7));
    box-shadow: 0 8px 18px rgba(47, 107, 255, 0.28);
  }

  :deep(.el-menu--collapse .el-menu-item) {
    justify-content: center;
    padding: 0 !important;
  }

  :deep(.el-menu-tooltip__trigger) {
    padding: 0 !important;
  }
}

.sidebar__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  color: #66768f;
  font-size: 11px;
  letter-spacing: 0.08em;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar__version {
  font-size: 10px;
}

.sidebar.is-collapsed {
  width: 64px;
}

.sidebar.is-collapsed .brand {
  justify-content: center;
  padding: 0;
}

.sidebar.is-collapsed .sidebar__menu {
  padding: 12px 8px;
}

@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 232px;
    transform: translateX(-100%);
    transition: transform 0.24s ease;
  }

  .sidebar.is-mobile-open {
    box-shadow: 24px 0 60px rgba(15, 23, 42, 0.28);
    transform: none;
  }
}
</style>

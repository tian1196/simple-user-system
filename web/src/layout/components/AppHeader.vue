<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowRight, Expand, Fold, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { initialOf } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const appStore = useAppStore()

const collapsed = computed(() => appStore.sidebarCollapsed && !appStore.isMobile)
const currentTitle = computed(() => route.meta.title || '管理后台')

async function handleLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm('退出后需要重新输入账号、密码和动态验证码。', '退出登录', {
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  await auth.logout()
  ElMessage.success('已退出登录')
  await router.replace({ name: 'Login' })
}

function handleCommand(command: string): void {
  if (command === 'logout') void handleLogout()
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__left">
      <button
        class="icon-button"
        type="button"
        :aria-label="collapsed ? '展开菜单' : '收起菜单'"
        @click="appStore.toggleSidebar()"
      >
        <el-icon :size="18">
          <Expand v-if="collapsed" />
          <Fold v-else />
        </el-icon>
      </button>

      <div class="crumbs">
        <span class="crumbs__root">管理后台</span>
        <el-icon class="crumbs__sep" :size="12"><ArrowRight /></el-icon>
        <span class="crumbs__current">{{ currentTitle }}</span>
      </div>
    </div>

    <div class="app-header__right">
      <el-tag size="small" effect="plain" class="env-tag">运营端</el-tag>

      <el-dropdown trigger="click" @command="handleCommand">
        <button class="user-trigger" type="button">
          <el-avatar :size="30" class="user-avatar">{{ initialOf(auth.displayName) }}</el-avatar>
          <span class="user-meta">
            <strong>{{ auth.displayName }}</strong>
            <span>{{ auth.roleLabel }}</span>
          </span>
          <el-icon class="user-arrow" :size="12"><ArrowDown /></el-icon>
        </button>

        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>角色：{{ auth.roleLabel }}</el-dropdown-item>
            <el-dropdown-item divided command="logout">
              <el-icon><SwitchButton /></el-icon>
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>

<style scoped lang="scss">
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 28px;
  background: rgba(255, 255, 255, 0.88);
  border-bottom: 1px solid var(--app-border);
  backdrop-filter: blur(12px);
}

.app-header__left,
.app-header__right {
  display: flex;
  gap: 14px;
  align-items: center;
  min-width: 0;
}

.icon-button {
  display: grid;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--app-text-secondary);
  background: transparent;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  place-items: center;
  transition: background 0.15s ease;

  &:hover {
    background: #f1f4fa;
  }
}

.crumbs {
  display: flex;
  gap: 7px;
  align-items: center;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
}

.crumbs__root {
  color: var(--app-muted);
}

.crumbs__sep {
  color: #c0c7d4;
}

.crumbs__current {
  overflow: hidden;
  color: var(--app-text);
  font-weight: 600;
  text-overflow: ellipsis;
}

.env-tag {
  color: #475467;
  background: #f8fafc;
  border-color: #e4e7ec;
}

.user-trigger {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 4px 8px 4px 4px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: #f1f4fa;
  }
}

.user-avatar {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #4f8bff, #2456d6);
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.25;

  strong {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  span {
    color: var(--app-muted);
    font-size: 10.5px;
  }
}

.user-arrow {
  color: var(--app-muted);
}

@media (max-width: 900px) {
  .app-header {
    padding: 0 16px;
  }

  .env-tag,
  .user-meta {
    display: none;
  }

  .crumbs__root,
  .crumbs__sep {
    display: none;
  }
}
</style>

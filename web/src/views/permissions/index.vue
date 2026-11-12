<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { getAdminAccounts, updateAdminAccount } from '@/api/accounts'
import { getPermissionCatalog } from '@/api/permissions'
import { ApiError } from '@/api/request'
import type { AdminAccountItem, PermissionCatalog, RoleItem } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { ROLE_LABELS, STAFF_ROLES, roleTagType, type StaffRole } from '@/constants/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const savingId = ref<string | null>(null)
const catalog = ref<PermissionCatalog | null>(null)
const accounts = ref<AdminAccountItem[]>([])

const canAssign = computed(() => auth.can('accounts.manage'))
const activeAdminCount = computed(
  () => accounts.value.filter((account) => account.role === 'admin' && account.status === 'active').length,
)

const permissionNames = computed(() => {
  return new Map(catalog.value?.permissions.map((item) => [item.key, item.name]) || [])
})

function permissionName(key: RoleItem['permissions'][number]): string {
  return permissionNames.value.get(key) || key
}

function isCurrent(role: RoleItem): boolean {
  return auth.user?.role === role.key
}

function roleLocked(account: AdminAccountItem): boolean {
  if (account.id === auth.user?.id) return true
  return account.role === 'admin' && account.status === 'active' && activeAdminCount.value <= 1
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const tasks: [Promise<PermissionCatalog>, Promise<{ items: AdminAccountItem[] }> | Promise<null>] = [
      getPermissionCatalog(),
      canAssign.value ? getAdminAccounts() : Promise.resolve(null),
    ]
    const [nextCatalog, nextAccounts] = await Promise.all(tasks)
    catalog.value = nextCatalog
    accounts.value = nextAccounts?.items || []
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

async function changeRole(account: AdminAccountItem, role: StaffRole): Promise<void> {
  if (role === account.role || roleLocked(account)) return
  try {
    await ElMessageBox.confirm(
      `把「${account.username}」从「${ROLE_LABELS[account.role]}」改为「${ROLE_LABELS[role]}」？登录权限会立刻按新角色生效。`,
      '调整角色',
      { type: 'warning', confirmButtonText: '确认调整', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  savingId.value = account.id
  try {
    const updated = await updateAdminAccount(account.id, {
      role,
      status: account.status,
      version: account.version,
    })
    const index = accounts.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) accounts.value[index] = updated
    ElMessage.success('角色已更新')
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  } finally {
    savingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="权限管理"
      description="管理员是最高权限。普通用户只能使用自己的台账，第三方只能看运营汇总。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div v-loading="loading" class="role-grid">
      <article
        v-for="role in catalog?.roles || []"
        :key="role.key"
        class="panel role-card"
        :class="{ 'is-current': isCurrent(role), 'is-top': role.key === 'admin' }"
      >
        <header class="role-card__head">
          <div>
            <h2>{{ role.name }}</h2>
            <span class="mono">{{ role.key }}</span>
          </div>
          <el-tag v-if="isCurrent(role)" type="success" effect="light" size="small" round>
            当前角色
          </el-tag>
          <el-tag v-else-if="role.key === 'admin'" type="warning" effect="light" size="small" round>
            最高权限
          </el-tag>
          <el-tag v-else-if="!role.staff" type="info" effect="plain" size="small" round>
            不进后台
          </el-tag>
        </header>
        <p>{{ role.description }}</p>
        <div class="role-card__perms">
          <el-tag
            v-for="key in role.permissions"
            :key="key"
            size="small"
            effect="plain"
            round
          >
            {{ permissionName(key) }}
          </el-tag>
          <span v-if="!role.permissions.length" class="role-card__empty">没有后台权限</span>
        </div>
      </article>
    </div>

    <section v-if="canAssign" class="panel assign-panel">
      <div class="assign-panel__head">
        <div>
          <h2>分配角色</h2>
          <p>只能调整后台账号。普通用户通过邀请注册，不在这里改成管理员。</p>
        </div>
      </div>

      <el-table :data="accounts" row-key="id">
        <el-table-column label="账号" min-width="180">
          <template #default="{ row }">
            <strong>{{ row.username }}</strong>
            <el-tag
              v-if="row.id === auth.user?.id"
              class="self-tag"
              size="small"
              type="info"
              effect="plain"
              round
            >
              当前账号
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <el-select
              :model-value="row.role"
              :disabled="roleLocked(row as AdminAccountItem) || savingId === row.id"
              @change="(role) => changeRole(row as AdminAccountItem, role as StaffRole)"
            >
              <el-option
                v-for="role in STAFF_ROLES"
                :key="role"
                :label="ROLE_LABELS[role]"
                :value="role"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'active' ? 'success' : 'danger'"
              effect="light"
              size="small"
              round
            >
              {{ row.status === 'active' ? '正常' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">
            <span class="assign-note">
              <el-tag :type="roleTagType(row.role)" effect="plain" size="small" round>
                {{ ROLE_LABELS[row.role as StaffRole] }}
              </el-tag>
              {{ roleLocked(row as AdminAccountItem) ? '不能修改当前账号或最后一名管理员' : '调整后按新角色限制菜单和接口' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped lang="scss">
.role-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  min-height: 120px;
}

.role-card {
  padding: 16px 16px 14px;

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
  }

  p {
    min-height: 44px;
    margin: 10px 0 12px;
    color: var(--app-text-secondary);
    font-size: 12.5px;
    line-height: 1.6;
  }
}

.role-card.is-current {
  border-color: rgba(47, 107, 255, 0.45);
}

.role-card.is-top {
  background:
    linear-gradient(180deg, rgba(255, 196, 92, 0.16), transparent 42%), var(--app-surface);
}

.role-card__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;

  .mono {
    color: var(--app-muted);
    font-size: 11px;
  }
}

.role-card__perms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.role-card__empty {
  color: var(--app-muted);
  font-size: 12px;
}

.assign-panel {
  margin-top: 16px;
  padding: 16px 16px 8px;
}

.assign-panel__head {
  margin-bottom: 8px;

  h2 {
    margin: 0 0 4px;
    font-size: 15px;
  }

  p {
    margin: 0;
    color: var(--app-muted);
    font-size: 12px;
  }
}

.self-tag {
  margin-left: 8px;
}

.assign-note {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--app-text-secondary);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .role-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .role-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { getUsers, updateUserStatus } from '@/api/users'
import { ApiError } from '@/api/request'
import type { AdminUserItem, UserStatus, UserStatusFilter } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { useAppStore } from '@/stores/app'
import { formatDateTime, initialOf, shortId } from '@/utils/format'
import UserDetailDrawer from './components/UserDetailDrawer.vue'

const appStore = useAppStore()
const route = useRoute()
const router = useRouter()

const loading = ref(false)
const users = ref<AdminUserItem[]>([])
const page = ref(1)
const pageSize = ref(10)
const filters = reactive<{ q: string; status: UserStatusFilter }>({
  q: '',
  status: 'all',
})

const detailVisible = ref(false)
const selectedUserId = ref<string | null>(null)

const pagedUsers = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return users.value.slice(start, start + pageSize.value)
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getUsers({ q: filters.q, status: filters.status })
    users.value = data.items
    const maxPage = Math.max(1, Math.ceil(data.items.length / pageSize.value))
    if (page.value > maxPage) page.value = maxPage
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  filters.q = ''
  filters.status = 'all'
  page.value = 1
  void load()
}

function handleSizeChange(): void {
  page.value = 1
}

function openDetail(user: AdminUserItem): void {
  selectedUserId.value = user.id
  detailVisible.value = true
}

async function toggleStatus(user: AdminUserItem): Promise<void> {
  const target: UserStatus = user.status === 'active' ? 'disabled' : 'active'
  const isDisable = target === 'disabled'
  const actionText = isDisable ? '停用' : '恢复'

  try {
    await ElMessageBox.confirm(
      isDisable
        ? `停用「${user.username}」后，该用户的全部登录会话会立即失效。`
        : `恢复「${user.username}」的登录权限？`,
      `${actionText}账号`,
      {
        type: isDisable ? 'warning' : 'info',
        confirmButtonText: actionText,
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  try {
    const updated = await updateUserStatus(user.id, target, user.version)
    const index = users.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) users.value[index] = updated
    if (detailVisible.value && selectedUserId.value === updated.id) detailVisible.value = false
    ElMessage.success(`已${actionText}账号`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  }
}

function lastLoginText(value: number | null): string {
  return value ? formatDateTime(value) : '从未登录'
}

watch(detailVisible, (open) => {
  if (!open && route.name === 'UserDetail') {
    void router.replace({ name: 'Users' })
  }
})

onMounted(async () => {
  await load()
  const id = route.params.id
  if (typeof id === 'string' && id) {
    selectedUserId.value = id
    detailVisible.value = true
  }
})
</script>

<template>
  <div class="page">
    <PageHeader
      title="账号管理"
      description="只展示普通账号的元数据；后台不提供查看用户私人设备与维护记录的入口。"
    />

    <section class="panel table-panel">
      <div class="table-panel__header">
        <div class="toolbar">
          <el-input
            v-model="filters.q"
            placeholder="搜索用户名"
            :prefix-icon="Search"
            clearable
            class="search-input"
            @keyup.enter="search"
            @clear="search"
          />
          <el-select v-model="filters.status" class="status-select" @change="search">
            <el-option label="全部状态" value="all" />
            <el-option label="正常" value="active" />
            <el-option label="已停用" value="disabled" />
          </el-select>
          <el-button type="primary" :icon="Search" @click="search">查询</el-button>
          <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
        </div>
        <span class="account-count">共 {{ users.length }} 个普通账号</span>
      </div>

      <el-table
        v-loading="loading"
        :data="pagedUsers"
        row-key="id"
        class="account-table"
        :header-cell-style="{ height: '46px' }"
      >
        <el-table-column label="账号" :min-width="appStore.isMobile ? 132 : 210">
          <template #default="{ row }">
            <button type="button" class="account-cell" @click="openDetail(row as AdminUserItem)">
              <el-avatar :size="34" class="account-avatar">{{ initialOf(row.username) }}</el-avatar>
              <span class="account-cell__text">
                <strong>{{ row.username }}</strong>
                <small class="mono">#{{ shortId(row.id) }}</small>
              </span>
            </button>
          </template>
        </el-table-column>

        <el-table-column label="状态" :width="appStore.isMobile ? 76 : 100">
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

        <el-table-column v-if="!appStore.isMobile" label="设备数" width="96" align="center">
          <template #default="{ row }">
            <span class="device-count">{{ row.device_count }}</span>
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="注册时间" width="168">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="最近登录" width="168">
          <template #default="{ row }">{{ lastLoginText(row.last_login_at) }}</template>
        </el-table-column>

        <el-table-column
          label="操作"
          :width="appStore.isMobile ? 112 : 150"
          :fixed="appStore.isMobile ? false : 'right'"
        >
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row as AdminUserItem)"
              >详情</el-button
            >
            <el-button
              link
              :type="row.status === 'active' ? 'danger' : 'success'"
              @click="toggleStatus(row as AdminUserItem)"
            >
              {{ row.status === 'active' ? '停用' : '恢复' }}
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <div class="empty-hint">
            <p>没有匹配的账号</p>
            <span>调整关键词或状态筛选后再试。</span>
          </div>
        </template>
      </el-table>

      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="users.length"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="handleSizeChange"
        />
      </div>
    </section>

    <UserDetailDrawer v-model="detailVisible" :user-id="selectedUserId" @changed="load" />
  </div>
</template>

<style scoped lang="scss">
.search-input {
  width: 220px;
}

.status-select {
  width: 132px;
}

.account-count {
  color: var(--app-muted);
  font-size: 12px;
}

.account-table {
  width: 100%;
}

.account-cell {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 4px 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.account-avatar {
  flex: 0 0 auto;
  color: #3f5c8f;
  font-size: 13px;
  font-weight: 600;
  background: #e9effb;
}

.account-cell__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;

  strong {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  small {
    color: #a3adbd;
    font-size: 10.5px;
  }
}

.device-count {
  display: inline-grid;
  min-width: 26px;
  height: 22px;
  padding: 0 7px;
  color: var(--app-text-secondary);
  font-size: 12px;
  background: #f4f6fa;
  border-radius: 6px;
  place-items: center;
}

.empty-hint {
  p {
    margin: 0 0 4px;
    color: var(--app-text-secondary);
    font-size: 13px;
    font-weight: 500;
  }

  span {
    font-size: 11.5px;
  }
}

@media (max-width: 680px) {
  .search-input {
    width: 100%;
  }

  .status-select {
    width: calc(50% - 6px);
  }

  .table-panel__header {
    align-items: stretch;
  }

  .toolbar {
    width: 100%;
  }

  .account-count {
    align-self: flex-end;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'

import { getAuditLogs } from '@/api/audit'
import type { AuditLogItem } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { useAppStore } from '@/stores/app'
import { formatCompactDateTime, formatDateTime, shortId } from '@/utils/format'

type ResultFilter = 'all' | 'success' | 'failure'

const ACTION_LABELS: Record<string, string> = {
  login_success: '登录成功',
  login_failure: '登录失败',
  register: '邀请注册',
  recover: '恢复码重置密码',
  password_change: '修改密码',
  account_delete: '注销账户',
  export_account: '导出账户数据',
  user_status_change: '账号状态变更',
  invite_create: '创建邀请',
  invite_revoke: '撤销邀请',
  settings_update: '修改运营配置',
  admin_create: '创建管理员账号',
  admin_update: '修改管理员账号',
  admin_password_reset: '重置管理员密码',
  admin_delete: '删除管理员账号',
}

const TARGET_LABELS: Record<string, string> = {
  user: '账号',
  invite: '邀请',
  setting: '配置',
  admin: '管理员',
}

const appStore = useAppStore()

const loading = ref(false)
const logs = ref<AuditLogItem[]>([])
const keyword = ref('')
const actionFilter = ref('all')
const resultFilter = ref<ResultFilter>('all')

const filteredLogs = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return logs.value.filter((log) => {
    if (resultFilter.value !== 'all' && log.result !== resultFilter.value) return false
    if (actionFilter.value !== 'all' && log.action !== actionFilter.value) return false
    if (!query) return true
    return [log.actor, log.action, actionLabel(log.action), log.target_type, log.target_id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

const actionOptions = computed(() => {
  const values = new Set(logs.value.map((log) => log.action))
  if (actionFilter.value !== 'all') values.add(actionFilter.value)
  return [...values].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), 'zh-CN'))
})

const successCount = computed(() => logs.value.filter((log) => log.result === 'success').length)

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getAuditLogs()
    logs.value = data.items
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action
}

function targetLabel(log: AuditLogItem): string {
  const type = log.target_type ? TARGET_LABELS[log.target_type] || log.target_type : '—'
  if (!log.target_id) return type
  return `${type} · ${shortId(log.target_id)}`
}

function resetFilters(): void {
  keyword.value = ''
  actionFilter.value = 'all'
  resultFilter.value = 'all'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="操作审计"
      description="仅展示最近 50 条关键操作；不记录密码、恢复码、设备备注等敏感内容。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <section class="panel audit-panel">
      <div class="audit-toolbar">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="搜索操作者、动作或对象"
            :prefix-icon="Search"
            clearable
            class="search-input"
          />
          <el-select v-model="actionFilter" class="filter-select">
            <el-option label="全部动作" value="all" />
            <el-option
              v-for="action in actionOptions"
              :key="action"
              :label="actionLabel(action)"
              :value="action"
            />
          </el-select>
          <el-select v-model="resultFilter" class="result-select">
            <el-option label="全部结果" value="all" />
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failure" />
          </el-select>
          <el-button @click="resetFilters">重置</el-button>
        </div>

        <div class="audit-stats">
          <span
            ><strong>{{ logs.length }}</strong> 条记录</span
          >
          <span class="audit-stats__divider" />
          <span
            ><strong class="is-green">{{ successCount }}</strong> 条成功</span
          >
        </div>
      </div>

      <el-table v-loading="loading" :data="filteredLogs" row-key="created_at" class="audit-table">
        <el-table-column label="时间" :width="appStore.isMobile ? 124 : 172">
          <template #default="{ row }">
            {{
              appStore.isMobile
                ? formatCompactDateTime(row.created_at)
                : formatDateTime(row.created_at)
            }}
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="操作者" width="140">
          <template #default="{ row }">
            <span :class="{ muted: !row.actor }">{{ row.actor || '系统' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="动作" :min-width="appStore.isMobile ? 100 : 150">
          <template #default="{ row }">
            <el-tooltip :content="row.action" placement="top">
              <span class="action-label">{{ actionLabel(row.action) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="对象" min-width="170">
          <template #default="{ row }">
            <span class="mono target-label">{{ targetLabel(row as AuditLogItem) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="结果" :width="appStore.isMobile ? 84 : 100">
          <template #default="{ row }">
            <el-tag
              :type="row.result === 'success' ? 'success' : 'danger'"
              effect="light"
              size="small"
              round
            >
              {{ row.result === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>

        <template #empty>
          <div class="empty-hint">
            <p>{{ logs.length ? '没有匹配的审计记录' : '暂无审计记录' }}</p>
            <span v-if="logs.length">调整关键词或筛选条件后再试。</span>
            <span v-else>登录、修改账号状态、创建邀请等操作会记录在这里。</span>
          </div>
        </template>
      </el-table>

      <div class="audit-footer">
        <span>显示 {{ filteredLogs.length }} / {{ logs.length }} 条</span>
        <span>审计写入为服务端行为，前端只读。</span>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.audit-panel {
  overflow: hidden;
}

.audit-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--app-border);
}

.search-input {
  width: 230px;
}

.filter-select {
  width: 150px;
}

.result-select {
  width: 124px;
}

.audit-stats {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--app-muted);
  font-size: 12px;

  strong {
    color: var(--app-text);
    font-weight: 650;
  }

  strong.is-green {
    color: var(--app-success);
  }
}

.audit-stats__divider {
  width: 1px;
  height: 12px;
  background: var(--app-border);
}

.action-label {
  color: var(--app-text);
  font-size: 12.5px;
  cursor: default;
}

.target-label {
  color: #667085;
  font-size: 11.5px;
}

.audit-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  padding: 14px 20px;
  color: #a2abba;
  font-size: 11px;
  border-top: 1px solid #f1f4f9;
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
  .search-input,
  .filter-select,
  .result-select {
    width: 100%;
  }

  .audit-toolbar {
    align-items: stretch;
  }

  .audit-stats {
    justify-content: flex-end;
  }
}
</style>

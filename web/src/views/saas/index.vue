<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { getSaas, updateTenant } from '@/api/saas'
import { ApiError } from '@/api/request'
import type { SaasOverview, SaasPlan, SaasStatus, SaasTenant } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'

const STATUS_LABELS: Record<SaasStatus, string> = {
  trialing: '试用',
  active: '有效',
  past_due: '欠费',
  canceled: '已停用',
}

const loading = ref(false)
const savingId = ref<string | null>(null)
const overview = ref<SaasOverview | null>(null)
const drafts = reactive<
  Record<string, { plan: SaasPlan['key']; status: SaasStatus; seat_limit: number; device_limit: number }>
>({})

function syncDrafts(tenants: SaasTenant[]): void {
  for (const key of Object.keys(drafts)) delete drafts[key]
  for (const tenant of tenants) {
    drafts[tenant.id] = {
      plan: tenant.plan,
      status: tenant.status,
      seat_limit: tenant.seat_limit,
      device_limit: tenant.device_limit,
    }
  }
}

function dirty(tenant: SaasTenant): boolean {
  const draft = drafts[tenant.id]
  if (!draft) return false
  return (
    draft.plan !== tenant.plan ||
    draft.status !== tenant.status ||
    draft.seat_limit !== tenant.seat_limit ||
    draft.device_limit !== tenant.device_limit
  )
}

async function load(): Promise<void> {
  loading.value = true
  try {
    overview.value = await getSaas()
    syncDrafts(overview.value.tenants)
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

async function save(tenant: SaasTenant): Promise<void> {
  const draft = drafts[tenant.id]
  if (!draft || !dirty(tenant)) return
  if (!Number.isInteger(draft.seat_limit) || !Number.isInteger(draft.device_limit)) {
    ElMessage.warning('席位和每账号设备数都要填整数')
    return
  }
  if (tenant.member_count > draft.seat_limit) {
    try {
      await ElMessageBox.confirm(
        `「${tenant.name}」现有 ${tenant.member_count} 名成员，新席位是 ${draft.seat_limit}。已有成员会保留，但不能再注册新成员。`,
        '席位将小于现有成员',
        { type: 'warning', confirmButtonText: '仍然调整', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }

  savingId.value = tenant.id
  try {
    const updated = await updateTenant(tenant.id, {
      plan: draft.plan,
      status: draft.status,
      seat_limit: draft.seat_limit,
      device_limit: draft.device_limit,
      version: tenant.version,
    })
    const index = overview.value?.tenants.findIndex((item) => item.id === updated.id) ?? -1
    if (overview.value && index >= 0) overview.value.tenants[index] = updated
    drafts[updated.id] = {
      plan: updated.plan,
      status: updated.status,
      seat_limit: updated.seat_limit,
      device_limit: updated.device_limit,
    }
    ElMessage.success('工作区额度已更新')
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
      title="套餐工作区"
      description="套餐只是名称。席位和每账号设备数可以单独填写，保存后按填写的额度生效。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div class="plan-grid">
      <article v-for="plan in overview?.plans || []" :key="plan.key" class="panel plan-card">
        <h2>{{ plan.name }}</h2>
        <p>{{ plan.description }}</p>
        <div class="plan-card__limits">
          <span>建议 {{ plan.seats }} 个席位</span>
          <span>建议每账号 {{ plan.devices }} 台</span>
        </div>
      </article>
    </div>

    <section class="panel tenant-panel">
      <el-table v-loading="loading" :data="overview?.tenants || []" row-key="id">
        <el-table-column label="工作区" min-width="180">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <div class="mono tenant-slug">{{ row.slug }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用量" min-width="160">
          <template #default="{ row }">
            {{ row.member_count }} / {{ row.seat_limit }} 人
            <div class="tenant-usage">{{ row.device_count }} 台设备</div>
          </template>
        </el-table-column>
        <el-table-column label="套餐" min-width="150">
          <template #default="{ row }">
            <el-select v-model="drafts[row.id].plan">
              <el-option
                v-for="plan in overview?.plans || []"
                :key="plan.key"
                :label="plan.name"
                :value="plan.key"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="席位" width="140">
          <template #default="{ row }">
            <el-input-number
              v-model="drafts[row.id].seat_limit"
              :min="1"
              :max="1000000"
              :step="1"
              controls-position="right"
            />
          </template>
        </el-table-column>
        <el-table-column label="每账号设备" width="150">
          <template #default="{ row }">
            <el-input-number
              v-model="drafts[row.id].device_limit"
              :min="1"
              :max="1000000"
              :step="1"
              controls-position="right"
            />
          </template>
        </el-table-column>
        <el-table-column label="订阅" min-width="140">
          <template #default="{ row }">
            <el-select v-model="drafts[row.id].status">
              <el-option
                v-for="(label, key) in STATUS_LABELS"
                :key="key"
                :label="label"
                :value="key"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              :disabled="!dirty(row as SaasTenant)"
              :loading="savingId === row.id"
              @click="save(row as SaasTenant)"
            >
              保存
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped lang="scss">
.plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.plan-card {
  padding: 16px;

  h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }

  p {
    min-height: 44px;
    margin: 0 0 12px;
    color: var(--app-text-secondary);
    font-size: 12.5px;
    line-height: 1.6;
  }
}

.plan-card__limits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--app-text);
  font-size: 12px;
  font-weight: 600;
}

.tenant-panel {
  padding: 8px 8px 4px;

  :deep(.el-input-number) {
    width: 118px;
  }
}

.tenant-slug,
.tenant-usage {
  margin-top: 4px;
  color: var(--app-muted);
  font-size: 12px;
}

@media (max-width: 900px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { assignAccountPlan, createPlan, getSaas, getSaasAccounts, updatePlan, updateTenant } from '@/api/saas'
import { ApiError } from '@/api/request'
import type { SaasAccount, SaasOverview, SaasPlan, SaasStatus, SaasTenant } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'

const STATUS_LABELS: Record<SaasStatus, string> = {
  trialing: '试用',
  active: '有效',
  past_due: '欠费',
  canceled: '已停用',
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
  support: '客服',
  auditor: '审计',
  partner: '第三方',
  user: '普通用户',
}

const loading = ref(false)
const accountsLoading = ref(false)
const accounts = ref<SaasAccount[]>([])
const accountTotal = ref(0)
const savingId = ref<string | null>(null)
const savingPlanId = ref<string | null>(null)
const assigningId = ref<string | null>(null)
const creating = ref(false)
const createVisible = ref(false)
const overview = ref<SaasOverview | null>(null)
const drafts = reactive<Record<string, { plan: string; status: SaasStatus }>>({})
const planDrafts = reactive<Record<string, { seats: number; devices: number }>>({})
const accountDrafts = reactive<
  Record<string, { plan_id: string; status: SaasStatus; device_limit: number; override: boolean }>
>({})
const form = reactive({ name: '', description: '', seats: 10, devices: 50 })
const accountQuery = ref('')
const accountPage = ref(1)
const accountPageSize = ref(10)
let accountRequest = 0

async function loadAccounts(): Promise<void> {
  const requestId = ++accountRequest
  accountsLoading.value = true
  try {
    const data = await getSaasAccounts({
      q: accountQuery.value,
      page: accountPage.value,
      page_size: accountPageSize.value,
    })
    if (requestId !== accountRequest) return
    accounts.value = data.items
    accountTotal.value = data.total
    accountPage.value = data.page
    syncAccounts(data.items, overview.value?.plans || [])
  } catch {
    // 全局错误提示已处理
  } finally {
    if (requestId === accountRequest) accountsLoading.value = false
  }
}

function searchAccounts(): void {
  accountPage.value = 1
  void loadAccounts()
}

function handleAccountPageSizeChange(): void {
  accountPage.value = 1
  void loadAccounts()
}

function syncDrafts(tenants: SaasTenant[]): void {
  for (const key of Object.keys(drafts)) delete drafts[key]
  for (const tenant of tenants) {
    drafts[tenant.id] = { plan: tenant.plan, status: tenant.status }
  }
}

function syncPlans(plans: SaasPlan[]): void {
  for (const key of Object.keys(planDrafts)) delete planDrafts[key]
  for (const plan of plans) {
    planDrafts[plan.id] = { seats: plan.seats, devices: plan.devices }
  }
}

function catalogPlan(key: string): SaasPlan | undefined {
  return overview.value?.plans.find((plan) => plan.key === key)
}

function catalogPlanById(id: string): SaasPlan | undefined {
  return overview.value?.plans.find((plan) => plan.id === id)
}

function syncAccounts(accounts: SaasAccount[], plans: SaasPlan[]): void {
  for (const key of Object.keys(accountDrafts)) delete accountDrafts[key]
  const fallback = plans.find((plan) => plan.key === 'pro') || plans[0]
  for (const account of accounts) {
    accountDrafts[account.id] = {
      plan_id: account.plan_id || fallback?.id || '',
      status: account.subscription_status,
      device_limit: account.device_limit,
      override: account.plan_override,
    }
  }
}

function dirty(tenant: SaasTenant): boolean {
  const draft = drafts[tenant.id]
  if (!draft) return false
  return draft.plan !== tenant.plan || draft.status !== tenant.status
}

function planDirty(plan: SaasPlan): boolean {
  const draft = planDrafts[plan.id]
  if (!draft) return false
  return draft.seats !== plan.seats || draft.devices !== plan.devices
}

async function load(): Promise<void> {
  loading.value = true
  try {
    overview.value = await getSaas()
    syncPlans(overview.value.plans)
    syncDrafts(overview.value.tenants)
    await loadAccounts()
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

async function save(tenant: SaasTenant): Promise<void> {
  const draft = drafts[tenant.id]
  if (!draft || !dirty(tenant)) return
  const selected = catalogPlan(draft.plan)
  if (!selected) {
    ElMessage.warning('请选择套餐')
    return
  }
  if (tenant.member_count > selected.seats) {
    try {
      await ElMessageBox.confirm(
        `「${selected.name}」只有 ${selected.seats} 个席位，「${tenant.name}」现有 ${tenant.member_count} 名成员。已有成员会保留，但不能再注册新成员。`,
        '席位将小于现有成员',
        { type: 'warning', confirmButtonText: '仍然切换', cancelButtonText: '取消' },
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
      version: tenant.version,
    })
    const index = overview.value?.tenants.findIndex((item) => item.id === updated.id) ?? -1
    if (overview.value && index >= 0) overview.value.tenants[index] = updated
    drafts[updated.id] = { plan: updated.plan, status: updated.status }
    ElMessage.success(`已改为「${selected.name}」。额度跟随这个套餐，未单独控制的账号会一起切换。`)
    await loadAccounts()
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  } finally {
    savingId.value = null
  }
}

function accountDirty(account: SaasAccount): boolean {
  const draft = accountDrafts[account.id]
  if (!draft) return false
  return (
    draft.override !== account.plan_override ||
    (draft.override &&
      (draft.plan_id !== (account.plan_id || '') || draft.status !== account.subscription_status))
  )
}

async function savePlan(plan: SaasPlan): Promise<void> {
  const draft = planDrafts[plan.id]
  if (!draft || !planDirty(plan)) return
  if (!Number.isInteger(draft.seats) || !Number.isInteger(draft.devices)) {
    ElMessage.warning('席位和每账号设备数都要填整数')
    return
  }
  savingPlanId.value = plan.id
  try {
    await updatePlan(plan.id, { seats: draft.seats, devices: draft.devices, version: plan.version })
    ElMessage.success(`已更新「${plan.name}」。只有正在使用这个套餐的工作区和账号会跟着变。`)
    await load()
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  } finally {
    savingPlanId.value = null
  }
}

async function assign(account: SaasAccount): Promise<void> {
  const draft = accountDrafts[account.id]
  if (!draft || !accountDirty(account)) return
  if (draft.override && !draft.plan_id) {
    ElMessage.warning('请选择套餐')
    return
  }
  assigningId.value = account.id
  try {
    const updated = await assignAccountPlan(
      account.id,
      draft.override
        ? { plan_id: draft.plan_id, status: draft.status, version: account.version }
        : { follow_default: true, version: account.version },
    )
    const index = accounts.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) accounts.value[index] = updated
    accountDrafts[updated.id] = {
      plan_id: updated.plan_id || '',
      status: updated.subscription_status,
      device_limit: updated.device_limit,
      override: updated.plan_override,
    }
    ElMessage.success(
      updated.plan_override
        ? `已单独把「${updated.plan_name}」分配给 ${updated.username}`
        : `${updated.username} 已改回跟随默认套餐`,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  } finally {
    assigningId.value = null
  }
}

function openCreate(): void {
  form.name = ''
  form.description = ''
  form.seats = 10
  form.devices = 50
  createVisible.value = true
}

async function submitPlan(): Promise<void> {
  const name = form.name.trim()
  if (!name) {
    ElMessage.warning('请填写套餐名称')
    return
  }
  creating.value = true
  try {
    await createPlan({
      name,
      description: form.description.trim(),
      seats: form.seats,
      devices: form.devices,
    })
    createVisible.value = false
    ElMessage.success('套餐已添加')
    await load()
  } catch {
    // 全局错误提示已处理
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="套餐工作区"
      description="每个套餐自己保存席位和设备额度。工作区和账号只选择套餐，额度跟所选套餐走。"
    >
      <el-button type="primary" @click="openCreate">添加套餐</el-button>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div class="plan-grid">
      <article v-for="plan in overview?.plans || []" :key="plan.id" class="panel plan-card">
        <h2>{{ plan.name }}</h2>
        <p>{{ plan.description || '还没有说明' }}</p>
        <div v-if="planDrafts[plan.id]" class="plan-card__edit">
          <label>
            席位
            <el-input-number
              v-model="planDrafts[plan.id].seats"
              :min="1"
              :max="1000000"
              :step="1"
              size="small"
              controls-position="right"
            />
          </label>
          <label>
            每账号设备
            <el-input-number
              v-model="planDrafts[plan.id].devices"
              :min="1"
              :max="1000000"
              :step="1"
              size="small"
              controls-position="right"
            />
          </label>
          <el-button
            size="small"
            type="primary"
            :disabled="!planDirty(plan)"
            :loading="savingPlanId === plan.id"
            @click="savePlan(plan)"
          >
            保存
          </el-button>
        </div>
      </article>
    </div>

    <section class="panel tenant-panel">
      <div class="panel-heading">
        <h2>默认套餐</h2>
        <p>这里只选择套餐和订阅。席位、每账号设备使用上面该套餐自己的额度，不会改到其他套餐。</p>
      </div>
      <el-table v-loading="loading" :data="overview?.tenants || []" row-key="id">
        <el-table-column label="工作区" min-width="180">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <div class="mono tenant-slug">{{ row.slug }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用量" min-width="160">
          <template #default="{ row }">
            {{ row.member_count }} / {{ catalogPlan(drafts[row.id].plan)?.seats ?? row.seat_limit }} 人
            <div class="tenant-usage">{{ row.device_count }} 台设备</div>
          </template>
        </el-table-column>
        <el-table-column label="新成员默认套餐" min-width="160">
          <template #default="{ row }">
            <el-select v-model="drafts[row.id].plan">
              <el-option
                v-for="plan in overview?.plans || []"
                :key="plan.id"
                :label="plan.name"
                :value="plan.key"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="套餐额度" min-width="160">
          <template #default="{ row }">
            <template v-if="catalogPlan(drafts[row.id].plan)">
              {{ catalogPlan(drafts[row.id].plan)?.seats }} 个席位
              <div class="tenant-usage">每账号 {{ catalogPlan(drafts[row.id].plan)?.devices }} 台</div>
            </template>
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

    <section class="panel tenant-panel account-panel">
      <div class="panel-heading account-heading">
        <div>
          <h2>单独控制</h2>
          <p>打开后，这个账号改用自己选的套餐。设备额度仍由那个套餐决定，不在这里另填数字。</p>
        </div>
        <div class="account-search">
          <el-input
            v-model="accountQuery"
            placeholder="搜索账号、角色或套餐"
            clearable
            class="search-input"
            @keyup.enter="searchAccounts"
            @clear="searchAccounts"
          />
          <el-button type="primary" :icon="Search" @click="searchAccounts">查询</el-button>
        </div>
      </div>
      <el-table v-loading="accountsLoading" :data="accounts" row-key="id">
        <el-table-column label="账号" min-width="180">
          <template #default="{ row }">
            <strong>{{ row.username }}</strong>
            <div class="tenant-usage">{{ ROLE_LABELS[row.role] || row.role }}</div>
          </template>
        </el-table-column>
        <el-table-column label="已用设备" width="110">
          <template #default="{ row }">{{ row.device_count }} 台</template>
        </el-table-column>
        <el-table-column label="单独控制" width="110">
          <template #default="{ row }">
            <el-switch v-model="accountDrafts[row.id].override" />
          </template>
        </el-table-column>
        <el-table-column label="套餐" min-width="160">
          <template #default="{ row }">
            <el-select v-model="accountDrafts[row.id].plan_id" :disabled="!accountDrafts[row.id].override">
              <el-option
                v-for="plan in overview?.plans || []"
                :key="plan.id"
                :label="plan.name"
                :value="plan.id"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="套餐额度" min-width="140">
          <template #default="{ row }">
            每账号 {{ catalogPlanById(accountDrafts[row.id].plan_id)?.devices ?? row.device_limit }} 台
          </template>
        </el-table-column>
        <el-table-column label="订阅" min-width="140">
          <template #default="{ row }">
            <el-select v-model="accountDrafts[row.id].status" :disabled="!accountDrafts[row.id].override">
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
              :disabled="!accountDirty(row as SaasAccount)"
              :loading="assigningId === row.id"
              @click="assign(row as SaasAccount)"
            >
              保存
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-hint">
            <p>没有匹配的账号</p>
            <span>换一个关键词后再查询。</span>
          </div>
        </template>
      </el-table>
      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="accountPage"
          v-model:page-size="accountPageSize"
          :page-sizes="[10, 20, 50]"
          :total="accountTotal"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="loadAccounts"
          @size-change="handleAccountPageSizeChange"
        />
      </div>
    </section>

    <el-dialog v-model="createVisible" title="添加套餐" width="440px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="名称">
          <el-input v-model="form.name" maxlength="32" placeholder="例如家庭版" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" maxlength="200" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="默认席位">
          <el-input-number v-model="form.seats" :min="1" :max="1000000" :step="1" />
        </el-form-item>
        <el-form-item label="默认每账号设备">
          <el-input-number v-model="form.devices" :min="1" :max="1000000" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitPlan">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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

.plan-card__edit {
  display: flex;
  flex-direction: column;
  gap: 8px;

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text-secondary);
    font-size: 12px;
  }

  :deep(.el-input-number) {
    width: 118px;
  }
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

.account-panel {
  margin-top: 16px;
}

.panel-heading {
  padding: 12px 12px 4px;

  h2 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  p {
    margin: 0 0 8px;
    color: var(--app-text-secondary);
    font-size: 13px;
  }
}

.account-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  justify-content: space-between;
}

.account-search {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-input {
  width: 240px;
}

@media (max-width: 900px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'

import {
  createAdminAccount,
  deleteAdminAccount,
  getAdminAccounts,
  resetAdminPassword,
  updateAdminAccount,
} from '@/api/accounts'
import { ApiError } from '@/api/request'
import type { AdminAccountItem, AdminRole, UserStatus } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, initialOf, shortId } from '@/utils/format'

const appStore = useAppStore()
const auth = useAuthStore()

const loading = ref(false)
const accounts = ref<AdminAccountItem[]>([])
const keyword = ref('')

const filteredAccounts = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return accounts.value
  return accounts.value.filter((account) => {
    const roleText = account.role === 'owner' ? '所有者 owner' : '运营者 operator'
    return `${account.username} ${roleText}`.toLowerCase().includes(query)
  })
})

const ownerCount = computed(
  () => accounts.value.filter((account) => account.role === 'owner').length,
)
const operatorCount = computed(
  () => accounts.value.filter((account) => account.role === 'operator').length,
)
const disabledCount = computed(
  () => accounts.value.filter((account) => account.status === 'disabled').length,
)
const activeOwnerCount = computed(
  () =>
    accounts.value.filter((account) => account.role === 'owner' && account.status === 'active')
      .length,
)

function isSelf(account: AdminAccountItem): boolean {
  return auth.user?.id === account.id
}

function isLastActiveOwner(account: AdminAccountItem): boolean {
  return account.role === 'owner' && account.status === 'active' && activeOwnerCount.value <= 1
}

function canEdit(account: AdminAccountItem): boolean {
  return !isSelf(account) && !isLastActiveOwner(account)
}

function canDelete(account: AdminAccountItem): boolean {
  return !isSelf(account) && !isLastActiveOwner(account)
}

function roleLabel(role: AdminRole): string {
  return role === 'owner' ? '所有者' : '运营者'
}

function lastLoginText(value: number | null): string {
  return value ? formatDateTime(value) : '从未登录'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getAdminAccounts()
    accounts.value = data.items
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

// ---------- 新增 ----------

const createVisible = ref(false)
const createLoading = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive<{
  username: string
  password: string
  confirm_password: string
  role: AdminRole
}>({
  username: '',
  password: '',
  confirm_password: '',
  role: 'operator',
})

const createRules: FormRules = {
  username: [
    { required: true, message: '请输入管理员账号', trigger: 'blur' },
    {
      pattern: /^[a-z0-9_]{4,32}$/,
      message: '账号需为 4–32 位小写字母、数字或下划线',
      trigger: 'blur',
    },
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 8, max: 128, message: '密码长度需为 8–128 位', trigger: 'blur' },
  ],
  confirm_password: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) callback(new Error('请再次输入密码'))
        else if (value !== createForm.password) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

function openCreate(): void {
  createForm.username = ''
  createForm.password = ''
  createForm.confirm_password = ''
  createForm.role = 'operator'
  createVisible.value = true
  void nextTick(() => createFormRef.value?.clearValidate())
}

async function submitCreate(): Promise<void> {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return

  createLoading.value = true
  try {
    await createAdminAccount({
      username: createForm.username.trim(),
      password: createForm.password,
      role: createForm.role,
    })
    ElMessage.success('管理员账号已创建')
    createVisible.value = false
    await load()
  } catch {
    // 全局错误提示已处理
  } finally {
    createLoading.value = false
  }
}

// ---------- 编辑角色 / 状态 ----------

const editVisible = ref(false)
const editLoading = ref(false)
const editTarget = ref<AdminAccountItem | null>(null)
const editForm = reactive<{
  role: AdminRole
  status: UserStatus
}>({
  role: 'operator',
  status: 'active',
})

const editDirty = computed(() => {
  if (!editTarget.value) return false
  return editForm.role !== editTarget.value.role || editForm.status !== editTarget.value.status
})

function openEdit(account: AdminAccountItem): void {
  if (!canEdit(account)) return
  editTarget.value = account
  editForm.role = account.role
  editForm.status = account.status
  editVisible.value = true
}

async function submitEdit(): Promise<void> {
  const target = editTarget.value
  if (!target || !editDirty.value) return

  const changes: string[] = []
  if (target.role !== editForm.role) {
    changes.push(`角色由「${roleLabel(target.role)}」改为「${roleLabel(editForm.role)}」`)
  }
  if (target.status !== editForm.status) {
    changes.push(
      editForm.status === 'disabled'
        ? '停用该账号，其现有登录会话会立即失效'
        : '恢复该账号的后台登录权限',
    )
  }

  try {
    await ElMessageBox.confirm(`将${changes.join('；')}。确认继续？`, '确认修改管理员', {
      type: editForm.status === 'disabled' ? 'warning' : 'info',
      confirmButtonText: '确认修改',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  editLoading.value = true
  try {
    await updateAdminAccount(target.id, {
      role: editForm.role,
      status: editForm.status,
      version: target.version,
    })
    ElMessage.success('管理员账号已更新')
    editVisible.value = false
    await load()
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      editVisible.value = false
      await load()
    }
  } finally {
    editLoading.value = false
  }
}

// ---------- 重置密码 ----------

const resetVisible = ref(false)
const resetLoading = ref(false)
const resetTarget = ref<AdminAccountItem | null>(null)
const resetFormRef = ref<FormInstance>()
const resetForm = reactive({
  password: '',
  confirm_password: '',
})

const resetSelf = computed(() => resetTarget.value?.id === auth.user?.id)

const resetRules: FormRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 128, message: '密码长度需为 8–128 位', trigger: 'blur' },
  ],
  confirm_password: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) callback(new Error('请再次输入新密码'))
        else if (value !== resetForm.password) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

function openReset(account: AdminAccountItem): void {
  resetTarget.value = account
  resetForm.password = ''
  resetForm.confirm_password = ''
  resetVisible.value = true
  void nextTick(() => resetFormRef.value?.clearValidate())
}

async function submitReset(): Promise<void> {
  const target = resetTarget.value
  if (!target || !resetFormRef.value) return
  const valid = await resetFormRef.value.validate().catch(() => false)
  if (!valid) return

  resetLoading.value = true
  try {
    await resetAdminPassword(target.id, resetForm.password, target.version)
    ElMessage.success(
      resetSelf.value ? '密码已更新，当前会话保留' : '密码已重置，该账号的会话已失效',
    )
    resetVisible.value = false
    await load()
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      resetVisible.value = false
      await load()
    }
  } finally {
    resetLoading.value = false
  }
}

// ---------- 删除 ----------

async function handleDelete(account: AdminAccountItem): Promise<void> {
  if (!canDelete(account)) return
  try {
    await ElMessageBox.confirm(
      `删除管理员「${account.username}」后，该账号的登录会话会立即失效，且不可恢复。`,
      '删除管理员账号',
      {
        type: 'warning',
        confirmButtonText: '删除账号',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  try {
    await deleteAdminAccount(account.id, account.version)
    ElMessage.success('管理员账号已删除')
    await load()
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="系统账号"
      description="管理可以登录后台的所有者与运营者账号；仅所有者可访问，系统至少保留一个启用状态的所有者。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreate">新增管理员</el-button>
    </PageHeader>

    <section class="panel table-panel">
      <div class="table-panel__header">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="搜索账号或角色"
            :prefix-icon="Search"
            clearable
            class="search-input"
          />
        </div>
        <div class="account-summary">
          <span
            >共 <strong>{{ accounts.length }}</strong> 个管理员</span
          >
          <span class="summary-divider" />
          <span
            >所有者 <strong>{{ ownerCount }}</strong></span
          >
          <span class="summary-divider" />
          <span
            >运营者 <strong>{{ operatorCount }}</strong></span
          >
          <template v-if="disabledCount">
            <span class="summary-divider" />
            <span
              >已停用 <strong class="is-danger">{{ disabledCount }}</strong></span
            >
          </template>
        </div>
      </div>

      <el-table v-loading="loading" :data="filteredAccounts" row-key="id" class="account-table">
        <el-table-column label="管理员" :min-width="appStore.isMobile ? 160 : 240">
          <template #default="{ row }">
            <div class="account-cell">
              <el-avatar :size="34" class="account-avatar">
                {{ initialOf(row.username) }}
              </el-avatar>
              <span class="account-cell__text">
                <span class="account-name">
                  <strong>{{ row.username }}</strong>
                  <el-tag
                    v-if="isSelf(row as AdminAccountItem)"
                    size="small"
                    type="info"
                    effect="plain"
                    round
                  >
                    当前账号
                  </el-tag>
                </span>
                <small class="mono">#{{ shortId(row.id) }}</small>
                <span v-if="appStore.isMobile" class="account-tags">
                  <el-tag
                    :type="row.role === 'owner' ? 'warning' : 'primary'"
                    size="small"
                    effect="light"
                    round
                  >
                    {{ roleLabel(row.role as AdminRole) }}
                  </el-tag>
                  <el-tag
                    :type="row.status === 'active' ? 'success' : 'danger'"
                    size="small"
                    effect="light"
                    round
                  >
                    {{ row.status === 'active' ? '正常' : '已停用' }}
                  </el-tag>
                </span>
              </span>
            </div>
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="角色" width="100">
          <template #default="{ row }">
            <el-tag
              :type="row.role === 'owner' ? 'warning' : 'primary'"
              effect="light"
              size="small"
              round
            >
              {{ roleLabel(row.role as AdminRole) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="状态" width="92">
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

        <el-table-column v-if="!appStore.isMobile" label="最近登录" width="168">
          <template #default="{ row }">{{ lastLoginText(row.last_login_at) }}</template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="创建时间" width="168">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>

        <el-table-column
          label="操作"
          :width="appStore.isMobile ? 180 : 210"
          :fixed="appStore.isMobile ? false : 'right'"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="!canEdit(row as AdminAccountItem)"
              @click="openEdit(row as AdminAccountItem)"
            >
              编辑
            </el-button>
            <el-button link type="primary" @click="openReset(row as AdminAccountItem)">
              重置密码
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="!canDelete(row as AdminAccountItem)"
              @click="handleDelete(row as AdminAccountItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <div class="empty-hint">
            <p>{{ accounts.length ? '没有匹配的管理员' : '还没有管理员账号' }}</p>
            <span>{{ accounts.length ? '换个关键词再试。' : '点击右上角新增管理员。' }}</span>
          </div>
        </template>
      </el-table>
    </section>

    <el-dialog
      v-model="createVisible"
      title="新增管理员"
      width="470px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="账号" prop="username">
          <el-input
            v-model="createForm.username"
            placeholder="例如 ops_zhang"
            maxlength="32"
            autocomplete="off"
          />
          <p class="field-note">4–32 位小写字母、数字或下划线，创建后不可修改。</p>
        </el-form-item>

        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="createForm.role">
            <el-radio-button value="operator">运营者</el-radio-button>
            <el-radio-button value="owner">所有者</el-radio-button>
          </el-radio-group>
          <p class="field-note">
            运营者可管理普通账号与邀请；所有者额外拥有系统账号、运营配置和审计权限。
          </p>
        </el-form-item>

        <el-form-item label="初始密码" prop="password">
          <el-input
            v-model="createForm.password"
            type="password"
            show-password
            placeholder="8–128 位"
            autocomplete="new-password"
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirm_password">
          <el-input
            v-model="createForm.confirm_password"
            type="password"
            show-password
            placeholder="再次输入初始密码"
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="创建后请通过安全渠道交付初始密码"
        description="对方登录时需输入账号、密码和页面上的图形验证码。"
      />

      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="submitCreate">
          创建管理员
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editVisible"
      title="编辑管理员"
      width="460px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="账号">
          <el-input :model-value="editTarget?.username" disabled />
        </el-form-item>

        <el-form-item label="角色">
          <el-radio-group v-model="editForm.role">
            <el-radio-button value="operator">运营者</el-radio-button>
            <el-radio-button value="owner">所有者</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="状态">
          <div class="status-row">
            <el-switch
              :model-value="editForm.status === 'active'"
              @change="(value) => (editForm.status = value ? 'active' : 'disabled')"
            />
            <span>{{
              editForm.status === 'active' ? '正常，可登录后台' : '已停用，无法登录'
            }}</span>
          </div>
        </el-form-item>

        <el-alert
          v-if="editTarget?.role === 'owner' && editForm.role === 'operator'"
          type="warning"
          :closable="false"
          show-icon
          title="降级为运营者"
          description="该账号将失去系统账号、运营配置和操作审计权限。"
        />
        <el-alert
          v-if="editForm.status === 'disabled'"
          type="warning"
          :closable="false"
          show-icon
          title="停用会立即退出登录"
          description="该账号现有的后台会话会被全部撤销。"
          class="edit-alert"
        />
      </el-form>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" :disabled="!editDirty" @click="submitEdit">
          保存修改
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="resetVisible"
      title="重置密码"
      width="440px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-if="resetTarget" class="reset-target">
        <el-avatar :size="38" class="account-avatar">
          {{ initialOf(resetTarget.username) }}
        </el-avatar>
        <div>
          <strong>{{ resetTarget.username }}</strong>
          <span>{{ roleLabel(resetTarget.role) }}</span>
        </div>
      </div>

      <el-form ref="resetFormRef" :model="resetForm" :rules="resetRules" label-position="top">
        <el-form-item label="新密码" prop="password">
          <el-input
            v-model="resetForm.password"
            type="password"
            show-password
            placeholder="8–128 位"
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm_password">
          <el-input
            v-model="resetForm.confirm_password"
            type="password"
            show-password
            placeholder="再次输入新密码"
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>

      <el-alert
        :type="resetSelf ? 'info' : 'warning'"
        :closable="false"
        show-icon
        :title="resetSelf ? '当前登录会话会保留' : '该账号现有会话将全部失效'"
        :description="
          resetSelf
            ? '修改自己的密码时保留当前会话，其他设备上的登录会退出。'
            : '重置后请通过安全渠道把新密码交给对应管理员。'
        "
      />

      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetLoading" @click="submitReset">
          确认重置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.search-input {
  width: 240px;
}

.account-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  align-items: center;
  color: var(--app-muted);
  font-size: 12px;

  strong {
    color: var(--app-text);
    font-weight: 650;
  }

  strong.is-danger {
    color: var(--app-danger);
  }
}

.summary-divider {
  width: 1px;
  height: 12px;
  background: var(--app-border);
}

.account-avatar {
  flex: 0 0 auto;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #4f8bff, #2456d6);
}

.account-cell {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 3px 0;
}

.account-cell__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;

  small {
    color: #a3adbd;
    font-size: 10.5px;
  }
}

.account-name {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;

  strong {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }
}

.account-tags {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.field-note {
  width: 100%;
  margin: 4px 0 0;
  color: var(--app-muted);
  font-size: 11px;
  line-height: 1.6;
}

.status-row {
  display: flex;
  gap: 10px;
  align-items: center;

  span {
    color: var(--app-text-secondary);
    font-size: 12px;
  }
}

.edit-alert {
  margin-top: 4px;
}

.reset-target {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--app-border);

  div {
    display: flex;
    flex-direction: column;
    line-height: 1.4;

    strong {
      color: var(--app-text);
      font-size: 14px;
      font-weight: 600;
    }

    span {
      color: var(--app-muted);
      font-size: 11.5px;
    }
  }
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

  .table-panel__header {
    align-items: stretch;
  }

  .account-summary {
    justify-content: flex-end;
  }
}
</style>

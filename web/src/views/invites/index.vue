<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { CopyDocument, Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'

import { createInvite, getInvites, revokeInvite } from '@/api/invites'
import type { CreatedInvite, InviteItem } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { useAppStore } from '@/stores/app'
import { copyText } from '@/utils/clipboard'
import { dateAfter, disablePastDate, formatDate, formatDateTime, shortId } from '@/utils/format'

type TagType = 'success' | 'info' | 'warning' | 'danger'

interface InviteState {
  label: string
  type: TagType
}

const appStore = useAppStore()

const loading = ref(false)
const invites = ref<InviteItem[]>([])

const createVisible = ref(false)
const createLoading = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  max_uses: 5,
  expires_on: dateAfter(30),
})
const rules: FormRules = {
  max_uses: [{ required: true, message: '请选择可用次数', trigger: 'change' }],
  expires_on: [{ required: true, message: '请选择有效期', trigger: 'change' }],
}

const createdVisible = ref(false)
const created = ref<CreatedInvite | null>(null)
const revokingId = ref<string | null>(null)

const availableCount = computed(
  () => invites.value.filter((invite) => inviteState(invite).label === '可使用').length,
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getInvites()
    invites.value = data.items
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

function inviteState(invite: InviteItem): InviteState {
  if (invite.revoked_at) return { label: '已撤销', type: 'info' }
  if (invite.used_count >= invite.max_uses) return { label: '已用完', type: 'warning' }
  if (invite.expires_at <= Date.now()) return { label: '已过期', type: 'danger' }
  return { label: '可使用', type: 'success' }
}

function progressColor(invite: InviteItem): string {
  if (invite.revoked_at) return '#c0c7d4'
  if (invite.used_count >= invite.max_uses) return '#f79009'
  return '#2f6bff'
}

function openCreate(): void {
  form.max_uses = 5
  form.expires_on = dateAfter(30)
  createVisible.value = true
  void nextTick(() => formRef.value?.clearValidate())
}

async function submitCreate(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  createLoading.value = true
  try {
    created.value = await createInvite({
      max_uses: form.max_uses,
      expires_on: form.expires_on,
    })
    createVisible.value = false
    createdVisible.value = true
    ElMessage.success('邀请码已创建')
    await load()
  } catch {
    // 全局错误提示已处理
  } finally {
    createLoading.value = false
  }
}

async function copyCode(): Promise<void> {
  if (!created.value) return
  const ok = await copyText(created.value.code)
  if (ok) {
    ElMessage.success('邀请码已复制')
  } else {
    ElMessage.error('复制失败，请手动选择邀请码复制')
  }
}

async function handleRevoke(invite: InviteItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `撤销后，邀请码「${shortId(invite.id)}」将不能再用于注册，且不可恢复。`,
      '撤销邀请',
      {
        type: 'warning',
        confirmButtonText: '撤销邀请',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  revokingId.value = invite.id
  try {
    const updated = await revokeInvite(invite.id)
    const index = invites.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) invites.value[index] = updated
    ElMessage.success('邀请已撤销')
  } catch {
    // 全局错误提示已处理
  } finally {
    revokingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="邀请管理"
      description="邀请码用于开放注册；明文只在创建成功时展示一次，请立即通过安全渠道发送。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreate">创建邀请</el-button>
    </PageHeader>

    <section class="panel table-panel">
      <div class="table-panel__header">
        <div class="invite-summary">
          <span
            >共 <strong>{{ invites.length }}</strong> 个邀请</span
          >
          <span class="invite-summary__divider" />
          <span
            >其中 <strong class="is-green">{{ availableCount }}</strong> 个当前可用</span
          >
        </div>
        <span class="invite-note">明文邀请码不会保存在前端</span>
      </div>

      <el-table v-loading="loading" :data="invites" row-key="id" class="invite-table">
        <el-table-column v-if="!appStore.isMobile" label="编号" width="120">
          <template #default="{ row }">
            <el-tooltip :content="row.id" placement="top">
              <span class="mono invite-id">#{{ shortId(row.id) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="状态" :width="appStore.isMobile ? 76 : 100">
          <template #default="{ row }">
            <el-tag :type="inviteState(row as InviteItem).type" effect="light" size="small" round>
              {{ inviteState(row as InviteItem).label }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="使用进度" :min-width="appStore.isMobile ? 140 : 180">
          <template #default="{ row }">
            <div class="usage-cell">
              <span class="usage-cell__text">
                <strong>{{ row.used_count }}</strong> / {{ row.max_uses }} 次
              </span>
              <el-progress
                :percentage="Math.min(100, (row.used_count / row.max_uses) * 100)"
                :stroke-width="5"
                :show-text="false"
                :color="progressColor(row as InviteItem)"
              />
              <small v-if="appStore.isMobile" class="usage-cell__expiry">
                至 {{ formatDate(row.expires_at) }}
              </small>
            </div>
          </template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="有效期至" width="168">
          <template #default="{ row }">{{ formatDateTime(row.expires_at) }}</template>
        </el-table-column>

        <el-table-column v-if="!appStore.isMobile" label="创建时间" width="168">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>

        <el-table-column
          label="操作"
          :width="appStore.isMobile ? 84 : 110"
          :fixed="appStore.isMobile ? false : 'right'"
        >
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :disabled="Boolean(row.revoked_at)"
              :loading="revokingId === row.id"
              @click="handleRevoke(row as InviteItem)"
            >
              {{ row.revoked_at ? '已撤销' : '撤销' }}
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <div class="empty-hint">
            <p>还没有邀请码</p>
            <span>创建第一个邀请码，开始邀请试用用户。</span>
          </div>
        </template>
      </el-table>
    </section>

    <el-dialog
      v-model="createVisible"
      title="创建邀请码"
      width="440px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="可用次数" prop="max_uses">
          <div class="number-row">
            <el-input-number v-model="form.max_uses" :min="1" :max="20" :step="1" />
            <span class="field-hint">每个邀请码可使用 1–20 次</span>
          </div>
        </el-form-item>

        <el-form-item label="有效期至" prop="expires_on">
          <el-date-picker
            v-model="form.expires_on"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择到期日期"
            :disabled-date="disablePastDate"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="提交后才会生成明文邀请码"
        description="明文只展示一次，关闭弹窗后无法再次查看。"
      />

      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="submitCreate">
          创建邀请码
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="createdVisible"
      title="邀请码创建成功"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
      @closed="created = null"
    >
      <template v-if="created">
        <div class="code-box">
          <span class="code-box__value mono">{{ created.code }}</span>
          <el-button type="primary" plain :icon="CopyDocument" @click="copyCode"> 复制 </el-button>
        </div>

        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="邀请码只显示一次"
          description="关闭弹窗后无法再次查看明文。请立即复制，并通过可信渠道发送给受邀用户。"
          class="code-alert"
        />

        <el-descriptions :column="1" border class="code-detail">
          <el-descriptions-item label="可用次数">{{ created.max_uses }} 次</el-descriptions-item>
          <el-descriptions-item label="有效期至">
            {{ formatDateTime(created.expires_at) }}
          </el-descriptions-item>
        </el-descriptions>
      </template>

      <template #footer>
        <el-button type="primary" @click="createdVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.invite-summary {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--app-text-secondary);
  font-size: 12.5px;

  strong {
    color: var(--app-text);
    font-weight: 650;
  }

  strong.is-green {
    color: var(--app-success);
  }
}

.invite-summary__divider {
  width: 1px;
  height: 12px;
  background: var(--app-border);
}

.invite-note {
  color: var(--app-muted);
  font-size: 11.5px;
}

.invite-id {
  color: var(--app-text-secondary);
  font-size: 12px;
}

.usage-cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-width: 170px;
}

.usage-cell__text {
  color: var(--app-muted);
  font-size: 11.5px;

  strong {
    color: var(--app-text);
    font-weight: 600;
  }
}

.usage-cell__expiry {
  color: #a2abba;
  font-size: 10.5px;
}

.number-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.field-hint {
  color: var(--app-muted);
  font-size: 11.5px;
}

.code-box {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  background: #f7f9ff;
  border: 1px dashed #c9d6f2;
  border-radius: 12px;
}

.code-box__value {
  overflow: hidden;
  color: #1e4fd8;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-alert {
  margin-top: 16px;
  border-radius: 10px;
}

.code-detail {
  margin-top: 16px;

  :deep(.el-descriptions__label) {
    width: 96px;
    color: var(--app-muted);
    font-size: 12px;
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
  .invite-note {
    display: none;
  }

  .code-box {
    flex-direction: column;
    align-items: flex-start;
  }

  .code-box__value {
    font-size: 18px;
  }
}
</style>

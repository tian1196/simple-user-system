<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { getUser, resetUserPassword, updateUserStatus } from '@/api/users'
import type { AdminUserItem, UserStatus } from '@/api/types'
import { ApiError } from '@/api/request'
import { copyText } from '@/utils/clipboard'
import { formatDateTime, initialOf, shortId } from '@/utils/format'

const props = defineProps<{
  modelValue: boolean
  userId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const loading = ref(false)
const toggling = ref(false)
const resetting = ref(false)
const loadFailed = ref(false)
const user = ref<AdminUserItem | null>(null)

watch(
  () => [props.modelValue, props.userId] as const,
  ([open, id]) => {
    if (open && id) void load(id)
  },
  { immediate: true },
)

async function load(id: string): Promise<void> {
  loading.value = true
  loadFailed.value = false
  try {
    user.value = await getUser(id)
  } catch {
    loadFailed.value = true
    user.value = null
  } finally {
    loading.value = false
  }
}

async function toggleStatus(): Promise<void> {
  if (!user.value) return

  const target: UserStatus = user.value.status === 'active' ? 'disabled' : 'active'
  const isDisable = target === 'disabled'
  const actionText = isDisable ? '停用' : '恢复'

  try {
    await ElMessageBox.confirm(
      isDisable
        ? `停用「${user.value.username}」后，该用户的全部登录会话会立即失效。`
        : `恢复「${user.value.username}」的登录权限？`,
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

  toggling.value = true
  try {
    const updated = await updateUserStatus(user.value.id, target, user.value.version)
    user.value = updated
    ElMessage.success(`已${actionText}账号`)
    emit('changed')
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await load(user.value.id)
    }
  } finally {
    toggling.value = false
  }
}

async function resetPassword(): Promise<void> {
  if (!user.value) return
  const current = user.value
  try {
    await ElMessageBox.confirm(
      `将为「${current.username}」生成一组新密码，并立即退出该账号的全部登录。旧的恢复码也会失效。`,
      '重置密码',
      { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  resetting.value = true
  try {
    const result = await resetUserPassword(current.id, current.version)
    user.value = result.user
    emit('changed')
    try {
      await ElMessageBox.alert(
        h('div', [
          h('p', { style: 'margin:0;line-height:1.6' }, '新密码只显示这一次，请复制后交给用户。'),
          h(
            'code',
            {
              style:
                'display:block;margin-top:10px;padding:10px 12px;font-size:16px;letter-spacing:0.04em;background:#f4f6fa;border-radius:8px;',
            },
            result.password,
          ),
        ]),
        '密码已重置',
        { confirmButtonText: '复制密码' },
      )
      const copied = await copyText(result.password)
      ElMessage.success(copied ? '密码已复制' : '请手动复制弹窗里的密码')
    } catch {
      // 关掉弹窗时密码不再展示
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load(current.id)
  } finally {
    resetting.value = false
  }
}

function lastLoginText(value: number | null): string {
  return value ? formatDateTime(value) : '从未登录'
}
</script>

<template>
  <el-drawer v-model="visible" title="账号详情" size="480px" class="user-drawer">
    <div v-loading="loading" class="drawer-body">
      <el-result
        v-if="loadFailed"
        icon="warning"
        title="账号详情加载失败"
        sub-title="请关闭后重试，或刷新账号列表。"
      />

      <template v-else-if="user">
        <div class="profile">
          <el-avatar :size="54" class="profile__avatar">{{ initialOf(user.username) }}</el-avatar>
          <div class="profile__meta">
            <h3>{{ user.username }}</h3>
            <div class="profile__tags">
              <el-tag :type="user.status === 'active' ? 'success' : 'danger'" size="small" round>
                {{ user.status === 'active' ? '正常' : '已停用' }}
              </el-tag>
              <el-tag type="info" effect="plain" size="small" round>普通用户</el-tag>
            </div>
          </div>
        </div>

        <el-descriptions :column="1" border class="detail-table">
          <el-descriptions-item label="用户 ID">
            <span class="mono detail-id">{{ user.id }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">
            {{ formatDateTime(user.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="最近登录">
            {{ lastLoginText(user.last_login_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="设备数量">
            <strong>{{ user.device_count }}</strong> 台
          </el-descriptions-item>
          <el-descriptions-item label="数据版本">v{{ user.version }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="隐私边界"
          description="后台只展示账号元数据与设备数量，不提供查看设备名称、备注或维护记录的入口。"
          class="privacy-alert"
        />

        <div class="drawer-actions">
          <el-button type="warning" plain :loading="resetting" @click="resetPassword">
            重置密码
          </el-button>
          <el-button
            v-if="user.status === 'active'"
            type="danger"
            plain
            :loading="toggling"
            @click="toggleStatus"
          >
            停用账号
          </el-button>
          <el-button v-else type="success" plain :loading="toggling" @click="toggleStatus">
            恢复账号
          </el-button>
          <span class="drawer-actions__hint">停用会立即撤销该用户的全部会话</span>
        </div>

        <div class="drawer-footnote">
          <span class="mono">{{ shortId(user.id, 8) }}</span>
          <span>仅作账号排查使用</span>
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped lang="scss">
.drawer-body {
  min-height: 320px;
}

.profile {
  display: flex;
  gap: 14px;
  align-items: center;
  padding-bottom: 20px;
}

.profile__avatar {
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  background: linear-gradient(135deg, #4f8bff, #2456d6);
}

.profile__meta {
  min-width: 0;

  h3 {
    margin: 0 0 6px;
    color: var(--app-text);
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
}

.profile__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-table {
  margin-bottom: 18px;

  :deep(.el-descriptions__label) {
    width: 104px;
    color: var(--app-muted);
    font-size: 12px;
    font-weight: 500;
  }

  :deep(.el-descriptions__content) {
    color: var(--app-text-secondary);
    font-size: 12.5px;
  }
}

.detail-id {
  font-size: 11.5px;
  word-break: break-all;
}

.privacy-alert {
  border-radius: 10px;
}

.drawer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 20px;
}

.drawer-actions__hint {
  color: var(--app-muted);
  font-size: 11px;
}

.drawer-footnote {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-top: 28px;
  padding-top: 14px;
  color: #a8b1c0;
  font-size: 10.5px;
  border-top: 1px dashed var(--app-border);
}
</style>

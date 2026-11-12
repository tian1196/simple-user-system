<script setup lang="ts">
import type { Component } from 'vue'
import { onMounted, ref } from 'vue'
import { EditPen, Refresh, Setting, UserFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/request'
import { getSettings, updateSetting } from '@/api/settings'
import type { SettingItem, SettingKey } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import { formatDateTime } from '@/utils/format'

interface SettingMeta {
  title: string
  description: string
  icon: Component
}

const metaMap: Record<SettingKey, SettingMeta> = {
  registration_enabled: {
    title: '允许邀请注册',
    description: '关闭后，新用户无法使用邀请码注册；已有账号的登录、设备与数据不受影响。',
    icon: UserFilled,
  },
  writes_enabled: {
    title: '允许业务写入',
    description:
      '关闭后，设备、维护计划和维护记录的写入会暂停；登录、查看、导出与注销等操作仍然可用。',
    icon: EditPen,
  },
}

const loading = ref(false)
const savingKey = ref<SettingKey | null>(null)
const items = ref<SettingItem[]>([])

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getSettings()
    items.value = data.items
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

async function beforeSettingChange(item: SettingItem): Promise<boolean> {
  const nextValue = !item.value

  if (!nextValue && item.key === 'writes_enabled') {
    try {
      await ElMessageBox.confirm(
        '关闭后，所有用户的设备、维护计划和维护记录写入都会暂停。确认关闭？',
        '暂停业务写入',
        {
          type: 'warning',
          confirmButtonText: '暂停写入',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return false
    }
  }

  savingKey.value = item.key
  try {
    const updated = await updateSetting(item.key, nextValue, item.version)
    const index = items.value.findIndex((entry) => entry.key === updated.key)
    if (index >= 0) items.value[index] = updated
    ElMessage.success(`${metaMap[item.key].title}已${nextValue ? '开启' : '关闭'}`)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await load()
    return false
  } finally {
    savingKey.value = null
  }
}

function metaOf(key: SettingKey): SettingMeta {
  return metaMap[key] ?? { title: key, description: '', icon: Setting }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader title="运营配置" description="全局开关只允许管理员修改；每次变更都会写入操作审计。">
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="这些配置会影响所有用户"
      description="修改前请确认影响范围。配置变更无法在本页回滚，但可以再次切换回原状态。"
      class="config-alert"
    />

    <div v-if="loading && !items.length" class="settings-list">
      <div v-for="index in 2" :key="index" class="panel setting-card">
        <el-skeleton animated :rows="2" />
      </div>
    </div>

    <div v-else class="settings-list">
      <section v-for="item in items" :key="item.key" class="panel setting-card">
        <div class="setting-card__icon">
          <el-icon :size="20"><component :is="metaOf(item.key).icon" /></el-icon>
        </div>

        <div class="setting-card__body">
          <div class="setting-card__title">
            <h2>{{ metaOf(item.key).title }}</h2>
            <el-tag :type="item.value ? 'success' : 'info'" effect="light" size="small" round>
              {{ item.value ? '已开启' : '已关闭' }}
            </el-tag>
          </div>
          <p class="setting-card__desc">{{ metaOf(item.key).description }}</p>
          <p class="setting-card__meta">
            配置键 <code>{{ item.key }}</code>
            <span class="dot">·</span>
            版本 v{{ item.version }}
            <span class="dot">·</span>
            更新于 {{ formatDateTime(item.updated_at) }}
          </p>
        </div>

        <div class="setting-card__action">
          <el-switch
            :model-value="item.value"
            :loading="savingKey === item.key"
            :disabled="savingKey !== null && savingKey !== item.key"
            :before-change="() => beforeSettingChange(item)"
          />
          <span class="setting-card__state">{{ item.value ? '开启中' : '已关闭' }}</span>
        </div>
      </section>

      <el-empty v-if="!items.length" description="没有读取到可配置项，请确认后端版本与账号权限。" />
    </div>

    <p class="config-footnote">
      权限说明：管理员拥有全部权限。运营处理账号和邀请，客服处理账号，审计只读，第三方只能看汇总。
    </p>
  </div>
</template>

<style scoped lang="scss">
.config-alert {
  margin-bottom: 16px;
  border-radius: 12px;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setting-card {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 22px;
}

.setting-card__icon {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  color: var(--app-primary);
  background: rgba(47, 107, 255, 0.09);
  border-radius: 12px;
  place-items: center;
}

.setting-card__body {
  flex: 1;
  min-width: 0;
}

.setting-card__title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;

  h2 {
    margin: 0;
    color: var(--app-text);
    font-size: 15px;
    font-weight: 650;
  }
}

.setting-card__desc {
  max-width: 760px;
  margin: 6px 0 8px;
  color: var(--app-text-secondary);
  font-size: 12.5px;
  line-height: 1.7;
}

.setting-card__meta {
  margin: 0;
  color: var(--app-muted);
  font-size: 11px;

  code {
    color: #667085;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 10.5px;
  }
}

.dot {
  margin: 0 6px;
  color: #ccd3df;
}

.setting-card__action {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  padding-top: 4px;
}

.setting-card__state {
  color: var(--app-muted);
  font-size: 10.5px;
}

.config-footnote {
  margin: 20px 0 0;
  color: var(--app-muted);
  font-size: 11.5px;
}

@media (max-width: 680px) {
  .setting-card {
    flex-wrap: wrap;
  }

  .setting-card__body {
    flex-basis: calc(100% - 60px);
  }

  .setting-card__action {
    flex-direction: row;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding-top: 0;
    padding-left: 58px;
  }
}
</style>

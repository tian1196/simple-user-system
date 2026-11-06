<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  Document,
  Monitor,
  Refresh,
  Setting,
  Switch,
  Ticket,
  TrendCharts,
  User,
} from '@element-plus/icons-vue'

import { getOverview } from '@/api/overview'
import type { Overview } from '@/api/types'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const auth = useAuthStore()

const loading = ref(false)
const overview = ref<Overview | null>(null)
const loadedAt = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    overview.value = await getOverview()
    loadedAt.value = formatDateTime(Date.now())
  } catch {
    // 全局拦截器已经提示，保留已有数据
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader
      title="运营概览"
      :description="`${auth.displayName}，这里只展示聚合数据，不读取用户的设备名称、备注或维护记录。`"
    >
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新数据</el-button>
    </PageHeader>

    <div v-if="loading && !overview" class="stats-grid">
      <div v-for="index in 4" :key="index" class="skeleton-card">
        <el-skeleton animated>
          <template #template>
            <div class="skeleton-card__row">
              <el-skeleton-item
                variant="rect"
                style="width: 42px; height: 42px; border-radius: 12px"
              />
              <div class="skeleton-card__text">
                <el-skeleton-item variant="text" style="width: 60%" />
                <el-skeleton-item variant="h1" style="width: 40%; margin-top: 10px" />
              </div>
            </div>
          </template>
        </el-skeleton>
      </div>
    </div>

    <el-result
      v-else-if="!overview"
      icon="warning"
      title="暂时拿不到运营数据"
      sub-title="请确认后端服务已经启动，并且当前账号仍有有效的后台会话。"
    >
      <template #extra>
        <el-button type="primary" :icon="Refresh" @click="load">重新加载</el-button>
      </template>
    </el-result>

    <template v-else>
      <section class="stats-grid">
        <StatCard
          label="普通用户"
          :value="overview.users"
          :icon="User"
          hint="仅统计 role = user 的账号"
        />
        <StatCard
          label="设备总数"
          :value="overview.devices"
          :icon="Monitor"
          tone="violet"
          hint="全站台账中的设备数量"
        />
        <StatCard
          label="近 7 日新增"
          :value="overview.new_users_7d"
          :icon="TrendCharts"
          tone="success"
          hint="最近 7 天注册的普通用户"
        />
        <StatCard
          label="业务写入"
          :value="overview.writes_enabled ? '开启中' : '已暂停'"
          :icon="Switch"
          :tone="overview.writes_enabled ? 'success' : 'warning'"
          hint="关闭后仍可登录、导出与注销"
        />
      </section>

      <div class="dashboard-grid">
        <section class="panel status-panel">
          <div class="panel__head">
            <div>
              <h2>运行状态</h2>
              <p>从后台概览接口读取的实时开关与备份信息。</p>
            </div>
            <span v-if="loadedAt" class="panel__stamp">更新于 {{ loadedAt }}</span>
          </div>

          <div class="status-list">
            <div class="status-row">
              <div class="status-row__label">
                <span>注册入口</span>
                <small>控制邀请码注册是否开放</small>
              </div>
              <el-tag
                :type="overview.registration_enabled ? 'success' : 'info'"
                effect="light"
                round
              >
                {{ overview.registration_enabled ? '已开启' : '已关闭' }}
              </el-tag>
            </div>

            <div class="status-row">
              <div class="status-row__label">
                <span>业务写入</span>
                <small>设备、计划与维护记录的写入开关</small>
              </div>
              <el-tag :type="overview.writes_enabled ? 'success' : 'warning'" effect="light" round>
                {{ overview.writes_enabled ? '已开启' : '已暂停' }}
              </el-tag>
            </div>

            <div class="status-row">
              <div class="status-row__label">
                <span>最近备份</span>
                <small>由部署脚本在服务器上执行</small>
              </div>
              <span class="status-row__value">{{ overview.backup_at || '尚未接入' }}</span>
            </div>

            <div class="status-row">
              <div class="status-row__label">
                <span>当前账号</span>
                <small>本次登录会话的角色</small>
              </div>
              <span class="status-row__value"> {{ auth.displayName }} · {{ auth.roleLabel }} </span>
            </div>
          </div>

          <p class="panel__footnote">
            后台只读取账号元数据与聚合数量；用户的设备名称、型号、备注和维护记录不会出现在这里。
          </p>
        </section>

        <section class="panel quick-panel">
          <div class="panel__head">
            <div>
              <h2>常用操作</h2>
              <p>发起邀请、处理账号，或进入运营配置。</p>
            </div>
          </div>

          <div class="quick-list">
            <button type="button" class="quick-item" @click="router.push('/invites')">
              <span class="quick-item__icon is-blue"
                ><el-icon><Ticket /></el-icon
              ></span>
              <span class="quick-item__text">
                <strong>创建邀请码</strong>
                <small>生成只展示一次的邀请码</small>
              </span>
              <el-icon class="quick-item__arrow"><ArrowRight /></el-icon>
            </button>

            <button type="button" class="quick-item" @click="router.push('/users')">
              <span class="quick-item__icon is-green"
                ><el-icon><User /></el-icon
              ></span>
              <span class="quick-item__text">
                <strong>管理账号</strong>
                <small>查询账号状态，停用或恢复账户</small>
              </span>
              <el-icon class="quick-item__arrow"><ArrowRight /></el-icon>
            </button>

            <template v-if="auth.isOwner">
              <button type="button" class="quick-item" @click="router.push('/settings')">
                <span class="quick-item__icon is-amber"
                  ><el-icon><Setting /></el-icon
                ></span>
                <span class="quick-item__text">
                  <strong>运营配置</strong>
                  <small>调整注册入口与业务写入开关</small>
                </span>
                <el-icon class="quick-item__arrow"><ArrowRight /></el-icon>
              </button>

              <button type="button" class="quick-item" @click="router.push('/audit')">
                <span class="quick-item__icon is-violet"
                  ><el-icon><Document /></el-icon
                ></span>
                <span class="quick-item__text">
                  <strong>操作审计</strong>
                  <small>查看最近 50 条关键操作</small>
                </span>
                <el-icon class="quick-item__arrow"><ArrowRight /></el-icon>
              </button>
            </template>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.skeleton-card {
  padding: 20px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
}

.skeleton-card__row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.skeleton-card__text {
  flex: 1;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.85fr);
  gap: 16px;
  margin-top: 16px;
}

.panel {
  padding: 22px;
}

.panel__head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;

  h2 {
    margin: 0;
    color: var(--app-text);
    font-size: 16px;
    font-weight: 650;
  }

  p {
    margin: 4px 0 0;
    color: var(--app-muted);
    font-size: 12px;
  }
}

.panel__stamp {
  color: #a2abba;
  font-size: 11px;
  white-space: nowrap;
}

.panel__footnote {
  margin: 18px 0 0;
  padding-top: 16px;
  color: var(--app-muted);
  font-size: 11.5px;
  line-height: 1.7;
  border-top: 1px dashed var(--app-border);
}

.status-list {
  display: flex;
  flex-direction: column;
}

.status-row {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 13px 0;
  border-bottom: 1px solid #f1f4f9;

  &:last-child {
    border-bottom: 0;
  }
}

.status-row__label {
  display: flex;
  flex-direction: column;
  min-width: 0;

  span {
    color: var(--app-text);
    font-size: 13.5px;
    font-weight: 500;
  }

  small {
    margin-top: 1px;
    color: var(--app-muted);
    font-size: 11px;
  }
}

.status-row__value {
  color: var(--app-text-secondary);
  font-size: 12.5px;
  text-align: right;
}

.quick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-item {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 11px 12px;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 11px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: #f8faff;
    border-color: #e3e9f6;
  }
}

.quick-item__icon {
  display: grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  place-items: center;

  &.is-blue {
    color: #2f6bff;
    background: rgba(47, 107, 255, 0.1);
  }

  &.is-green {
    color: var(--app-success);
    background: rgba(18, 183, 106, 0.1);
  }

  &.is-amber {
    color: var(--app-warning);
    background: rgba(247, 144, 9, 0.12);
  }

  &.is-violet {
    color: #7a5af8;
    background: rgba(122, 90, 248, 0.1);
  }
}

.quick-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.45;

  strong {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  small {
    color: var(--app-muted);
    font-size: 11px;
  }
}

.quick-item__arrow {
  color: #b6c0d0;
}

@media (max-width: 1180px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>

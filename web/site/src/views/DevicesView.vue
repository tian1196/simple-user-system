<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SiteButton from '../components/SiteButton.vue'
import PageHeading from '../components/PageHeading.vue'
import PageState from '../components/PageState.vue'
import {
  listDevices,
  getDueItems,
  getCalendar,
  type DeviceList,
  type DueList,
} from '../api/devices'
import { deviceIcon, deviceOverview } from '../utils/devices'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const devices = ref<DeviceList | null>(null)
const due = ref<DueList | null>(null)
const loading = ref(true)
const error = ref('')
const exporting = ref(false)
const exportError = ref('')
const notice = ref('')
let loadController: AbortController | undefined
const exportController = new AbortController()
const metrics = computed(() =>
  devices.value && due.value ? deviceOverview(devices.value, due.value) : [],
)
const icons = computed(
  () =>
    new Map(devices.value?.items.map((device) => [device.id, deviceIcon(device.category)]) || []),
)
const description = computed(() => {
  const base = due.value ? `${due.value.today} · 私人记录，仅本人可见` : '私人记录，仅本人可见'
  const workspace = session.user?.workspace
  if (!workspace || !devices.value) return base
  return `${base} · ${workspace.plan_name} ${devices.value.total} / ${workspace.device_limit} 台`
})

async function load() {
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  error.value = ''
  exportError.value = ''
  notice.value = ''
  try {
    const [deviceData, dueData] = await Promise.all([
      listDevices(controller.signal),
      getDueItems(controller.signal),
    ])
    if (controller.signal.aborted) return
    devices.value = deviceData
    due.value = dueData
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '台账加载失败，请稍后重试'
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}
async function exportCalendar() {
  if (exporting.value) return
  exporting.value = true
  exportError.value = ''
  notice.value = ''
  try {
    const calendar = await getCalendar(exportController.signal)
    if (exportController.signal.aborted) return
    const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `device-ledger-${due.value?.today || 'calendar'}.ics`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice.value = '已导出未来 30 天内的事项。请导入你的日历，并自行设置提醒。'
  } catch (cause) {
    if (!exportController.signal.aborted)
      exportError.value = cause instanceof Error ? cause.message : '日历导出失败，请重试'
  } finally {
    exporting.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  loadController?.abort()
  exportController.abort()
})
</script>

<template>
  <div class="devices-page site-container">
    <PageHeading title="我的设备" :description="description">
      <template #actions
        ><SiteButton :disabled="loading || !!error" :loading="exporting" @click="exportCalendar">{{
          exporting ? '正在导出…' : '导出日历'
        }}</SiteButton
        ><SiteButton to="/app/devices/new" variant="primary">+ 新增设备</SiteButton></template
      >
    </PageHeading>
    <p v-if="exportError" class="ledger-feedback is-error" role="alert">
      {{ exportError }} 请点击“导出日历”重试。
    </p>
    <p v-if="notice" class="ledger-feedback" role="status">{{ notice }}</p>
    <PageState
      v-if="loading"
      kind="loading"
      title="正在加载你的台账…"
      description="正在获取设备与近期事项。"
    />
    <PageState
      v-else-if="error"
      kind="error"
      title="暂时无法加载台账"
      :description="error"
      retry
      @retry="load"
    />
    <template v-else-if="devices && due">
      <dl class="ledger-metrics">
        <div v-for="metric in metrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ String(metric.value).padStart(2, '0') }}</dd>
        </div>
      </dl>
      <section class="recent-panel" aria-labelledby="my-recent-title">
        <div class="panel-heading">
          <h2 id="my-recent-title">近期事项</h2>
          <p>逾期与未来 30 天</p>
        </div>
        <ul v-if="due.items.length" class="due-list">
          <li
            v-for="item in due.items"
            :key="`${item.type}-${item.plan_id || item.device_id}`"
            class="due-item"
          >
            <img
              class="due-icon"
              :src="`/icons/${icons.get(item.device_id) || 'notebook-pen'}.svg`"
              alt=""
              width="24"
              height="24"
            />
            <div class="due-info">
              <h3>{{ item.device_name }} · {{ item.title }}</h3>
              <p>{{ item.due_on }}</p>
            </div>
            <div class="due-actions">
              <span class="ledger-tag" :class="{ 'is-overdue': item.status === 'overdue' }">{{
                item.label
              }}</span
              ><SiteButton
                :to="{ name: 'site-device-detail', params: { id: item.device_id } }"
                :aria-label="`查看${item.device_name}的${item.title}`"
                >查看 →</SiteButton
              >
            </div>
          </li>
        </ul>
        <div v-else class="no-due">
          <img src="/icons/calendar-check.svg" width="28" height="28" alt="" />
          <p>近期没有待处理事项。</p>
          <span>设备的保修与维护到期事项会显示在这里。</span>
        </div>
      </section>
      <section aria-labelledby="my-devices-title">
        <div class="device-list-heading">
          <h2 id="my-devices-title">
            设备台账 <span>/ {{ devices.total }} 台</span>
          </h2>
          <p>按创建时间排序</p>
        </div>
        <div v-if="devices.items.length" class="device-grid">
          <article v-for="device in devices.items" :key="device.id" class="device-card">
            <div class="device-card-top">
              <img
                :src="`/icons/${deviceIcon(device.category)}.svg`"
                alt=""
                width="32"
                height="32"
              /><span class="ledger-tag">{{ device.category_label }}</span>
            </div>
            <h3>{{ device.name }}</h3>
            <p class="device-model">{{ device.model || '未填写型号' }}</p>
            <div class="device-card-status">
              <p>{{ device.warranty_label }}</p>
              <p>{{ device.plan_count ? `${device.plan_count} 项维护计划` : '暂无维护计划' }}</p>
            </div>
            <SiteButton
              :to="{ name: 'site-device-detail', params: { id: device.id } }"
              :aria-label="`查看设备：${device.name}`"
              >查看设备 →</SiteButton
            >
          </article>
        </div>
        <div v-else class="empty-ledger">
          <img src="/icons/notebook-pen.svg" width="40" height="40" alt="" /><PageState
            kind="empty"
            title="还没有设备"
            description="名称即可开始，其他信息以后再补。"
            ><SiteButton to="/app/devices/new" variant="primary"
              >新增第一台设备</SiteButton
            ></PageState
          >
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.devices-page {
  padding-block: 44px 64px;
}
.ledger-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 0 0 28px;
}
.ledger-metrics > div {
  display: flex;
  flex-direction: row-reverse;
  justify-content: flex-end;
  align-items: center;
  gap: 20px;
  background: var(--site-soft);
  padding: 18px 24px;
  border-radius: var(--site-radius);
}
.ledger-metrics dt {
  color: var(--site-muted);
  font-size: 14px;
}
.ledger-metrics dd {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin: 0;
}
.recent-panel {
  padding: 28px;
  border: 1px solid var(--site-border);
  border-radius: 10px;
  background: var(--site-surface);
  margin-bottom: 28px;
}
.panel-heading,
.device-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.panel-heading h2 {
  font-size: 20px;
}
.panel-heading p,
.device-list-heading p {
  color: var(--site-muted);
  font-size: 13px;
}
.due-list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.due-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-block: 12px;
  border-top: 1px solid #e9eee6;
}
.due-icon {
  flex-shrink: 0;
}
.due-info {
  flex: 1;
  min-width: 0;
}
.due-info h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.due-info p {
  margin-top: 3px;
  color: var(--site-muted);
  font-size: 13px;
}
.due-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.ledger-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 5px;
  background: var(--site-soft);
  color: #577047;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.due-actions .ledger-tag {
  white-space: nowrap;
}
.ledger-tag.is-overdue {
  color: #92562e;
  background: #fbeee2;
}
.device-list-heading {
  margin-bottom: 28px;
}
.device-list-heading h2 {
  font-size: 22px;
}
.device-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.device-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 10px;
}
.device-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.device-card-top img {
  flex-shrink: 0;
}
.device-card h3 {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.device-model {
  color: var(--site-muted);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.device-card-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  flex: 1;
}
.device-card-status p + p {
  color: var(--site-muted);
  font-size: 13px;
}
.ledger-feedback {
  color: var(--site-accent);
  padding-bottom: 20px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.ledger-feedback.is-error {
  color: var(--site-danger);
}
.no-due {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-block: 36px 16px;
  text-align: center;
  color: var(--site-muted);
}
.no-due span {
  font-size: 13px;
}
.empty-ledger {
  padding-top: 40px;
  border: 1px dashed var(--site-border);
  border-radius: 10px;
  text-align: center;
}
.empty-ledger :deep(.page-state) {
  padding-top: 20px;
}
@media (max-width: 900px) {
  .devices-page :deep(.page-heading) {
    align-items: flex-start;
    flex-direction: column;
  }
  .ledger-metrics > div {
    padding: 16px;
    gap: 12px;
  }
  .device-grid {
    gap: 16px;
  }
  .device-card {
    padding: 20px;
  }
}
@media (max-width: 680px) {
  .devices-page {
    padding-block: 28px 40px;
  }
  .ledger-metrics {
    gap: 10px;
  }
  .ledger-metrics > div {
    flex-direction: column-reverse;
    gap: 4px;
    padding: 14px 8px;
  }
  .ledger-metrics dt {
    font-size: 12px;
  }
  .ledger-metrics dd {
    font-size: 26px;
  }
  .recent-panel {
    padding: 20px;
  }
  .panel-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .due-item {
    flex-wrap: wrap;
    gap: 10px;
  }
  .due-info {
    flex-basis: calc(100% - 40px);
  }
  .due-actions {
    width: 100%;
    justify-content: space-between;
    padding-left: 34px;
  }
  .due-actions :deep(.site-button) {
    min-height: 40px;
    padding: 8px 14px;
  }
  .device-grid {
    grid-template-columns: 1fr;
  }
  .device-list-heading {
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 20px;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import SiteButton from '../components/SiteButton.vue'
import PageHeading from '../components/PageHeading.vue'
import {
  createDemoDevices,
  demoCalendar,
  demoDaysUntil,
  demoDueItems,
  demoDueLabel,
  demoWarrantyLabel,
  type DemoDevice,
} from '../data/demo'

const devices = ref(createDemoDevices())
const items = computed(() => demoDueItems(devices.value))
const metrics = computed(() => [
  { label: '已记录设备', value: devices.value.length },
  { label: '维护计划', value: devices.value.reduce((sum, device) => sum + device.plans.length, 0) },
  {
    label: '保修将到期',
    value: devices.value.filter(
      (device) =>
        device.warrantyUntil &&
        demoDaysUntil(device.warrantyUntil) >= 0 &&
        demoDaysUntil(device.warrantyUntil) <= 30,
    ).length,
  },
])
const selected = ref<DemoDevice | null>(null)
const detailDialog = ref<HTMLDialogElement | null>(null)
const addDialog = ref<HTMLDialogElement | null>(null)
const name = ref('')
const category = ref('家电')
const model = ref('')
const formError = ref('')
const notice = ref('')
let deviceNumber = 0

async function viewDevice(device: DemoDevice) {
  selected.value = device
  await nextTick()
  detailDialog.value?.showModal()
}
function openAdd() {
  name.value = ''
  category.value = '家电'
  model.value = ''
  formError.value = ''
  addDialog.value?.showModal()
}
function addDevice() {
  if (!name.value.trim()) {
    formError.value = '请填写设备名称'
    return
  }
  const icons: Record<string, string> = { 家电: 'air-vent', 相机: 'camera', 电脑: 'laptop' }
  devices.value.push({
    id: `demo-new-${++deviceNumber}`,
    name: name.value.trim(),
    category: category.value,
    icon: icons[category.value] || 'notebook-pen',
    model: model.value.trim(),
    purchasedOn: '',
    warrantyUntil: '',
    plans: [],
  })
  addDialog.value?.close()
  notice.value = '已添加示例设备，仅在当前页面临时保存，刷新后重置。'
}
function exportCalendar() {
  const url = URL.createObjectURL(
    new Blob([demoCalendar(devices.value)], { type: 'text/calendar;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'device-ledger-demo.ics'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  notice.value = '已导出演示日历，仅包含固定示例日期之后 30 天内的事项。'
}
</script>

<template>
  <div class="demo-page site-container">
    <p class="demo-banner">
      <img src="/icons/info.svg" alt="" width="18" height="18" /><span
        >示例体验 · 以下均为合成数据，操作仅在本次浏览中演示。</span
      >
    </p>
    <PageHeading
      title="示例台账"
      description="2026年11月05日（示例日期） · 先体验，再建立自己的台账"
    >
      <template #actions
        ><SiteButton @click="exportCalendar">导出日历</SiteButton
        ><SiteButton variant="primary" @click="openAdd">+ 新增设备</SiteButton></template
      >
    </PageHeading>
    <p v-if="notice" class="demo-feedback" role="status">{{ notice }}</p>
    <dl class="demo-metrics">
      <div v-for="metric in metrics" :key="metric.label">
        <dt>{{ metric.label }}</dt>
        <dd>{{ String(metric.value).padStart(2, '0') }}</dd>
      </div>
    </dl>

    <section class="recent-panel" aria-labelledby="demo-recent-title">
      <div class="panel-heading">
        <h2 id="demo-recent-title">近期事项</h2>
        <p>逾期与未来 30 天</p>
      </div>
      <ul class="due-list">
        <li v-for="item in items" :key="item.id" class="due-item">
          <img
            class="due-icon"
            :src="`/icons/${item.device.icon}.svg`"
            alt=""
            width="24"
            height="24"
          />
          <div class="due-info">
            <h3>{{ item.device.name }} · {{ item.title }}</h3>
            <p>{{ item.dueOn }}</p>
          </div>
          <div class="due-actions">
            <span class="demo-tag" :class="{ 'is-overdue': demoDaysUntil(item.dueOn) < 0 }">{{
              demoDueLabel(item.dueOn)
            }}</span
            ><SiteButton
              :aria-label="`查看${item.device.name}的${item.title}`"
              @click="viewDevice(item.device)"
              >查看 →</SiteButton
            >
          </div>
        </li>
      </ul>
    </section>

    <section aria-labelledby="demo-devices-title">
      <div class="device-list-heading">
        <h2 id="demo-devices-title">
          设备台账 <span>/ {{ devices.length }} 台</span>
        </h2>
        <p>按创建时间排序</p>
      </div>
      <div class="demo-device-grid">
        <article v-for="device in devices" :key="device.id" class="demo-device-card">
          <div class="device-card-top">
            <img :src="`/icons/${device.icon}.svg`" alt="" width="32" height="32" /><span
              class="demo-tag"
              >{{ device.category }}</span
            >
          </div>
          <h3>{{ device.name }}</h3>
          <p class="device-model">{{ device.model || '未填写型号' }}</p>
          <div class="device-card-status">
            <p>{{ demoWarrantyLabel(device.warrantyUntil) }}</p>
            <p>{{ device.plans.length ? `${device.plans.length} 项维护计划` : '暂无维护计划' }}</p>
          </div>
          <SiteButton :aria-label="`查看设备：${device.name}`" @click="viewDevice(device)"
            >查看设备 →</SiteButton
          >
        </article>
      </div>
    </section>
    <p class="demo-banner invitation-note">
      <img src="/icons/info.svg" alt="" width="18" height="18" /><span
        >喜欢这样的记录方式？<RouterLink to="/register"
          >使用邀请码，开始建立自己的台账。 <span aria-hidden="true">↗</span></RouterLink
        ></span
      >
    </p>

    <dialog
      ref="detailDialog"
      class="demo-dialog"
      aria-labelledby="demo-detail-title"
      @close="selected = null"
    >
      <template v-if="selected">
        <div class="dialog-heading">
          <h2 id="demo-detail-title">{{ selected.name }}</h2>
          <button
            class="dialog-close"
            aria-label="关闭示例设备"
            autofocus
            @click="detailDialog?.close()"
          >
            ×
          </button>
        </div>
        <p class="dialog-intro">合成示例 · {{ selected.category }}</p>
        <dl class="demo-details">
          <div>
            <dt>型号</dt>
            <dd>{{ selected.model || '未填写' }}</dd>
          </div>
          <div>
            <dt>购买日期</dt>
            <dd>{{ selected.purchasedOn || '未填写' }}</dd>
          </div>
          <div>
            <dt>保修截止</dt>
            <dd>{{ selected.warrantyUntil || '未填写' }}</dd>
          </div>
        </dl>
        <h3 class="dialog-section-title">维护计划</h3>
        <ul v-if="selected.plans.length" class="demo-plans">
          <li v-for="plan in selected.plans" :key="plan.title">
            <div>
              <h4>{{ plan.title }}</h4>
              <p>每 {{ plan.intervalDays }} 天 · 下次 {{ plan.dueOn }}</p>
            </div>
            <span class="demo-tag" :class="{ 'is-overdue': demoDaysUntil(plan.dueOn) < 0 }">{{
              demoDueLabel(plan.dueOn)
            }}</span>
          </li>
        </ul>
        <p v-else class="dialog-intro">暂无维护计划。</p>
        <p class="dialog-footnote">以上为示例预览，不会读取或修改你的真实台账。</p>
        <div class="dialog-actions">
          <SiteButton @click="detailDialog?.close()">关闭预览</SiteButton
          ><SiteButton to="/register" variant="primary">通过邀请开始使用</SiteButton>
        </div>
      </template>
    </dialog>
    <dialog ref="addDialog" class="demo-dialog" aria-labelledby="demo-add-title">
      <form @submit.prevent="addDevice">
        <div class="dialog-heading">
          <h2 id="demo-add-title">新增示例设备</h2>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭新增示例设备"
            @click="addDialog?.close()"
          >
            ×
          </button>
        </div>
        <p class="dialog-intro">试着记录一台设备，仅在当前页面临时保存。</p>
        <div class="demo-field">
          <label for="demo-name">设备名称 *</label
          ><input
            id="demo-name"
            v-model="name"
            required
            maxlength="80"
            autofocus
            placeholder="例如：客厅空气净化器"
            :aria-invalid="!!formError"
            :aria-describedby="formError ? 'demo-form-error' : undefined"
          />
        </div>
        <div class="demo-field">
          <label for="demo-category">设备类别</label
          ><select id="demo-category" v-model="category">
            <option v-for="item in ['家电', '电脑', '相机', '数码', '其他']" :key="item">
              {{ item }}
            </option>
          </select>
        </div>
        <div class="demo-field">
          <label for="demo-model">型号（选填）</label
          ><input id="demo-model" v-model="model" maxlength="80" placeholder="填写品牌或型号" />
        </div>
        <p v-if="formError" id="demo-form-error" class="demo-form-error" role="alert">
          {{ formError }}
        </p>
        <div class="dialog-actions">
          <SiteButton @click="addDialog?.close()">取消</SiteButton
          ><SiteButton type="submit" variant="primary">保存示例设备</SiteButton>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.demo-page {
  padding-block: 44px 64px;
}
.demo-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: var(--site-radius);
  background: #eff4ec;
  color: #597050;
  font-size: 14px;
  margin-bottom: 28px;
}
.demo-banner img {
  flex-shrink: 0;
}
.demo-page :deep(.page-heading) {
  margin-bottom: 28px;
}
.demo-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 0 0 28px;
}
.demo-metrics > div {
  display: flex;
  flex-direction: row-reverse;
  justify-content: flex-end;
  align-items: center;
  gap: 20px;
  background: var(--site-soft);
  padding: 18px 24px;
  border-radius: var(--site-radius);
}
.demo-metrics dt {
  color: var(--site-muted);
  font-size: 14px;
}
.demo-metrics dd {
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
.demo-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 5px;
  background: var(--site-soft);
  color: #577047;
  font-size: 13px;
  white-space: nowrap;
}
.demo-tag.is-overdue {
  color: #92562e;
  background: #fbeee2;
}
.device-list-heading {
  margin-bottom: 28px;
}
.device-list-heading h2 {
  font-size: 22px;
}
.device-list-heading h2 span {
  font-size: inherit;
  font-weight: inherit;
}
.demo-device-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.demo-device-card {
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
.demo-device-card h3 {
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
.invitation-note {
  margin: 28px 0 0;
}
.invitation-note a {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.demo-feedback {
  color: var(--site-accent);
  padding: 0 0 20px;
  font-size: 14px;
}
.demo-dialog {
  width: min(580px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  padding: 28px;
  border: 1px solid var(--site-border);
  border-radius: 12px;
  background: var(--site-surface);
  color: var(--site-text);
  overflow-y: auto;
}
.demo-dialog::backdrop {
  background: #172c2366;
}
.dialog-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.dialog-heading h2 {
  overflow-wrap: anywhere;
}
.dialog-close {
  border: 0;
  border-radius: 5px;
  color: var(--site-muted);
  background: transparent;
  font-size: 26px;
  line-height: 1;
  padding: 8px;
  min-width: 40px;
  min-height: 40px;
}
.dialog-close:hover {
  background: var(--site-soft);
}
.dialog-intro {
  color: var(--site-muted);
  font-size: 14px;
  margin-block: 12px 24px;
}
.demo-details {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
}
.demo-details > div {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 16px;
}
.demo-details dt {
  color: var(--site-muted);
}
.demo-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.dialog-section-title {
  font-size: 18px;
  margin: 28px 0 16px;
}
.demo-plans {
  padding: 0;
  margin: 0;
  list-style: none;
}
.demo-plans li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px;
  background: var(--site-bg);
  border-radius: 8px;
}
.demo-plans h4 {
  margin: 0 0 6px;
  font-size: 15px;
}
.demo-plans p,
.dialog-footnote {
  color: var(--site-muted);
  font-size: 13px;
}
.dialog-footnote {
  margin-top: 24px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}
.demo-field {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}
.demo-field label {
  font-size: 14px;
}
.demo-field input,
.demo-field select {
  width: 100%;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--site-border);
  border-radius: 7px;
  background: var(--site-surface);
  color: var(--site-text);
}
.demo-field input::placeholder {
  color: var(--site-muted);
}
.demo-form-error {
  color: var(--site-danger);
  font-size: 14px;
}
@media (max-width: 900px) {
  .demo-page :deep(.page-heading) {
    align-items: flex-start;
    flex-direction: column;
  }
  .demo-metrics > div {
    padding: 16px;
    gap: 12px;
  }
  .demo-device-grid {
    gap: 16px;
  }
  .demo-device-card {
    padding: 20px;
  }
}
@media (max-width: 680px) {
  .demo-page {
    padding-block: 28px 40px;
  }
  .demo-banner {
    align-items: flex-start;
    font-size: 13px;
  }
  .demo-banner img {
    margin-top: 2px;
  }
  .demo-metrics {
    gap: 10px;
  }
  .demo-metrics > div {
    flex-direction: column-reverse;
    gap: 4px;
    padding: 14px 8px;
  }
  .demo-metrics dt {
    font-size: 12px;
  }
  .demo-metrics dd {
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
  .demo-device-grid {
    grid-template-columns: 1fr;
  }
  .device-list-heading {
    gap: 10px;
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 20px;
  }
  .demo-dialog {
    padding: 22px;
  }
  .demo-plans li {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

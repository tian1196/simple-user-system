<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import SiteButton from '../components/SiteButton.vue'
import PageState from '../components/PageState.vue'
import DeviceForm from '../components/DeviceForm.vue'
import { SiteApiError } from '../api/request'
import {
  getDevice,
  updateDevice,
  deleteDevice,
  createPlan,
  updatePlan,
  deletePlan,
  completePlan,
  createManualLog,
  voidLog,
  type DeviceDetail,
  type DeviceInput,
  type MaintenancePlan,
  type MaintenanceLog,
} from '../api/devices'
import { deviceIcon } from '../utils/devices'
import { isLedgerDate, ledgerToday } from '../utils/device-form'

type ModalMode =
  | 'editDevice'
  | 'addPlan'
  | 'editPlan'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'manual'
  | 'deletePlan'
  | 'void'
  | 'deleteDevice'
const route = useRoute()
const router = useRouter()
const data = ref<DeviceDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const notFound = ref(false)
const notice = ref('')
const busy = ref(false)
const mode = ref<ModalMode | null>(null)
const modal = ref<HTMLDialogElement | null>(null)
const error = ref('')
const conflict = ref(false)
const errorElement = ref<HTMLElement | null>(null)
const selectedPlan = ref<MaintenancePlan | null>(null)
const selectedLog = ref<MaintenanceLog | null>(null)
const fields = reactive({ title: '', interval: 180, date: '', note: '' })
let requestKey = ''
let controller: AbortController | undefined
const modalTitle = computed(
  () =>
    ({
      editDevice: '编辑设备',
      addPlan: '添加维护计划',
      editPlan: '编辑维护计划',
      pause: '暂停维护计划？',
      resume: '恢复维护计划',
      complete: '完成维护',
      manual: '手工登记维护',
      deletePlan: '删除维护计划？',
      void: '撤销这条维护记录？',
      deleteDevice: '删除设备及关联数据？',
    })[mode.value || 'editDevice'],
)
const planForm = computed(() => mode.value === 'addPlan' || mode.value === 'editPlan')
const recordForm = computed(() => mode.value === 'complete' || mode.value === 'manual')
const destructive = computed(() =>
  ['deleteDevice', 'deletePlan', 'void'].includes(mode.value || ''),
)
const confirmsOnly = computed(() =>
  ['pause', 'deleteDevice', 'deletePlan', 'void'].includes(mode.value || ''),
)
const confirmText = computed(() =>
  mode.value === 'deleteDevice'
    ? '计划和维护历史也会一并删除，没有回收站。'
    : mode.value === 'deletePlan'
      ? '历史记录会留下，但不再修改这个计划的日期。'
      : mode.value === 'void'
        ? '记录会保留撤销标记。如果来自维护计划，下次日期将退回登记前。'
        : '暂停后，该计划不再出现在近期事项中，可以随时恢复。',
)
const submitLabel = computed(() =>
  mode.value === 'complete' || mode.value === 'manual'
    ? '确认登记'
    : mode.value === 'resume'
      ? '恢复计划'
      : mode.value === 'pause'
        ? '确认暂停'
        : mode.value === 'void'
          ? '确认撤销'
          : destructive.value
            ? '确认删除'
            : '保存计划',
)

onBeforeRouteLeave((to) => !busy.value || to.name === 'site-login')
onBeforeRouteUpdate(() => !busy.value)
watch(
  () => route.params.id,
  () => {
    closeModal()
    data.value = null
    notice.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  loadError.value = ''
  notFound.value = false
  try {
    const result = await getDevice(String(route.params.id), current.signal)
    if (!current.signal.aborted) data.value = result
  } catch (cause) {
    if (!current.signal.aborted) {
      loadError.value = cause instanceof Error ? cause.message : '设备加载失败'
      notFound.value = cause instanceof SiteApiError && cause.status === 404
    }
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
async function openModal(next: ModalMode, plan?: MaintenancePlan, log?: MaintenanceLog) {
  if (busy.value) return
  mode.value = next
  selectedPlan.value = plan || null
  selectedLog.value = log || null
  fields.title = plan?.title || ''
  fields.interval = plan?.interval_days || 180
  fields.date =
    next === 'complete' || next === 'manual' ? ledgerToday() : plan?.next_due_on || ledgerToday()
  fields.note = ''
  error.value = ''
  conflict.value = false
  requestKey =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  await nextTick()
  modal.value?.showModal()
}
function closeModal() {
  if (!busy.value) {
    modal.value?.close()
    mode.value = null
  }
}
function onClosed() {
  mode.value = null
  error.value = ''
  conflict.value = false
}
async function report(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '操作失败，请稍后重试'
  conflict.value =
    cause instanceof SiteApiError && (cause.status === 409 || cause.code === 'ACTION_NOT_ALLOWED')
  await nextTick()
  errorElement.value?.focus()
}
async function changed(message: string) {
  busy.value = false
  closeModal()
  notice.value = message
  await load()
}
async function saveDevice(values: DeviceInput) {
  if (busy.value || !data.value) return
  busy.value = true
  error.value = ''
  conflict.value = false
  try {
    await updateDevice(data.value.device.id, { ...values, version: data.value.device.version })
    await changed('设备已保存')
  } catch (cause) {
    await report(cause)
  } finally {
    busy.value = false
  }
}
async function submit() {
  if (busy.value || !data.value || !mode.value) return
  error.value = ''
  conflict.value = false
  if (
    (planForm.value || mode.value === 'manual') &&
    (!fields.title.trim() || fields.title.trim().length > 80)
  ) {
    await report(new Error('维护事项需为 1–80 字'))
    return
  }
  if (
    planForm.value &&
    (!Number.isInteger(Number(fields.interval)) ||
      Number(fields.interval) < 1 ||
      Number(fields.interval) > 3650)
  ) {
    await report(new Error('周期需为 1–3650 的整数天'))
    return
  }
  if (
    (planForm.value || recordForm.value || mode.value === 'resume') &&
    !isLedgerDate(fields.date)
  ) {
    await report(new Error('请填写有效日期'))
    return
  }
  if (recordForm.value && fields.date > ledgerToday()) {
    await report(new Error('完成日不能晚于今天'))
    return
  }
  busy.value = true
  const plan = selectedPlan.value
  const device = data.value.device
  try {
    if (planForm.value) {
      const payload = {
        title: fields.title.trim(),
        interval_days: Number(fields.interval),
        next_due_on: fields.date,
      }
      if (mode.value === 'editPlan' && plan)
        await updatePlan(plan.id, { ...payload, version: plan.version })
      else await createPlan(device.id, payload)
    } else if ((mode.value === 'pause' || mode.value === 'resume') && plan) {
      await updatePlan(plan.id, {
        version: plan.version,
        status: mode.value === 'pause' ? 'paused' : 'active',
        ...(mode.value === 'resume' ? { next_due_on: fields.date } : {}),
      })
    } else if (mode.value === 'complete' && plan) {
      const result = await completePlan(plan.id, {
        completed_on: fields.date,
        note: fields.note.trim(),
        request_key: requestKey,
        version: plan.version,
      })
      await changed(`已登记，下次维护日期为 ${result.plan.next_due_on}`)
      return
    } else if (mode.value === 'manual') {
      await createManualLog(device.id, {
        title: fields.title.trim(),
        completed_on: fields.date,
        note: fields.note.trim(),
        request_key: requestKey,
      })
    } else if (mode.value === 'deletePlan' && plan) await deletePlan(plan.id, plan.version)
    else if (mode.value === 'void' && selectedLog.value) await voidLog(selectedLog.value.id)
    else if (mode.value === 'deleteDevice') {
      await deleteDevice(device.id, device.version)
      busy.value = false
      closeModal()
      await router.replace('/app')
      return
    }
    await changed('操作成功，设备信息已更新')
  } catch (cause) {
    await report(cause)
  } finally {
    busy.value = false
  }
}
async function refreshConflict() {
  closeModal()
  await load()
}
</script>

<template>
  <div class="detail-page site-container">
    <RouterLink class="back-link" to="/app">← 我的设备</RouterLink>
    <PageState v-if="loading" kind="loading" title="正在加载设备…" />
    <PageState
      v-else-if="loadError"
      kind="error"
      :title="notFound ? '设备不存在或已删除' : '暂时无法加载设备'"
      :description="loadError"
      :retry="!notFound"
      @retry="load"
      ><SiteButton v-if="notFound" to="/app">返回我的设备</SiteButton></PageState
    >
    <template v-else-if="data">
      <div class="detail-heading">
        <div class="device-identity">
          <span class="identity-icon"
            ><img
              :src="`/icons/${deviceIcon(data.device.category)}.svg`"
              width="34"
              height="34"
              alt=""
          /></span>
          <div>
            <h1>{{ data.device.name }}</h1>
            <p>{{ data.device.category_label }} / 私人设备</p>
          </div>
        </div>
        <SiteButton @click="openModal('editDevice')">编辑设备</SiteButton>
      </div>
      <p v-if="notice" class="detail-feedback" role="status">{{ notice }}</p>
      <div class="detail-columns">
        <div class="maintenance-column">
          <section class="detail-panel" aria-labelledby="plans-title">
            <div class="panel-heading">
              <h2 id="plans-title">维护计划</h2>
              <SiteButton :disabled="data.plans.length >= 5" @click="openModal('addPlan')"
                >+ 添加计划</SiteButton
              >
            </div>
            <template v-if="data.plans.length"
              ><article v-for="plan in data.plans" :key="plan.id" class="plan-card">
                <div class="plan-heading">
                  <h3>{{ plan.title }}</h3>
                  <span
                    class="detail-tag"
                    :class="{
                      'is-overdue': plan.due_status === 'overdue',
                      'is-paused': plan.status === 'paused',
                    }"
                    >{{ plan.due_label }}</span
                  >
                </div>
                <p>每 {{ plan.interval_days }} 天 · 下次 {{ plan.next_due_on }}</p>
                <div class="plan-actions">
                  <SiteButton
                    variant="primary"
                    :disabled="plan.status === 'paused'"
                    @click="openModal('complete', plan)"
                    >完成维护</SiteButton
                  ><SiteButton @click="openModal('editPlan', plan)">编辑</SiteButton
                  ><SiteButton
                    @click="openModal(plan.status === 'paused' ? 'resume' : 'pause', plan)"
                    >{{ plan.status === 'paused' ? '恢复' : '暂停' }}</SiteButton
                  ><SiteButton variant="danger" @click="openModal('deletePlan', plan)"
                    >删除</SiteButton
                  >
                </div>
              </article>
              <p class="panel-footnote">
                完成后将保留处理记录，并计算下一次维护日期。<span v-if="data.plans.length >= 5"
                  >每台设备最多 5 个维护计划。</span
                >
              </p></template
            >
            <div v-else class="empty-section">
              <p>还没有维护计划</p>
              <span>按实际需要添加，不必为每件设备设置。</span>
            </div>
          </section>
          <section class="detail-panel" aria-labelledby="history-title">
            <div class="panel-heading">
              <h2 id="history-title">维护历史</h2>
              <SiteButton @click="openModal('manual')">+ 手工记录</SiteButton>
            </div>
            <ul v-if="data.logs.length" class="history-list">
              <li v-for="log in data.logs" :key="log.id" :class="{ 'voided-log': log.voided_at }">
                <div class="history-info">
                  <h3>
                    {{ log.title }}
                    <span v-if="log.voided_at" class="detail-tag is-paused">已撤销</span>
                  </h3>
                  <p>
                    {{ log.completed_on }} · {{ log.source === 'manual' ? '手工记录' : '计划维护' }}
                  </p>
                  <p v-if="log.note" class="log-note">{{ log.note }}</p>
                </div>
                <SiteButton
                  v-if="log.can_void && !log.voided_at"
                  @click="openModal('void', undefined, log)"
                  >撤销</SiteButton
                >
              </li>
            </ul>
            <div v-else class="empty-section">
              <p>还没有维护记录。</p>
              <span>每一次维护，都会成为设备的使用历史。</span>
            </div>
          </section>
        </div>
        <aside class="info-column">
          <section class="detail-panel" aria-labelledby="info-title">
            <h2 id="info-title">设备信息</h2>
            <dl class="device-properties">
              <div>
                <dt>型号</dt>
                <dd>{{ data.device.model || '未填写' }}</dd>
              </div>
              <div>
                <dt>购买日期</dt>
                <dd>{{ data.device.purchased_on || '未知' }}</dd>
              </div>
              <div>
                <dt>保修截止</dt>
                <dd>{{ data.device.warranty_until || '未知' }}</dd>
              </div>
            </dl>
            <span class="detail-tag">{{ data.device.warranty_label }}</span>
            <p class="device-note">{{ data.device.note || '暂无备注' }}</p>
            <p class="panel-footnote">保修信息由你记录，以厂家实际规则为准。</p>
          </section>
          <section class="detail-panel danger-panel">
            <h2>删除设备</h2>
            <p>同时删除此设备的维护计划和历史，无回收站。</p>
            <SiteButton variant="danger" @click="openModal('deleteDevice')">删除设备</SiteButton>
          </section>
        </aside>
      </div>
    </template>
    <dialog
      ref="modal"
      class="detail-dialog"
      aria-labelledby="device-modal-title"
      @cancel="busy && $event.preventDefault()"
      @close="onClosed"
    >
      <template v-if="mode && data"
        ><div class="modal-heading">
          <h2 id="device-modal-title">{{ modalTitle }}</h2>
          <button
            class="modal-close"
            type="button"
            :disabled="busy"
            aria-label="关闭操作窗口"
            @click="closeModal"
          >
            ×
          </button>
        </div>
        <template v-if="mode === 'editDevice'"
          ><DeviceForm
            :device="data.device"
            :busy="busy"
            :error="error"
            @submit="saveDevice"
            @cancel="closeModal"
          /><SiteButton v-if="conflict" class="conflict-button" @click="refreshConflict"
            >关闭并刷新最新数据</SiteButton
          ></template
        >
        <form v-else @submit.prevent="submit" :aria-busy="busy">
          <fieldset :disabled="busy || conflict">
            <legend class="sr-only">{{ modalTitle }}</legend>
            <p v-if="confirmsOnly" class="modal-description">{{ confirmText }}</p>
            <p
              v-if="selectedPlan && (mode === 'complete' || mode === 'resume')"
              class="modal-description"
            >
              {{ selectedPlan.title }} · 每 {{ selectedPlan.interval_days }} 天
            </p>
            <div v-if="planForm || mode === 'manual'" class="modal-field">
              <label for="maintenance-title">维护事项 *</label
              ><input id="maintenance-title" v-model="fields.title" required maxlength="80" />
            </div>
            <div v-if="planForm" class="modal-field">
              <label for="maintenance-interval">周期天数 *</label
              ><input
                id="maintenance-interval"
                v-model.number="fields.interval"
                type="number"
                required
                min="1"
                max="3650"
                step="1"
              />
            </div>
            <div v-if="!confirmsOnly" class="modal-field">
              <label for="maintenance-date">{{
                recordForm ? '实际完成日期 *' : '下次到期日 *'
              }}</label
              ><input
                id="maintenance-date"
                v-model="fields.date"
                type="date"
                required
                :max="recordForm ? ledgerToday() : undefined"
              />
            </div>
            <div v-if="recordForm" class="modal-field">
              <label for="maintenance-note">备注</label
              ><textarea id="maintenance-note" v-model="fields.note" maxlength="500" rows="3" />
            </div>
            <p v-if="mode === 'complete'" class="panel-footnote">
              下次到期按完成日加周期计算，不补造中间记录。
            </p>
            <p v-if="planForm" class="panel-footnote">
              按自然日计算。修改周期时请同时确认新的到期日。
            </p>
          </fieldset>
          <p v-if="error" ref="errorElement" class="modal-error" role="alert" tabindex="-1">
            {{ error }}
          </p>
          <SiteButton v-if="conflict" @click="refreshConflict">关闭并刷新最新数据</SiteButton>
          <div class="modal-actions">
            <SiteButton :disabled="busy" @click="closeModal">取消</SiteButton
            ><SiteButton
              type="submit"
              :variant="destructive ? 'danger' : 'primary'"
              :disabled="conflict"
              :loading="busy"
              >{{ busy ? '正在处理…' : submitLabel }}</SiteButton
            >
          </div>
        </form>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.detail-page {
  padding-block: 40px 64px;
}
.back-link {
  display: inline-block;
  margin-bottom: 28px;
  color: var(--site-muted);
  font-size: 14px;
}
.back-link:hover {
  text-decoration: underline;
}
.detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}
.device-identity {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}
.device-identity h1 {
  overflow-wrap: anywhere;
}
.device-identity p {
  color: var(--site-muted);
  margin-top: 8px;
}
.identity-icon {
  display: grid;
  place-items: center;
  padding: 18px;
  background: #eaf1e5;
  border-radius: 12px;
  flex-shrink: 0;
}
.detail-columns {
  display: grid;
  grid-template-columns: minmax(0, 780fr) minmax(0, 440fr);
  gap: 28px;
  align-items: start;
}
.maintenance-column,
.info-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.detail-panel {
  padding: 28px;
  border: 1px solid var(--site-border);
  border-radius: 10px;
  background: var(--site-surface);
}
.detail-panel h2 {
  font-size: 21px;
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.plan-card {
  padding: 22px;
  background: #f8faf6;
  border-radius: 8px;
  margin-bottom: 18px;
}
.plan-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.plan-heading h3 {
  font-size: 20px;
  margin: 0;
  overflow-wrap: anywhere;
}
.plan-card > p {
  font-size: 14px;
  color: var(--site-muted);
  margin-block: 18px;
}
.plan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.plan-actions :deep(.site-button) {
  padding: 10px 16px;
}
.detail-tag {
  display: inline-block;
  padding: 4px 10px;
  font-size: 13px;
  border-radius: 5px;
  color: #577047;
  background: var(--site-soft);
}
.plan-heading .detail-tag {
  flex-shrink: 0;
}
.detail-tag.is-overdue {
  color: #92562e;
  background: #fbeee2;
}
.detail-tag.is-paused {
  color: var(--site-muted);
  background: #eef0ed;
}
.panel-footnote {
  color: var(--site-muted);
  font-size: 13px;
}
.history-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.history-list > li {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-block: 20px;
  border-top: 1px solid var(--site-border);
}
.history-info {
  flex: 1;
  min-width: 0;
}
.history-info h3 {
  font-size: 16px;
  margin: 0 0 6px;
  overflow-wrap: anywhere;
}
.history-info p {
  font-size: 14px;
  color: var(--site-muted);
}
.log-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 8px;
}
.voided-log h3 {
  color: var(--site-muted);
}
.device-properties {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-block: 24px;
}
.device-properties > div {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 12px;
  font-size: 14px;
}
.device-properties dt {
  color: var(--site-muted);
}
.device-properties dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.device-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-top: 1px solid var(--site-border);
  padding-top: 20px;
  margin-block: 20px;
  color: var(--site-muted);
  font-size: 14px;
}
.danger-panel p {
  color: var(--site-muted);
  font-size: 14px;
  margin-block: 16px 20px;
}
.empty-section {
  text-align: center;
  padding: 32px 12px;
  color: var(--site-muted);
}
.empty-section span {
  display: block;
  margin-top: 10px;
  font-size: 13px;
}
.detail-feedback {
  margin-bottom: 24px;
  color: var(--site-accent);
}
.detail-dialog {
  width: min(620px, calc(100% - 32px));
  padding: 28px;
  max-height: calc(100dvh - 48px);
  border: 1px solid var(--site-border);
  border-radius: 12px;
  background: var(--site-surface);
  color: var(--site-text);
  overflow-y: auto;
}
.detail-dialog::backdrop {
  background: #172c2366;
}
.modal-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.modal-heading h2 {
  font-size: 24px;
}
.modal-close {
  padding: 6px;
  width: 40px;
  height: 40px;
  font-size: 26px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: var(--site-muted);
}
.modal-close:hover {
  background: var(--site-soft);
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.modal-field label {
  font-size: 14px;
}
.modal-field input,
.modal-field textarea {
  width: 100%;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--site-border);
  border-radius: 7px;
  color: var(--site-text);
  background: var(--site-surface);
}
.modal-field textarea {
  resize: vertical;
}
.modal-description {
  color: var(--site-muted);
  margin-bottom: 20px;
}
.modal-actions {
  display: flex;
  justify-content: end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
.modal-error {
  margin-block: 18px;
  color: var(--site-danger);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.conflict-button {
  margin-top: 18px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 1000px) {
  .detail-columns {
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 20px;
  }
  .detail-panel {
    padding: 22px;
  }
}
@media (max-width: 760px) {
  .detail-page {
    padding-block: 28px 40px;
  }
  .detail-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 20px;
  }
  .identity-icon {
    padding: 14px;
  }
  .plan-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .panel-heading {
    flex-wrap: wrap;
  }
  .plan-card {
    padding: 18px;
  }
  .detail-dialog {
    padding: 22px;
  }
  .modal-field input,
  .modal-field textarea {
    font-size: 16px;
  }
}
</style>

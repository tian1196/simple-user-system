<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import PageState from '../components/PageState.vue'
import SiteButton from '../components/SiteButton.vue'
import { useRemindersStore } from '../stores/reminders'
import { restoreReminder, snoozeReminder, type ReminderFilter, type ReminderItem } from '../api/reminders'
import { completePlan } from '../api/devices'
import { SiteApiError } from '../api/request'
import { ledgerToday } from '../utils/device-form'
const store = useRemindersStore()
const filter = ref<ReminderFilter>('all')
const labels: Record<ReminderFilter, string> = { all: '全部', overdue: '已逾期', today: '今天', upcoming: '即将到期', snoozed: '已暂缓' }
const selected = ref<ReminderItem | null>(null)
const mode = ref<'snooze' | 'complete' | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const pageFocus = ref<HTMLElement | null>(null)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
const stale = ref(false)
const notice = ref('')
const days = ref(1)
const completedOn = ref('')
const note = ref('')
let requestKey = ''
let active = true
const trigger = ref<HTMLElement | null>(null)
const errorFocus = ref<HTMLElement | null>(null)
const items = computed(() => (store.data?.items || []).filter(item => {
  if (filter.value === 'snoozed') return Boolean(item.snoozed_until)
  if (item.snoozed_until) return false
  if (filter.value === 'upcoming') return item.status === 'upcoming'
  return item.in_window && (filter.value === 'all' || item.status === filter.value)
}))
const groups = computed(() => filter.value === 'all'
  ? (['overdue', 'today', 'upcoming'] as const).map(status => ({ title: labels[status], items: items.value.filter(item => item.status === status) })).filter(group => group.items.length)
  : [{ title: labels[filter.value], items: items.value }])
function plusDays(value: number) {
  const today = store.data?.today || ledgerToday()
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + value)
  return date.toISOString().slice(0, 10)
}
function allowed(value: number) { return selected.value?.type !== 'warranty' || plusDays(value) <= selected.value.due_on }
async function open(item: ReminderItem, next: 'snooze' | 'complete', event: Event) {
  if (busy.value) return
  trigger.value = event.currentTarget as HTMLElement
  selected.value = { ...item }
  mode.value = next
  days.value = 1
  completedOn.value = ledgerToday()
  note.value = ''
  error.value = ''
  stale.value = false
  requestKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  await nextTick()
  dialog.value?.showModal()
}
function close() {
  if (busy.value) return
  dialog.value?.close()
  mode.value = null
  selected.value = null
  if (trigger.value?.isConnected) trigger.value.focus()
  else pageFocus.value?.focus()
}
async function fail(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  stale.value = cause instanceof SiteApiError && [404, 409].includes(cause.status)
  if (stale.value) await store.refresh()
  await nextTick()
  errorFocus.value?.focus()
}
async function submit() {
  const item = selected.value
  if (busy.value || !item || stale.value) return
  busy.value = true
  error.value = ''
  actionError.value = ''
  notice.value = ''
  try {
    if (mode.value === 'snooze') {
      if (!allowed(days.value)) throw new Error('暂缓日期不能超过保修截止日')
      const data = await snoozeReminder(item, days.value)
      if (!active) return
      store.apply(data)
      filter.value = 'snoozed'
      notice.value = `已暂缓至 ${plusDays(days.value)} 00:00；原到期日保持不变。`
    } else {
      if (!completedOn.value || completedOn.value > ledgerToday()) throw new Error('请选择不晚于今天的完成日期')
      const result = await completePlan(item.target_id, { version: item.source_version, completed_on: completedOn.value, note: note.value, request_key: requestKey })
      if (!active) return
      notice.value = `已登记完成，下次维护日期为 ${result.plan.next_due_on}。`
      await store.refresh()
    }
    busy.value = false
    close()
  } catch (cause) { if (active) await fail(cause) }
  finally { if (active) busy.value = false }
}
async function restore(item: ReminderItem) {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  notice.value = ''
  try {
    const data = await restoreReminder(item)
    if (!active) return
    store.apply(data)
    notice.value = '已恢复提醒，原到期日保持不变。'
  } catch (cause) {
    if (!active) return
    actionError.value = cause instanceof Error ? cause.message : '恢复失败，请重试'
    if (cause instanceof SiteApiError && [404, 409].includes(cause.status)) await store.refresh()
  } finally { if (active) busy.value = false }
}
onBeforeUnmount(() => { active = false; dialog.value?.close() })
</script>
<template>
  <div ref="pageFocus" class="reminders-page site-container" tabindex="-1">
    <PageHeading title="待办提醒" :description="store.data ? `${store.data.counts.overdue} 项已逾期，${store.data.counts.today} 项今天到期。先照顾好眼前的设备。` : '保修与维护事项，集中查看。'">
      <template #actions><SiteButton to="/app/reminders/settings">提醒设置</SiteButton></template>
    </PageHeading>
    <p v-if="store.data" class="reminder-meta">{{ store.data.today }} · 按北京时间计算 · 查看未来30天及未完成的逾期维护</p>
    <p v-if="notice" class="reminder-notice" role="status">{{ notice }}</p>
    <p v-if="actionError" class="reminder-error" role="alert">{{ actionError }}</p>
    <PageState v-if="store.loading && !store.data" kind="loading" title="正在加载待办" />
    <div v-if="store.error" class="reminder-error" role="alert"><p>{{ store.error }}{{ store.data ? ' · 以下内容尚未更新。' : '' }}</p><SiteButton :loading="store.loading" @click="store.refresh">重新加载</SiteButton></div>
    <template v-if="store.data">
      <div class="reminder-filters" role="group" aria-label="待办筛选">
        <button v-for="(label, key) in labels" :key="key" type="button" :aria-pressed="filter === key" :class="{ selected: filter === key }" @click="filter = key">{{ label }} <span>{{ store.data.counts[key] }}</span></button>
      </div>
      <p v-if="filter === 'upcoming'" class="muted reminder-filter-help">未来30天的未暂缓事项。尚未进入提醒窗口的事项不计入导航角标。</p>
      <p v-if="filter === 'snoozed'" class="muted reminder-filter-help">暂缓期间不计入角标；到恢复日00:00重新提示。暂缓不改变到期日。</p>
      <div class="reminder-columns">
        <div class="reminder-panel reminder-list">
          <PageState v-if="!items.length" kind="empty" :title="filter === 'all' ? '眼前没有需要处理的事项' : `暂无${labels[filter]}事项`" description="可以查看设备，或调整提醒设置；已暂缓的事项仍可单独查看。"><SiteButton to="/app">查看设备</SiteButton><SiteButton to="/app/reminders/settings">提醒设置</SiteButton></PageState>
          <section v-for="group in groups.filter(g => g.items.length)" :key="group.title" class="reminder-group" :aria-label="group.title">
            <h2>{{ group.title }} <span>{{ group.items.length }} 项</span></h2>
            <ul>
              <li v-for="item in group.items" :key="`${item.type}:${item.target_id}`" class="reminder-item">
                <div class="reminder-item-head"><div><h3>{{ item.device_name }} · {{ item.title }}</h3><p class="muted small">{{ item.type === 'plan' ? '维护到期' : '保修截止' }} · {{ item.due_on }}</p></div><span class="reminder-tag" :class="`status-${item.status}`">{{ item.label }}</span></div>
                <p v-if="item.snoozed_until" class="reminder-snoozed">{{ item.snoozed_until }} 00:00 恢复站内提示</p>
                <p v-else-if="!item.in_window" class="muted small">尚未进入提醒窗口，不计入角标。</p>
                <p v-if="item.type === 'warranty' && item.due_on === store.data.today" class="muted small">保修截止当天不能暂缓到未来。</p>
                <div class="reminder-actions">
                  <SiteButton v-if="item.snoozed_until" variant="primary" :disabled="busy" @click="restore(item)">恢复提醒</SiteButton>
                  <SiteButton v-if="item.type === 'plan'" :variant="item.snoozed_until ? 'secondary' : 'primary'" :disabled="busy" @click="open(item, 'complete', $event)">登记完成</SiteButton>
                  <SiteButton v-if="!item.snoozed_until && item.in_window" :disabled="busy || (item.type === 'warranty' && item.due_on === store.data.today)" :title="item.type === 'warranty' && item.due_on === store.data.today ? '保修截止当天不能暂缓到未来' : undefined" @click="open(item, 'snooze', $event)">稍后提醒</SiteButton>
                  <SiteButton :to="{ name: 'site-device-detail', params: { id: item.device_id } }">查看设备</SiteButton>
                </div>
              </li>
            </ul>
          </section>
        </div>
        <aside class="reminder-aside"><div class="reminder-panel"><span class="reminder-tag">站内提醒</span><h2>角标里的事项，是什么？</h2><p>已进入提醒窗口、且未暂缓的事项。</p><p>当前保修{{ store.data.settings.warranty_enabled ? `提前 ${store.data.settings.warranty_days} 天` : '提醒已关闭' }}，维护{{ store.data.settings.maintenance_enabled ? `提前 ${store.data.settings.maintenance_days} 天` : '提醒已关闭' }}。更远的事项可切到“即将到期”查看。</p></div><h2>稍后提醒，不改变到期日</h2><p>打开页面不会清除待办。登记维护完成后，本次事项结束，并按计划计算下次日期。</p><p>暂停的计划不提醒，过保后不再持续催办。当前仅站内展示，离开网站不会收到站外通知。</p></aside>
      </div>
    </template>
    <dialog ref="dialog" class="reminder-dialog" aria-labelledby="reminder-dialog-title" @cancel.prevent="close" @close="mode = null">
      <form v-if="selected" @submit.prevent="submit">
        <div class="reminder-item-head"><h2 id="reminder-dialog-title">{{ mode === 'snooze' ? '稍后提醒' : '登记维护完成' }}</h2><button type="button" class="reminder-close" aria-label="关闭弹窗" :disabled="busy" @click="close">×</button></div>
        <h3>{{ selected.device_name }} · {{ selected.title }}</h3><p class="muted small">原到期日 {{ selected.due_on }} · {{ selected.label }}</p>
        <p v-if="error" ref="errorFocus" tabindex="-1" class="reminder-error" role="alert">{{ error }}</p>
        <fieldset :disabled="busy || stale">
          <template v-if="mode === 'snooze'"><legend>什么时候恢复站内提示？</legend><div class="snooze-options"><label v-for="value in [1, 3, 7]" :key="value" :class="{ selected: days === value, unavailable: !allowed(value) }"><input v-model="days" type="radio" name="snooze-days" :value="value" :disabled="!allowed(value)" /><strong>{{ value === 1 ? '明天再提醒' : `${value}天后` }}</strong><span>{{ plusDays(value) }}{{ !allowed(value) ? ' · 超过保修截止日' : '' }}</span></label></div><p class="reminder-notice">将于 {{ plusDays(days) }} 00:00 恢复站内提示。暂缓只隐藏提示，不改变到期日或逾期状态，期间仍可在“已暂缓”中查看和完成维护。</p></template>
          <template v-else><label class="reminder-field">完成日期<input v-model="completedOn" type="date" required :max="ledgerToday()" /></label><label class="reminder-field">维护备注（选填）<textarea v-model="note" maxlength="500" rows="3" /></label><p class="muted small">保存后按完成日期顺延维护周期；本次暂缓自动结束。</p></template>
        </fieldset>
        <div class="reminder-actions"><SiteButton :disabled="busy" @click="close">{{ stale ? '关闭并查看最新待办' : '取消' }}</SiteButton><SiteButton type="submit" variant="primary" :disabled="stale || (mode === 'snooze' && !allowed(days))" :loading="busy">{{ mode === 'snooze' ? '确认稍后提醒' : '保存维护记录' }}</SiteButton></div>
      </form>
    </dialog>
  </div>
</template>
<style scoped>
.reminders-page{padding-block:44px 64px}.reminder-meta{color:var(--site-muted);font-size:13px;margin-block:20px}.reminder-filter-help{margin-bottom:20px;font-size:13px}.reminder-columns{display:grid;grid-template-columns:minmax(0,890px) minmax(240px,1fr);gap:28px}.reminder-list{padding:26px}.reminder-group h2{font-size:17px;display:flex;justify-content:space-between;margin-bottom:16px}.reminder-group h2 span{font-size:12px;font-weight:400;color:var(--site-muted)}.reminder-group+ .reminder-group{margin-top:24px}.reminder-group ul{list-style:none;padding:0;margin:0}.reminder-item{padding:18px 0 22px;border-bottom:1px solid var(--site-border)}.reminder-item h3{font-size:17px;font-weight:500;margin:0}.reminder-item-head{display:flex;justify-content:space-between;align-items:start;gap:14px}.reminder-item-head>div{min-width:0}.reminder-item-head h3{overflow-wrap:anywhere}.small{font-size:13px;margin-top:5px}.reminder-item .reminder-actions{margin-top:16px}.reminder-aside{display:flex;flex-direction:column;gap:20px;color:var(--site-muted);font-size:14px;line-height:1.85}.reminder-aside>.reminder-panel{padding:22px;display:flex;flex-direction:column;align-items:start;gap:16px}.reminder-aside h2{font-size:18px;color:var(--site-accent)}.reminder-snoozed{padding:14px;background:var(--site-soft);border-radius:6px;margin-top:14px;color:var(--site-accent);font-size:14px}.reminder-dialog form{display:flex;flex-direction:column;gap:20px}.reminder-dialog h2{font-size:23px}.reminder-dialog h3{font-size:16px}.reminder-dialog fieldset{border:0;padding:0;margin:0;min-width:0}.reminder-dialog legend{margin-bottom:12px}.snooze-options{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}.snooze-options label{display:flex;align-items:center;gap:10px;border:1px solid var(--site-border);border-radius:6px;padding:16px;font-size:14px}.snooze-options label.selected{background:var(--site-soft);border-color:var(--site-accent)}.snooze-options input{accent-color:var(--site-accent)}.snooze-options span{margin-left:auto;color:var(--site-muted);font-size:12px}.snooze-options .unavailable{opacity:.55}.reminder-close{font-size:26px;color:var(--site-muted);background:none;border:0;padding:0 8px}.reminder-field{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}.reminder-field input,.reminder-field textarea{width:100%;border:1px solid var(--site-border);border-radius:6px;padding:12px;background:white;color:var(--site-text)}@media(max-width:900px){.reminder-columns{grid-template-columns:minmax(0,1fr)}.reminder-aside{font-size:13px}}@media(max-width:760px){.reminders-page{padding-block:28px 44px}.reminder-list{padding:18px}.reminder-item h3{font-size:16px}.reminder-dialog{padding:22px}.snooze-options label{flex-wrap:wrap}.snooze-options span{margin-left:0;flex-basis:100%}.reminder-item .reminder-actions{gap:8px}.reminder-item .site-button{font-size:13px;padding:10px 12px}}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import PageState from '../components/PageState.vue'
import SiteButton from '../components/SiteButton.vue'
import { getReminderSettings, reminderDefaults, saveReminderSettings, type ReminderSettings } from '../api/reminders'
import { useRemindersStore } from '../stores/reminders'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
const reminders = useRemindersStore()
const form = reactive<ReminderSettings>({ ...reminderDefaults, version: 0 })
const original = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const loaded = ref(false)
const controller = new AbortController()
let active = true
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => loaded.value && snapshot() !== original.value)
const { leaveDialog, confirmLeave } = useUnsavedChanges(dirty, busy)
const confirmDialog = ref<HTMLDialogElement | null>(null)
const confirmMode = ref<'defaults' | 'reload'>('defaults')
async function ask(mode: 'defaults' | 'reload') {
  confirmMode.value = mode
  await nextTick()
  confirmDialog.value?.showModal()
}
async function confirm() {
  confirmDialog.value?.close()
  if (confirmMode.value === 'defaults') defaults()
  else await load(true)
}
async function load(discard = false) {
  if (busy.value) return
  if (dirty.value && !discard) { await ask('reload'); return }
  loading.value = true
  error.value = ''
  try {
    const value = await getReminderSettings(controller.signal)
    if (!active) return
    Object.assign(form, value)
    original.value = snapshot()
    loaded.value = true
  } catch (cause) { if (active) error.value = cause instanceof Error ? cause.message : '设置加载失败' }
  finally { if (active) loading.value = false }
}
function defaults() {
  Object.assign(form, reminderDefaults)
  notice.value = '已恢复默认选择，请保存设置使其生效。'
}
async function save() {
  if (busy.value || !dirty.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const value = await saveReminderSettings({ ...form })
    if (!active) return
    Object.assign(form, value)
    original.value = snapshot()
    notice.value = '提醒设置已保存。'
    await reminders.refresh()
  } catch (cause) { if (active) error.value = cause instanceof Error ? cause.message : '保存失败，新设置尚未生效，请重试' }
  finally { if (active) busy.value = false }
}
onMounted(() => load())
onBeforeUnmount(() => { active = false; controller.abort(); confirmDialog.value?.close(); leaveDialog.value?.close() })
</script>
<template>
  <div class="reminder-settings site-container">
    <RouterLink class="muted" to="/app/account">账户与数据 / 提醒设置</RouterLink>
    <PageHeading title="提醒设置" description="选择什么时候关注设备，不必每天惦记。设置对你的全部设备生效。" />
    <p class="reminder-notice">当前为站内提醒：在网站内展示待办和角标；离开网站不会收到邮件或手机通知。</p>
    <PageState v-if="loading && !loaded" kind="loading" title="正在加载提醒设置" />
    <div v-if="error" class="reminder-error" role="alert"><p>{{ error }}</p><SiteButton :disabled="busy || loading" @click="load()">重新加载设置</SiteButton></div>
    <p v-if="notice" class="reminder-notice" role="status">{{ notice }}</p>
    <form v-if="loaded" @submit.prevent="save">
      <fieldset :disabled="busy || loading" class="reminder-panel settings-fields">
        <legend class="sr-only">站内提醒规则</legend>
        <section class="setting-section" aria-labelledby="warranty-title">
          <div class="setting-top"><div><h2 id="warranty-title">保修截止提醒</h2><p class="muted">在保修截止前提示，方便提前检查和联系售后。</p></div><label class="reminder-switch"><input v-model="form.warranty_enabled" type="checkbox" /><span>开启保修提醒</span></label></div>
          <fieldset :disabled="!form.warranty_enabled"><legend>提前多久进入提醒窗口</legend><div class="reminder-choices"><label v-for="day in [1, 3, 7, 14, 30]" :key="day" :class="{ selected: form.warranty_days === day }"><input v-model="form.warranty_days" type="radio" name="warranty-days" :value="day" />{{ day }} 天</label></div></fieldset>
          <p class="muted small">默认提前7天；截止当天仍提醒，过保后不再持续催办。</p>
        </section>
        <section class="setting-section" aria-labelledby="maintenance-title">
          <div class="setting-top"><div><h2 id="maintenance-title">维护到期提醒</h2><p class="muted">提醒你清洁、保养或更换耗材；未完成的维护会保留为逾期待办。</p></div><label class="reminder-switch"><input v-model="form.maintenance_enabled" type="checkbox" /><span>开启维护提醒</span></label></div>
          <fieldset :disabled="!form.maintenance_enabled"><legend>开始提醒的时间</legend><div class="reminder-choices"><label v-for="day in [0, 1, 3, 7]" :key="day" :class="{ selected: form.maintenance_days === day }"><input v-model="form.maintenance_days" type="radio" name="maintenance-days" :value="day" />{{ day ? `提前 ${day} 天` : '到期当天' }}</label></div></fieldset>
          <p class="muted small">默认提前3天；到期当天与逾期状态在待办中持续展示。</p>
        </section>
      </fieldset>
      <section class="reminder-rules"><h2>提醒怎样生效？</h2><ul><li>按北京时间计算，保存后立即重新计算待办。</li><li>暂停的维护计划和未知保修日期不生成对应提醒。</li><li>关闭某类提醒后，不再显示于待办和角标；设备详情仍保留日期和状态。</li><li>稍后提醒不修改到期日。恢复默认不修改已有暂缓的恢复时间。</li></ul></section>
      <div class="reminder-actions"><SiteButton type="submit" variant="primary" :loading="busy" :disabled="!dirty || loading">保存设置</SiteButton><SiteButton :disabled="busy || loading" @click="ask('defaults')">恢复默认</SiteButton><SiteButton to="/app/reminders">返回待办</SiteButton></div>
      <p class="muted small">修改后请保存。{{ dirty ? '有尚未保存的修改。' : '当前设置已保存。' }}</p>
    </form>
    <dialog ref="confirmDialog" class="reminder-dialog" aria-labelledby="settings-confirm-title">
      <h2 id="settings-confirm-title">{{ confirmMode === 'defaults' ? '恢复默认提醒设置？' : '重新加载设置？' }}</h2>
      <p>{{ confirmMode === 'defaults' ? '开启两类提醒：保修提前7天、维护提前3天。不会修改已有暂缓的恢复时间。确认后仍需保存。' : '当前未保存的选择将被放弃，加载服务端的最新设置。' }}</p>
      <div class="reminder-actions"><SiteButton @click="confirmDialog?.close()">取消</SiteButton><SiteButton variant="primary" @click="confirm">{{ confirmMode === 'defaults' ? '确认恢复默认' : '确认重新加载' }}</SiteButton></div>
    </dialog>
    <dialog ref="leaveDialog" class="reminder-dialog" aria-labelledby="settings-leave-title" @cancel.prevent="confirmLeave(false)">
      <h2 id="settings-leave-title">有尚未保存的修改</h2><p>离开后将放弃本次选择，已保存的设置不受影响。</p>
      <div class="reminder-actions"><SiteButton variant="primary" @click="confirmLeave(false)">继续编辑</SiteButton><SiteButton @click="confirmLeave(true)">放弃修改并离开</SiteButton></div>
    </dialog>
  </div>
</template>
<style scoped>
.reminder-dialog h2{font-size:22px;margin-bottom:16px}.reminder-dialog p{margin-bottom:22px}.reminder-settings{max-width:1080px;padding-block:44px 64px}.reminder-settings>.page-heading{margin-top:18px}.settings-fields{margin:24px 0;padding:28px}.setting-section+ .setting-section{border-top:1px solid var(--site-border);padding-top:26px;margin-top:26px}.setting-top{display:flex;gap:20px;justify-content:space-between;align-items:center;margin-bottom:20px}.setting-top h2{font-size:20px;margin-bottom:8px}.setting-top p{font-size:14px}.setting-section fieldset{border:0;margin:0;padding:0}.setting-section legend{margin-bottom:12px;font-size:14px}.reminder-switch{display:flex;gap:8px;align-items:center;font-size:13px;flex-shrink:0}.reminder-switch input{accent-color:var(--site-accent);width:20px;height:20px}.reminder-choices label{display:flex;align-items:center;gap:8px}.reminder-choices input{accent-color:var(--site-accent)}fieldset:disabled .reminder-choices{opacity:.5}.small{font-size:12px;margin-top:14px}.reminder-rules{margin:28px 0}.reminder-rules h2{font-size:18px;margin-bottom:12px}.reminder-rules ul{padding-left:20px;color:var(--site-muted);line-height:1.9}@media(max-width:760px){.reminder-settings{padding-block:28px 44px}.settings-fields{padding:20px}.setting-top{align-items:start;flex-direction:column}.reminder-actions>.site-button{flex:1}}
</style>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import PageHeading from '../components/PageHeading.vue'
import SiteButton from '../components/SiteButton.vue'
import { useSessionStore } from '../stores/session'
import { SiteApiError } from '../api/request'
import { changePassword, reauthenticate, exportAccount, deleteAccount } from '../api/account'
import { getCalendar } from '../api/devices'

type Mode = 'password' | 'export' | 'delete'
const session = useSessionStore()
const router = useRouter()
const username = session.user?.username || ''
const mode = ref<Mode | null>(null)
const modal = ref<HTMLDialogElement | null>(null)
const busy = ref(false)
const calendarBusy = ref(false)
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const confirmUsername = ref('')
const error = ref('')
const errorElement = ref<HTMLElement | null>(null)
const notice = ref('')
const pageError = ref('')
const recoveryCode = ref('')
const saved = ref(false)
const codeNotice = ref('')
const successHeading = ref<HTMLElement | null>(null)
let active = true

onBeforeRouteLeave((to) => {
  if (to.name === 'site-login' && !recoveryCode.value) return true
  if (busy.value) return false
  return (
    !recoveryCode.value ||
    saved.value ||
    window.confirm('新的恢复码还未确认保存。离开后无法再次查看，确定离开吗？')
  )
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (busy.value || (recoveryCode.value && !saved.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  active = false
  clearPasswords()
  recoveryCode.value = ''
  window.removeEventListener('beforeunload', beforeUnload)
})
function clearPasswords() {
  password.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  confirmUsername.value = ''
}
async function open(next: Mode) {
  if (busy.value || recoveryCode.value) return
  clearPasswords()
  error.value = ''
  pageError.value = ''
  codeNotice.value = ''
  saved.value = false
  mode.value = next
  await nextTick()
  modal.value?.showModal()
}
function close() {
  if (busy.value || (recoveryCode.value && !saved.value)) return
  modal.value?.close()
  mode.value = null
  clearPasswords()
  error.value = ''
}
async function showError(message: string) {
  error.value = message
  await nextTick()
  errorElement.value?.focus()
}
async function handleFailure(cause: unknown) {
  if (!active) return
  if (cause instanceof SiteApiError && cause.code === 'AUTH_REQUIRED') {
    session.reset()
    busy.value = false
    await router.replace({ name: 'site-login', query: { redirect: '/app/account' } })
    return
  }
  await showError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
}
function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function submit() {
  if (busy.value || !mode.value) return
  if (!password.value) {
    await showError('请填写当前密码')
    return
  }
  if (mode.value === 'password') {
    if (newPassword.value.length < 8 || newPassword.value.length > 128) {
      await showError('新密码长度需 8–128 位')
      return
    }
    if (newPassword.value !== confirmPassword.value) {
      await showError('两次输入的新密码不一致')
      return
    }
  }
  if (mode.value === 'delete' && confirmUsername.value.trim().toLowerCase() !== username) {
    await showError('请输入当前用户名确认注销')
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'password') {
      const result = await changePassword(password.value, newPassword.value)
      recoveryCode.value = result.recovery_code
      session.reset()
      clearPasswords()
      await nextTick()
      successHeading.value?.focus()
    } else {
      await reauthenticate(password.value)
      if (mode.value === 'export') {
        const result = await exportAccount()
        download(
          JSON.stringify(result, null, 2),
          `device-ledger-${result.exported_on}.json`,
          'application/json;charset=utf-8',
        )
        busy.value = false
        close()
        notice.value = '完整数据已开始下载。JSON 包含设备、维护计划和历史，不包含登录凭证。'
      } else {
        await deleteAccount(confirmUsername.value.trim())
        session.reset()
        busy.value = false
        close()
        await router.replace('/')
      }
    }
  } catch (cause) {
    await handleFailure(cause)
  } finally {
    busy.value = false
  }
}
async function exportCalendar() {
  if (busy.value || recoveryCode.value) return
  busy.value = true
  calendarBusy.value = true
  pageError.value = ''
  notice.value = ''
  try {
    const result = await getCalendar()
    if (!active) return
    download(result, 'device-ledger.ics', 'text/calendar;charset=utf-8')
    notice.value = '已导出未来 30 天内的事项。请导入自己的日历，并自行设置提醒。'
  } catch (cause) {
    if (active) pageError.value = cause instanceof Error ? cause.message : '日历导出失败，请重试'
  } finally {
    busy.value = false
    calendarBusy.value = false
  }
}
async function copyCode() {
  try {
    await navigator.clipboard.writeText(recoveryCode.value)
    codeNotice.value = '恢复码已复制，请妥善保存。'
  } catch {
    codeNotice.value = '复制失败，请手动选中恢复码复制，或下载保存。'
  }
}
function downloadCode() {
  download(
    `设备台账 · ${username}\n新的恢复码：${recoveryCode.value}\n请离线妥善保存，不要分享给他人。旧恢复码已失效。\n`,
    'device-ledger-recovery.txt',
    'text/plain;charset=utf-8',
  )
  codeNotice.value = '恢复码文件已开始下载，请确认已经妥善保存。'
}
async function finish() {
  if (saved.value) {
    recoveryCode.value = ''
    close()
    await router.replace('/login')
  }
}
</script>

<template>
  <div class="account-page">
    <PageHeading title="账户与数据" :description="`用户名 ${username} · 不绑定手机号或邮箱`" />
    <p v-if="notice" class="account-feedback" role="status">{{ notice }}</p>
    <p v-if="pageError" class="account-feedback is-error" role="alert">
      {{ pageError }} 请点击“导出日历”重试。
    </p>
    <div class="account-sections">
      <section class="account-panel" aria-labelledby="security-title">
        <div class="section-heading">
          <img src="/icons/shield-check.svg" width="24" height="24" alt="" />
          <h2 id="security-title">账号安全</h2>
        </div>
        <p class="section-description">
          保存恢复码，用于忘记密码时重置。更改密码会使原会话全部失效。
        </p>
        <div class="security-summary">
          <div>
            <h3>{{ username }}</h3>
            <p>请离线妥善保存注册时生成的恢复码</p>
          </div>
          <SiteButton :disabled="busy || !!recoveryCode" @click="open('password')"
            >修改密码</SiteButton
          >
        </div>
      </section>
      <section class="account-panel" aria-labelledby="data-title">
        <div class="section-heading">
          <img src="/icons/download.svg" width="24" height="24" alt="" />
          <h2 id="data-title">带走你的数据</h2>
        </div>
        <p class="section-description">
          台账属于你。定期导出一份备份，或把未来事项带到自己的日历。
        </p>
        <div class="export-row">
          <div>
            <h3>完整数据 JSON</h3>
            <p>包含设备、维护计划和历史记录，不包含登录凭证。</p>
          </div>
          <SiteButton :disabled="busy || !!recoveryCode" @click="open('export')"
            >导出完整数据</SiteButton
          >
        </div>
        <div class="export-row">
          <div>
            <h3>未来事项 ICS</h3>
            <p>将未来的保修与维护事项导入日历，并自行设置提醒。</p>
          </div>
          <SiteButton
            :disabled="busy || !!recoveryCode"
            :loading="calendarBusy"
            @click="exportCalendar"
            >{{ calendarBusy ? '正在导出…' : '导出日历' }}</SiteButton
          >
        </div>
      </section>
      <section class="account-panel danger-panel" aria-labelledby="delete-title">
        <h2 id="delete-title">注销账户</h2>
        <p class="section-description">
          删除当前账户及全部设备、维护计划和历史，无回收站。备份按保留周期过期。
        </p>
        <div class="delete-row">
          <p>建议先导出完整数据，确认后再继续。</p>
          <SiteButton variant="danger" :disabled="busy || !!recoveryCode" @click="open('delete')"
            >注销账户</SiteButton
          >
        </div>
      </section>
    </div>
    <dialog
      ref="modal"
      class="account-dialog"
      aria-labelledby="account-modal-title"
      @cancel="(busy || !!recoveryCode) && $event.preventDefault()"
      @close="clearPasswords"
    >
      <template v-if="recoveryCode"
        ><h2 id="account-modal-title" ref="successHeading" tabindex="-1">密码已修改</h2>
        <p class="modal-description">所有旧会话与旧恢复码已失效。请保存新的恢复码后重新登录。</p>
        <div class="recovery-code">
          <code>{{ recoveryCode }}</code>
        </div>
        <p class="code-warning">恢复码只显示这一次，请妥善保存，不要分享给他人。</p>
        <div class="code-actions">
          <SiteButton @click="copyCode">复制恢复码</SiteButton
          ><SiteButton @click="downloadCode">下载保存</SiteButton>
        </div>
        <p v-if="codeNotice" class="copy-notice" role="status">{{ codeNotice }}</p>
        <label class="saved-check"
          ><input v-model="saved" type="checkbox" />我已妥善保存新的恢复码</label
        ><SiteButton class="finish-button" variant="primary" :disabled="!saved" @click="finish"
          >返回登录</SiteButton
        ></template
      >
      <template v-else-if="mode"
        ><div class="modal-heading">
          <h2 id="account-modal-title">
            {{
              mode === 'password'
                ? '修改密码'
                : mode === 'export'
                  ? '验证后导出数据'
                  : '确认注销账户'
            }}
          </h2>
          <button class="modal-close" :disabled="busy" aria-label="关闭操作窗口" @click="close">
            ×
          </button>
        </div>
        <p class="modal-description">
          {{
            mode === 'password'
              ? '修改后，所有设备上的登录会话与旧恢复码将失效。'
              : mode === 'export'
                ? '为保护私人台账，导出完整数据前请验证当前密码。'
                : '此操作会删除账户及全部台账数据，无法恢复。建议先导出备份。'
          }}
        </p>
        <form @submit.prevent="submit" :aria-busy="busy">
          <fieldset :disabled="busy">
            <legend class="sr-only">账户验证</legend>
            <div class="account-field">
              <label for="account-password">当前密码</label
              ><input
                id="account-password"
                v-model="password"
                type="password"
                autocomplete="current-password"
                required
                maxlength="128"
              />
            </div>
            <template v-if="mode === 'password'"
              ><div class="account-field">
                <label for="account-new-password">新密码</label
                ><input
                  id="account-new-password"
                  v-model="newPassword"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="8"
                  maxlength="128"
                  aria-describedby="account-password-hint"
                />
                <p id="account-password-hint" class="field-hint">
                  8–128 位，请勿与其他网站共用密码。
                </p>
              </div>
              <div class="account-field">
                <label for="account-confirm-password">再次确认新密码</label
                ><input
                  id="account-confirm-password"
                  v-model="confirmPassword"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="8"
                  maxlength="128"
                /></div
            ></template>
            <div v-if="mode === 'delete'" class="account-field">
              <label for="account-confirm-username">输入用户名 {{ username }} 确认</label
              ><input
                id="account-confirm-username"
                v-model="confirmUsername"
                required
                autocomplete="off"
                :spellcheck="false"
                autocapitalize="none"
                maxlength="32"
              />
            </div>
          </fieldset>
          <p v-if="error" ref="errorElement" class="modal-error" role="alert" tabindex="-1">
            {{ error }}
          </p>
          <div class="modal-actions">
            <SiteButton :disabled="busy" @click="close">取消</SiteButton
            ><SiteButton
              type="submit"
              :variant="mode === 'delete' ? 'danger' : 'primary'"
              :loading="busy"
              >{{
                busy
                  ? '正在处理…'
                  : mode === 'password'
                    ? '确认修改'
                    : mode === 'export'
                      ? '导出 JSON'
                      : '确认注销账户'
              }}</SiteButton
            >
          </div>
        </form>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.account-page {
  width: min(1080px, calc(100% - var(--site-gutter) * 2));
  padding-block: 48px 64px;
  margin-inline: auto;
}
.account-sections {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.account-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 10px;
  min-width: 0;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.section-heading img {
  flex-shrink: 0;
}
.section-heading h2 {
  font-size: 22px;
}
.section-description {
  color: var(--site-muted);
}
.security-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px;
  background: #f4f7f1;
  border-radius: 8px;
}
.security-summary > div,
.export-row > div {
  min-width: 0;
}
.security-summary h3 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.security-summary p {
  color: var(--site-muted);
  font-size: 13px;
}
.security-summary :deep(.site-button),
.export-row :deep(.site-button),
.delete-row :deep(.site-button) {
  flex-shrink: 0;
}
.export-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-block: 18px;
  border-top: 1px solid #e6ece2;
}
.export-row h3 {
  margin: 0 0 5px;
  font-size: 16px;
  font-weight: 400;
}
.export-row p {
  color: var(--site-muted);
  font-size: 14px;
}
.danger-panel h2 {
  font-size: 21px;
  color: var(--site-danger);
}
.danger-panel .section-description {
  font-size: 14px;
}
.delete-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.delete-row p {
  color: var(--site-muted);
  font-size: 14px;
}
.account-feedback {
  margin-bottom: 24px;
  color: var(--site-accent);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.account-feedback.is-error {
  color: var(--site-danger);
}
.account-dialog {
  width: min(560px, calc(100% - 32px));
  padding: 28px;
  max-height: calc(100dvh - 48px);
  border: 1px solid var(--site-border);
  border-radius: 12px;
  background: var(--site-surface);
  color: var(--site-text);
  overflow-y: auto;
}
.account-dialog::backdrop {
  background: #172c2366;
}
.modal-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.account-dialog h2 {
  font-size: 24px;
}
.modal-close {
  min-width: 40px;
  min-height: 40px;
  padding: 6px;
  border: 0;
  background: transparent;
  border-radius: 5px;
  color: var(--site-muted);
  font-size: 26px;
}
.modal-close:hover {
  background: var(--site-soft);
}
.modal-description {
  color: var(--site-muted);
  margin-block: 16px 24px;
  font-size: 14px;
}
fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.account-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.account-field label {
  font-size: 14px;
}
.account-field input {
  min-width: 0;
  width: 100%;
  min-height: 48px;
  padding: 11px 14px;
  border: 1px solid var(--site-border);
  border-radius: 7px;
  color: var(--site-text);
  background: var(--site-surface);
}
.field-hint {
  font-size: 12px;
  color: var(--site-muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}
.modal-error {
  color: var(--site-danger);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.recovery-code {
  padding: 18px;
  border: 1px solid var(--site-border);
  border-radius: 8px;
  background: var(--site-bg);
  text-align: center;
  overflow-wrap: anywhere;
  user-select: all;
}
.recovery-code code {
  font:
    18px/1.8 ui-monospace,
    monospace;
}
.code-warning {
  font-size: 13px;
  color: var(--site-muted);
  margin-top: 16px;
}
.code-actions {
  display: flex;
  gap: 12px;
  margin-block: 20px;
  flex-wrap: wrap;
}
.copy-notice {
  color: var(--site-accent);
  font-size: 13px;
  margin-bottom: 18px;
}
.saved-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-block: 20px;
  font-size: 14px;
}
.saved-check input {
  width: 16px;
  height: 16px;
  margin-top: 3px;
  accent-color: var(--site-accent);
}
.finish-button {
  width: 100%;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 760px) {
  .account-page {
    padding-block: 32px 48px;
  }
  .account-panel {
    padding: 22px;
  }
  .security-summary,
  .export-row,
  .delete-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  .account-dialog {
    padding: 22px;
  }
  .account-field input {
    font-size: 16px;
  }
}
</style>

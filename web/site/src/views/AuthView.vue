<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import SiteButton from '../components/SiteButton.vue'
import { login, register, recover } from '../api/session'
import { useSessionStore } from '../stores/session'
import { POLICY_VERSION, safeUserRedirect, validateAuth, type AuthMode } from '../utils/auth'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const mode = computed<AuthMode>(() =>
  route.name === 'site-register' ? 'register' : route.name === 'site-recover' ? 'recover' : 'login',
)
const content = computed(
  () =>
    ({
      login: {
        title: '登录你的台账',
        subtitle: '欢迎回来，接着照顾你的日常设备。',
        submit: '登录',
        note: '不绑定手机号或邮箱，请保管好密码和恢复码。',
      },
      register: {
        title: '通过邀请开始使用',
        subtitle: '从一台设备开始，建立自己的私人台账。',
        submit: '创建账户',
        note: '注册成功后，请立即保存一次性恢复码。',
      },
      recover: {
        title: '找回台账的访问权限',
        subtitle: '使用一次性恢复码，重新设置登录密码。',
        submit: '重置密码',
        note: '恢复成功后请重新登录，并保存新的恢复码。',
      },
    })[mode.value],
)
const username = ref('')
const password = ref('')
const invite = ref('')
const recovery = ref('')
const policy = ref(false)
const visible = ref(false)
const busy = ref(false)
const error = ref('')
const errorElement = ref<HTMLElement | null>(null)
const resultCode = ref('')
const saved = ref(false)
const copyNotice = ref('')
const successHeading = ref<HTMLElement | null>(null)
const newPassword = computed(() => mode.value !== 'login')
let active = true

watch(mode, () => {
  username.value = ''
  password.value = ''
  invite.value = ''
  recovery.value = ''
  policy.value = false
  visible.value = false
  error.value = ''
  resultCode.value = ''
  saved.value = false
  copyNotice.value = ''
})
function canLeave() {
  if (busy.value) return false
  return (
    !resultCode.value ||
    saved.value ||
    window.confirm('一次性恢复码还未确认保存。离开后无法再次查看，确定离开吗？')
  )
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (busy.value || (resultCode.value && !saved.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => {
  active = false
  password.value = ''
  recovery.value = ''
  resultCode.value = ''
  window.removeEventListener('beforeunload', warnBeforeUnload)
})

async function showError(message: string) {
  error.value = message
  await nextTick()
  errorElement.value?.focus()
}
async function submit() {
  if (busy.value) return
  const invalid = validateAuth(mode.value, {
    username: username.value,
    password: password.value,
    invite: invite.value,
    recovery: recovery.value,
    policy: policy.value,
  })
  if (invalid) {
    await showError(invalid)
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'login') {
      const result = await login({ username: username.value.trim(), password: password.value })
      session.setUser(result.user)
      password.value = ''
      busy.value = false
      await router.replace(safeUserRedirect(route.query.redirect))
    } else {
      if (mode.value === 'register') {
        const result = await register({
          username: username.value.trim().toLowerCase(),
          password: password.value,
          invite_code: invite.value.trim(),
          policy_version: POLICY_VERSION,
        })
        session.setUser(result.user)
        resultCode.value = result.recovery_code
      } else {
        const result = await recover({
          username: username.value.trim(),
          recovery_code: recovery.value.trim(),
          new_password: password.value,
        })
        session.reset()
        resultCode.value = result.recovery_code
      }
      password.value = ''
      recovery.value = ''
      invite.value = ''
      visible.value = false
      await nextTick()
      successHeading.value?.focus()
    }
  } catch (cause) {
    if (active) await showError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
  } finally {
    busy.value = false
  }
}
async function copyCode() {
  try {
    await navigator.clipboard.writeText(resultCode.value)
    copyNotice.value = '恢复码已复制，请保存到安全的地方。'
  } catch {
    copyNotice.value = '无法访问剪贴板，请手动选中恢复码复制，或下载保存。'
  }
}
function downloadCode() {
  const blob = new Blob(
    [
      `设备台账 · ${username.value.trim()}\n一次性恢复码：${resultCode.value}\n\n请妥善保存，不要分享给他人。使用后将作废并生成新的恢复码。\n`,
    ],
    { type: 'text/plain;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'device-ledger-recovery.txt'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  copyNotice.value = '恢复码文件已开始下载，请确认文件已妥善保存。'
}
async function continueAfterSave() {
  if (!saved.value) return
  const destination = mode.value === 'register' ? '/app' : '/login'
  resultCode.value = ''
  await router.replace(destination)
}
</script>

<template>
  <div class="auth-page">
    <aside class="auth-brand" aria-label="设备台账介绍">
      <img
        :src="mode === 'recover' ? '/icons/key-round.svg' : '/favicon.svg'"
        alt=""
        width="40"
        height="40"
      />
      <h2>好好记录，<br />长久相伴。</h2>
      <p>保修、维护和每一次处理记录，<br />都留在属于你的台账里。</p>
      <ul>
        <li>
          <img src="/icons/shield-check.svg" alt="" width="18" height="18" />私人记录，仅本人可见
        </li>
        <li>
          <img src="/icons/user-round-check.svg" alt="" width="18" height="18" />不要求手机号或邮箱
        </li>
        <li>
          <img src="/icons/key-round.svg" alt="" width="18" height="18" />请妥善保存账号恢复码
        </li>
      </ul>
    </aside>
    <section
      v-if="resultCode"
      class="auth-card recovery-success"
      aria-labelledby="auth-success-title"
    >
      <h1 id="auth-success-title" ref="successHeading" tabindex="-1">
        {{ mode === 'register' ? '账户创建成功' : '密码已重置' }}
      </h1>
      <p class="auth-description">
        {{
          mode === 'register'
            ? '欢迎加入，请先保存你的账号恢复码。'
            : '所有旧会话和旧恢复码已失效，请保存新恢复码后重新登录。'
        }}
      </p>
      <div class="code-notice">
        <img src="/icons/key-round.svg" alt="" width="20" height="20" />
        <p>恢复码只在这里显示一次。它可以重置密码，请离线妥善保存，不要分享给他人。</p>
      </div>
      <div class="recovery-code" aria-label="一次性恢复码">
        <code>{{ resultCode }}</code>
      </div>
      <div class="code-actions">
        <SiteButton @click="copyCode">复制恢复码</SiteButton
        ><SiteButton @click="downloadCode">下载保存</SiteButton>
      </div>
      <p v-if="copyNotice" class="copy-notice" role="status">{{ copyNotice }}</p>
      <label class="auth-check"
        ><input v-model="saved" type="checkbox" />我已妥善保存这组一次性恢复码</label
      >
      <SiteButton
        class="auth-submit"
        variant="primary"
        :disabled="!saved"
        @click="continueAfterSave"
        >{{ mode === 'register' ? '进入我的台账' : '返回登录' }}</SiteButton
      >
    </section>
    <section v-else class="auth-card" aria-labelledby="auth-title">
      <div class="auth-heading">
        <h1 id="auth-title">{{ content.title }}</h1>
        <p class="auth-description">{{ content.subtitle }}</p>
      </div>
      <form @submit.prevent="submit" :aria-busy="busy">
        <fieldset :disabled="busy">
          <legend class="sr-only">{{ content.title }}</legend>
          <div v-if="mode === 'register'" class="auth-field">
            <label for="auth-invite">邀请码</label
            ><input
              id="auth-invite"
              v-model="invite"
              name="invite_code"
              autocomplete="off"
              required
              maxlength="128"
              placeholder="输入你收到的邀请码"
            />
          </div>
          <div class="auth-field">
            <label for="auth-username">用户名</label
            ><input
              id="auth-username"
              v-model="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              :spellcheck="false"
              required
              maxlength="32"
              :minlength="mode === 'register' ? 4 : undefined"
              placeholder="输入用户名"
              :aria-describedby="mode === 'register' ? 'username-hint' : undefined"
            />
            <p v-if="mode === 'register'" id="username-hint" class="field-hint">
              4–32 位字母、数字或下划线，字母将转为小写。
            </p>
          </div>
          <div v-if="mode === 'recover'" class="auth-field">
            <label for="auth-recovery">一次性恢复码</label
            ><input
              id="auth-recovery"
              v-model="recovery"
              name="recovery_code"
              autocomplete="off"
              autocapitalize="none"
              :spellcheck="false"
              required
              maxlength="128"
              placeholder="输入注册时保存的恢复码"
            />
          </div>
          <div class="auth-field">
            <label for="auth-password">{{ mode === 'recover' ? '新密码' : '密码' }}</label>
            <div class="password-input">
              <input
                id="auth-password"
                v-model="password"
                :name="mode === 'recover' ? 'new_password' : 'password'"
                :type="visible ? 'text' : 'password'"
                :autocomplete="newPassword ? 'new-password' : 'current-password'"
                required
                :minlength="newPassword ? 8 : undefined"
                maxlength="128"
                :placeholder="newPassword ? '设置 8–128 位安全密码' : '输入密码'"
                :aria-describedby="newPassword ? 'password-hint' : undefined"
              /><button
                type="button"
                class="password-toggle"
                :aria-label="visible ? '隐藏密码' : '显示密码'"
                :aria-pressed="visible"
                aria-controls="auth-password"
                @click="visible = !visible"
              >
                <span v-if="visible">隐藏</span
                ><img v-else src="/icons/eye-off.svg" alt="" width="18" height="18" />
              </button>
            </div>
            <p v-if="newPassword" id="password-hint" class="field-hint">
              密码长度为 8–128 位，请勿与其他网站共用密码。
            </p>
          </div>
          <label v-if="mode === 'register'" class="auth-check"
            ><input v-model="policy" name="policy" type="checkbox" required /><span
              >我已阅读<RouterLink to="/privacy" target="_blank" rel="noopener">隐私说明</RouterLink
              >，了解备份和账号恢复方式。</span
            ></label
          >
          <p v-if="mode === 'recover'" class="recovery-warning">
            <img src="/icons/info.svg" alt="" width="18" height="18" /><span
              >密码和恢复码同时遗失时，不承诺找回。</span
            >
          </p>
          <p v-if="error" ref="errorElement" class="auth-error" role="alert" tabindex="-1">
            {{ error }}
          </p>
          <SiteButton type="submit" class="auth-submit" variant="primary" :loading="busy">{{
            busy ? '正在处理…' : content.submit
          }}</SiteButton>
        </fieldset>
      </form>
      <nav class="auth-links" aria-label="账户入口">
        <template v-if="mode === 'login'"
          ><RouterLink to="/register">有邀请码？注册</RouterLink
          ><RouterLink to="/recover">忘记密码？</RouterLink></template
        ><RouterLink v-else to="/login">← 返回用户登录</RouterLink>
      </nav>
      <p class="auth-footnote">{{ content.note }}</p>
    </section>
  </div>
</template>

<style scoped>
.auth-page {
  width: min(1140px, calc(100% - var(--site-gutter) * 2));
  min-height: 880px;
  margin-inline: auto;
  padding-block: 70px;
  display: grid;
  grid-template-columns: minmax(0, 480px) minmax(0, 460px);
  gap: 100px;
  align-items: center;
}
.auth-brand {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.auth-brand > h2 {
  font-size: 42px;
  font-weight: 600;
  line-height: 1.6;
  color: #234733;
}
.auth-brand > p {
  font-size: 18px;
  color: var(--site-muted);
}
.auth-brand ul {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 0;
  margin: 0;
  list-style: none;
}
.auth-brand li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--site-muted);
}
.auth-brand img,
.recovery-warning img,
.code-notice img {
  flex-shrink: 0;
}
.auth-card {
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 12px;
  padding: 32px;
  min-width: 0;
}
.auth-heading {
  margin-bottom: 22px;
}
.auth-card h1 {
  font-size: 32px;
  line-height: 1.6;
}
.auth-description {
  margin-top: 8px;
  font-size: 15px;
  color: var(--site-muted);
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.auth-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 22px;
}
.auth-field label {
  font-size: 14px;
}
.auth-field input {
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 11px 14px;
  border: 1px solid #d7dfd5;
  border-radius: 7px;
  color: var(--site-text);
  background: var(--site-surface);
}
.auth-field input::placeholder {
  color: var(--site-muted);
}
.field-hint {
  font-size: 12px;
  color: var(--site-muted);
}
.password-input {
  position: relative;
}
.password-input input {
  padding-right: 54px;
}
.password-toggle {
  display: grid;
  place-items: center;
  position: absolute;
  right: 4px;
  top: 4px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--site-muted);
  font-size: 12px;
}
.password-toggle:hover {
  background: var(--site-soft);
}
.auth-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--site-muted);
  margin-bottom: 22px;
}
.auth-check input {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
  accent-color: var(--site-accent);
}
.auth-check a {
  color: var(--site-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.recovery-warning,
.code-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 8px;
  background: #fbf3e9;
  color: #597050;
  font-size: 14px;
  margin-bottom: 22px;
}
.recovery-warning img {
  margin-top: 2px;
}
.auth-submit {
  width: 100%;
}
.auth-links {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
  margin-top: 22px;
  border-top: 1px solid #e7ece4;
  color: var(--site-accent);
  font-size: 13px;
}
.auth-links a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.auth-footnote {
  margin-top: 22px;
  color: var(--site-muted);
  font-size: 12px;
}
.auth-error {
  padding: 12px 14px;
  color: var(--site-danger);
  background: #fcf1ed;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 18px;
  overflow-wrap: anywhere;
}
.recovery-success .code-notice {
  margin-top: 22px;
}
.recovery-code {
  background: var(--site-bg);
  border: 1px solid var(--site-border);
  border-radius: 8px;
  padding: 18px;
  text-align: center;
  user-select: all;
  overflow-wrap: anywhere;
}
.recovery-code code {
  font-size: 18px;
  line-height: 1.8;
  font-family: ui-monospace, monospace;
}
.code-actions {
  display: flex;
  gap: 12px;
  margin-block: 18px 22px;
  flex-wrap: wrap;
}
.copy-notice {
  color: var(--site-accent);
  margin-bottom: 18px;
  font-size: 13px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 1050px) {
  .auth-page {
    gap: 48px;
    grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
  }
  .auth-brand > h2 {
    font-size: 36px;
  }
}
@media (max-width: 760px) {
  .auth-page {
    min-height: auto;
    grid-template-columns: minmax(0, 1fr);
    padding-block: 36px 48px;
    gap: 28px;
    max-width: 500px;
  }
  .auth-brand {
    gap: 12px;
  }
  .auth-brand > img {
    width: 28px;
    height: 28px;
  }
  .auth-brand > h2 {
    font-size: 26px;
    line-height: 1.4;
  }
  .auth-brand > h2 br {
    display: none;
  }
  .auth-brand > p {
    font-size: 14px;
  }
  .auth-brand > p br {
    display: none;
  }
  .auth-brand ul {
    display: none;
  }
  .auth-card {
    padding: 24px;
  }
  .auth-card h1 {
    font-size: 25px;
  }
  .auth-field input {
    font-size: 16px;
  }
}
@media (max-width: 360px) {
  .auth-card {
    padding: 20px;
  }
  .auth-card h1 {
    font-size: 23px;
  }
  .auth-links {
    gap: 12px;
  }
}
</style>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Key, Lock, Notebook, Ticket, User, UserFilled } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'

const REMEMBER_KEY = 'ledger.admin.remembered-username'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const form = reactive({
  username: '',
  password: '',
  totp: '',
})
const remember = ref(true)
const errorMessage = ref('')
const isDev = import.meta.env.DEV

const rules: FormRules = {
  username: [{ required: true, message: '请输入管理账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  totp: [
    { required: true, message: '请输入动态验证码', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '动态验证码需为 6 位数字', trigger: 'blur' },
  ],
}

onMounted(() => {
  const remembered = localStorage.getItem(REMEMBER_KEY)
  if (remembered) {
    form.username = remembered
    remember.value = true
  }
})

function sanitizeTotp(value: string): void {
  form.totp = value.replace(/\D/g, '').slice(0, 6)
}

function fillDemo(): void {
  form.username = 'owner'
  form.password = 'ledger-owner-2026'
  form.totp = ''
  errorMessage.value = ''
  ElMessage.info('请从 Authenticator 填入当前 6 位动态码')
}

function resolveRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard'
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  if (value === '/login' || value.startsWith('/login?')) return '/dashboard'
  return value
}

async function submit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  errorMessage.value = ''
  try {
    await auth.login({
      username: form.username.trim(),
      password: form.password,
      totp: form.totp,
    })

    if (remember.value) {
      localStorage.setItem(REMEMBER_KEY, form.username.trim())
    } else {
      localStorage.removeItem(REMEMBER_KEY)
    }

    ElMessage.success('登录成功')
    await router.replace(resolveRedirect(route.query.redirect))
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '登录失败，请稍后重试'
  }
}
</script>

<template>
  <div class="login-page">
    <section class="brand-panel">
      <div class="brand-panel__inner">
        <div class="brand">
          <div class="brand__mark">
            <el-icon :size="20"><Notebook /></el-icon>
          </div>
          <div class="brand__name">
            <strong>设备台账</strong>
            <span>ADMIN CONSOLE</span>
          </div>
        </div>

        <div class="brand-panel__content">
          <p class="eyebrow">OPERATIONS CONSOLE</p>
          <h1>把设备台账的<br />运营工作放在一处。</h1>
          <p class="lead">
            账号状态、邀请码、运营配置与关键操作审计，统一在这里完成，不接触用户私人台账内容。
          </p>

          <ul class="feature-list">
            <li>
              <span class="feature-list__icon"
                ><el-icon><UserFilled /></el-icon
              ></span>
              <span>
                <strong>账号管理</strong>
                <small>查看账号元数据，停用或恢复普通账户</small>
              </span>
            </li>
            <li>
              <span class="feature-list__icon"
                ><el-icon><Ticket /></el-icon
              ></span>
              <span>
                <strong>邀请管理</strong>
                <small>创建一次性邀请码，控制试用入口</small>
              </span>
            </li>
            <li>
              <span class="feature-list__icon"
                ><el-icon><Lock /></el-icon
              ></span>
              <span>
                <strong>运营配置与审计</strong>
                <small>注册、写入开关与关键操作留痕</small>
              </span>
            </li>
          </ul>
        </div>

        <p class="brand-panel__footer">仅限运营人员使用 · 关键操作会记录审计</p>
      </div>
    </section>

    <section class="form-panel">
      <div class="login-card">
        <div class="login-card__head">
          <p class="eyebrow">ADMIN LOGIN</p>
          <h2>登录管理后台</h2>
          <p>输入管理账号与 Authenticator 中的 6 位动态验证码</p>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          @submit.prevent="submit"
        >
          <el-form-item label="账号" prop="username">
            <el-input
              v-model="form.username"
              :prefix-icon="User"
              placeholder="请输入管理账号"
              autocomplete="username"
              clearable
            />
          </el-form-item>

          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              :prefix-icon="Lock"
              type="password"
              placeholder="请输入密码"
              autocomplete="current-password"
              show-password
            />
          </el-form-item>

          <el-form-item label="动态验证码" prop="totp">
            <el-input
              v-model="form.totp"
              :prefix-icon="Key"
              placeholder="6 位数字"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              @input="sanitizeTotp"
            />
          </el-form-item>

          <div class="form-options">
            <el-checkbox v-model="remember">记住账号</el-checkbox>
            <span class="form-options__tip">动态码每 30 秒刷新，请用 Authenticator 获取</span>
          </div>

          <el-alert
            v-if="errorMessage"
            :title="errorMessage"
            type="error"
            :closable="false"
            show-icon
            class="login-error"
          />

          <el-button
            type="primary"
            native-type="submit"
            class="submit-button"
            :loading="auth.loading"
          >
            进入管理后台
          </el-button>
        </el-form>

        <div v-if="isDev" class="dev-hint">
          <div class="dev-hint__text">
            <strong>本地演示账号</strong>
            <span class="mono">owner / ledger-owner-2026</span>
          </div>
          <el-button link type="primary" @click="fillDemo">填入</el-button>
        </div>

        <p class="login-card__foot">请勿在公共设备上保存管理账号。</p>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.login-page {
  display: grid;
  grid-template-columns: minmax(420px, 1.05fr) minmax(440px, 0.95fr);
  min-height: 100%;
  background: #f6f8fc;
}

.brand-panel {
  position: relative;
  display: flex;
  overflow: hidden;
  color: #e6ecf7;
  background:
    radial-gradient(circle at 18% 8%, rgba(47, 107, 255, 0.42), transparent 40%),
    radial-gradient(circle at 90% 92%, rgba(16, 185, 129, 0.16), transparent 36%), #0b1224;

  &::before {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    background-size: 46px 46px;
    content: '';
    mask-image: radial-gradient(circle at 30% 30%, #000 0%, transparent 72%);
  }
}

.brand-panel__inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  padding: 48px 56px 36px;
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
}

.brand__mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, #4f8bff, #1e4fd8);
  border-radius: 11px;
  box-shadow: 0 8px 20px rgba(47, 107, 255, 0.4);
}

.brand__name {
  display: flex;
  flex-direction: column;
  line-height: 1.25;

  strong {
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  span {
    color: #8e9db7;
    font-size: 9px;
    letter-spacing: 0.2em;
  }
}

.brand-panel__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: 48px 0;
}

.eyebrow {
  margin: 0;
  color: #6f9bff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.brand-panel h1 {
  margin: 16px 0 18px;
  color: #fff;
  font-size: clamp(30px, 3.2vw, 44px);
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.22;
}

.lead {
  max-width: 460px;
  margin: 0;
  color: #9fadc4;
  font-size: 14px;
  line-height: 1.8;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 40px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  strong {
    display: block;
    color: #e8eefb;
    font-size: 13.5px;
    font-weight: 600;
  }

  small {
    display: block;
    margin-top: 2px;
    color: #8391aa;
    font-size: 12px;
    line-height: 1.6;
  }
}

.feature-list__icon {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  color: #8fb2ff;
  background: rgba(47, 107, 255, 0.14);
  border: 1px solid rgba(96, 140, 255, 0.18);
  border-radius: 10px;
  place-items: center;
}

.brand-panel__footer {
  margin: 0;
  color: #5f6f8a;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.form-panel {
  display: grid;
  padding: 48px 32px;
  place-items: center;
}

.login-card {
  width: 100%;
  max-width: 430px;
  padding: 40px;
  background: #fff;
  border: 1px solid var(--app-border);
  border-radius: 20px;
  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.08);
}

.login-card__head {
  margin-bottom: 28px;

  h2 {
    margin: 10px 0 6px;
    color: var(--app-text);
    font-size: 25px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  p:last-child {
    margin: 0;
    color: var(--app-muted);
    font-size: 13px;
  }

  .eyebrow {
    color: var(--app-primary);
  }
}

.form-options {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin: -4px 0 18px;
}

.form-options__tip {
  color: var(--app-muted);
  font-size: 11.5px;
}

.login-error {
  margin-bottom: 16px;
  border-radius: 9px;
}

.submit-button {
  width: 100%;
  height: 44px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(47, 107, 255, 0.24);
}

.dev-hint {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding: 12px 14px;
  background: #f7f9fd;
  border: 1px dashed #d8e0ef;
  border-radius: 10px;
}

.dev-hint__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.5;

  strong {
    color: var(--app-text-secondary);
    font-size: 11.5px;
    font-weight: 600;
  }

  span {
    overflow: hidden;
    color: var(--app-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.login-card__foot {
  margin: 18px 0 0;
  color: #a2abba;
  font-size: 11px;
  text-align: center;
}

:deep(.el-form-item__label) {
  color: var(--app-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
}

:deep(.el-input__wrapper) {
  padding: 4px 12px;
  background: #f9fafc;
  border-radius: 9px;
  box-shadow: 0 0 0 1px #e3e8f1 inset;
}

:deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px var(--app-primary) inset;
}

@media (max-width: 980px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .brand-panel {
    display: none;
  }

  .form-panel {
    padding: 28px 18px;
  }

  .login-card {
    padding: 30px 24px;
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
  }
}
</style>

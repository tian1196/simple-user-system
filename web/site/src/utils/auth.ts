export type AuthMode = 'login' | 'register' | 'recover'
export const POLICY_VERSION = '2026-11-05'

/** 登录后只允许跳转到本站用户区，拒绝外站、后台和登录页循环。 */
export function safeUserRedirect(value: unknown): string {
  if (typeof value !== 'string' || !/^\/app(?:\/|\?|$)/.test(value) || /[\\\r\n]/.test(value))
    return '/app'
  try {
    const url = new URL(value, 'https://ledger.local')
    if (
      url.origin !== 'https://ledger.local' ||
      !(url.pathname === '/app' || url.pathname.startsWith('/app/'))
    )
      return '/app'
    return url.pathname + url.search + url.hash
  } catch {
    return '/app'
  }
}

export interface AuthFields {
  username: string
  password: string
  invite: string
  recovery: string
  policy: boolean
}
export function validateAuth(mode: AuthMode, values: AuthFields): string {
  if (!values.username.trim()) return '请填写用户名'
  if (mode === 'register' && !/^[a-z0-9_]{4,32}$/.test(values.username.trim().toLowerCase()))
    return '用户名需为 4–32 位字母、数字或下划线'
  if (!values.password) return mode === 'recover' ? '请设置新密码' : '请填写密码'
  if (mode !== 'login' && (values.password.length < 8 || values.password.length > 128))
    return '密码长度需 8–128 位'
  if (mode === 'register' && !values.invite.trim()) return '请填写邀请码'
  if (mode === 'register' && !values.policy) return '请阅读并同意隐私说明'
  if (mode === 'recover' && !values.recovery.trim()) return '请填写一次性恢复码'
  return ''
}

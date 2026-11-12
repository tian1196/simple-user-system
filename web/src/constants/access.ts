/** 与 server/permissions.js 的角色、权限键保持一致。 */

export type StaffRole = 'admin' | 'operator' | 'support' | 'auditor' | 'partner'

export type PermissionKey =
  | 'overview.read'
  | 'users.read'
  | 'users.manage'
  | 'invites.manage'
  | 'accounts.manage'
  | 'settings.manage'
  | 'audit.read'
  | 'permissions.read'
  | 'saas.manage'

export const STAFF_ROLES: StaffRole[] = ['admin', 'operator', 'support', 'auditor', 'partner']

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: '管理员',
  operator: '运营',
  support: '客服',
  auditor: '审计',
  partner: '第三方',
}

export function roleTagType(role: StaffRole): 'warning' | 'primary' | 'success' | 'info' {
  if (role === 'admin') return 'warning'
  if (role === 'support') return 'success'
  if (role === 'auditor' || role === 'partner') return 'info'
  return 'primary'
}

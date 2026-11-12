import type { PermissionKey, StaffRole } from '@/constants/access'

export type AdminRole = StaffRole

export type UserStatus = 'active' | 'disabled'
export type UserStatusFilter = UserStatus | 'all'
export type InviteState = 'available' | 'used_up' | 'expired' | 'revoked'

export interface AdminProfile {
  id: string
  username: string
  role: AdminRole
  status: UserStatus
  created_at: number
  last_login_at: number | null
  permissions: PermissionKey[]
}

export interface LoginPayload {
  username: string
  password: string
  captcha_id: string
  captcha_text: string
}

export interface CaptchaChallenge {
  captcha_id: string
  image: string
}

export interface LoginResult {
  user: AdminProfile
}

export interface Overview {
  users: number
  devices: number
  new_users_7d: number
  registration_enabled: boolean
  writes_enabled: boolean
  backup_at: string | null
}

export interface AdminAccountItem {
  id: string
  username: string
  role: AdminRole
  status: UserStatus
  created_at: number
  last_login_at: number | null
  version: number
}

export interface CreateAdminAccountPayload {
  username: string
  password: string
  role: AdminRole
}

export interface UpdateAdminAccountPayload {
  role?: AdminRole
  status?: UserStatus
  version: number
}

export interface AdminUserItem {
  id: string
  username: string
  role: 'user'
  status: UserStatus
  created_at: number
  last_login_at: number | null
  version: number
  device_count: number
}

export interface UserQuery {
  q?: string
  status?: UserStatusFilter
}

export interface InviteItem {
  id: string
  max_uses: number
  used_count: number
  expires_at: number
  revoked_at: number | null
  created_at: number
}

export interface CreatedInvite {
  id: string
  code: string
  max_uses: number
  expires_at: number
}

export interface CreateInvitePayload {
  max_uses: number
  expires_on: string
}

export type SettingKey = 'registration_enabled' | 'writes_enabled'

export interface SettingItem {
  key: SettingKey
  value: boolean
  version: number
  updated_at: number
}

export type AuditResult = 'success' | 'failure' | string

export interface AuditLogItem {
  created_at: number
  action: string
  result: AuditResult
  target_type: string | null
  target_id: string | null
  actor: string | null
}

export interface PermissionItem {
  key: PermissionKey
  name: string
  description: string
}

export interface RoleItem {
  key: string
  name: string
  description: string
  staff: boolean
  permissions: PermissionKey[]
}

export interface SaasPlan {
  key: 'free' | 'pro' | 'enterprise'
  name: string
  description: string
  seats: number
  devices: number
}

export type SaasStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

export interface SaasTenant {
  id: string
  name: string
  slug: string
  plan: SaasPlan['key']
  status: SaasStatus
  seat_limit: number
  device_limit: number
  member_count: number
  device_count: number
  created_at: number
  updated_at: number
  version: number
}

export interface SaasOverview {
  plans: SaasPlan[]
  tenants: SaasTenant[]
}

export interface PermissionCatalog {
  permissions: PermissionItem[]
  roles: RoleItem[]
}

export interface ListResult<T> {
  items: T[]
}

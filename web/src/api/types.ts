export type AdminRole = 'owner' | 'operator'

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
}

export interface LoginPayload {
  username: string
  password: string
  totp: string
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

export interface AdminMfaProvisioning {
  secret: string
  otpauth_uri: string
  qrcode_data_url: string
}

export interface AdminAccountItem {
  id: string
  username: string
  role: AdminRole
  status: UserStatus
  created_at: number
  last_login_at: number | null
  version: number
  mfa_bound: boolean
}

export interface AdminAccountCreated extends AdminAccountItem {
  mfa: AdminMfaProvisioning
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

export interface ListResult<T> {
  items: T[]
}

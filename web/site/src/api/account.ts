import { request } from './request'
import type { DeviceSummary, MaintenanceLog, MaintenancePlan } from './devices'

export interface AccountExport {
  schema_version: number
  exported_on: string
  user: { id: string; username: string }
  devices: (DeviceSummary & { plans: MaintenancePlan[]; logs: MaintenanceLog[] })[]
}
/** 错误口令也是 401，不能因此清除有效会话；页面单独处理 AUTH_REQUIRED。 */
export function reauthenticate(password: string): Promise<{ valid_until: number }> {
  return request({ url: '/auth/reauth', method: 'post', data: { password }, allowGuest: true })
}
export function changePassword(
  current_password: string,
  new_password: string,
): Promise<{ recovery_code: string }> {
  return request({
    url: '/auth/password',
    method: 'put',
    data: { current_password, new_password },
    allowGuest: true,
  })
}
export function exportAccount(): Promise<AccountExport> {
  return request({ url: '/exports/account' })
}
export function deleteAccount(confirm_username: string): Promise<void> {
  return request({ url: '/me', method: 'delete', data: { confirm_username } })
}

import { request } from './request'
import type { SaasOverview, SaasPlan, SaasStatus, SaasTenant } from './types'

export function getSaas(): Promise<SaasOverview> {
  return request<SaasOverview>({
    url: '/admin/saas',
    method: 'get',
  })
}

export function updateTenant(
  id: string,
  payload: {
    plan: SaasPlan['key']
    status: SaasStatus
    seat_limit: number
    device_limit: number
    version: number
  },
): Promise<SaasTenant> {
  return request<SaasTenant>({
    url: `/admin/saas/tenants/${encodeURIComponent(id)}`,
    method: 'patch',
    data: payload,
  })
}

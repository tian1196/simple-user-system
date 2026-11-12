import { request } from './request'
import type { SaasAccount, SaasAccountPage, SaasOverview, SaasPlan, SaasStatus, SaasTenant } from './types'

export function getSaas(): Promise<SaasOverview> {
  return request<SaasOverview>({
    url: '/admin/saas',
    method: 'get',
  })
}

export function getSaasAccounts(query: {
  q?: string
  page: number
  page_size: number
}): Promise<SaasAccountPage> {
  const params: Record<string, string | number> = {
    page: query.page,
    page_size: query.page_size,
  }
  const keyword = query.q?.trim()
  if (keyword) params.q = keyword
  return request<SaasAccountPage>({
    url: '/admin/saas/accounts',
    method: 'get',
    params,
  })
}

export function updateTenant(
  id: string,
  payload: {
    plan: SaasPlan['key']
    status: SaasStatus
    version: number
  },
): Promise<SaasTenant> {
  return request<SaasTenant>({
    url: `/admin/saas/tenants/${encodeURIComponent(id)}`,
    method: 'patch',
    data: payload,
  })
}

export function updatePlan(
  id: string,
  payload: { seats: number; devices: number; version: number },
): Promise<SaasPlan> {
  return request<SaasPlan>({
    url: `/admin/saas/plans/${encodeURIComponent(id)}`,
    method: 'patch',
    data: payload,
  })
}

export function createPlan(payload: {
  name: string
  description: string
  seats: number
  devices: number
}): Promise<SaasPlan> {
  return request<SaasPlan>({
    url: '/admin/saas/plans',
    method: 'post',
    data: payload,
  })
}

export function assignAccountPlan(
  id: string,
  payload: {
    plan_id?: string
    status?: SaasStatus
    device_limit?: number
    follow_default?: boolean
    version: number
  },
): Promise<SaasAccount> {
  return request<SaasAccount>({
    url: `/admin/saas/users/${encodeURIComponent(id)}`,
    method: 'patch',
    data: payload,
  })
}

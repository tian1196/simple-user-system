import { request } from './request'
import type {
  AdminAccountItem,
  CreateAdminAccountPayload,
  ListResult,
  UpdateAdminAccountPayload,
} from './types'

export function getAdminAccounts(): Promise<ListResult<AdminAccountItem>> {
  return request<ListResult<AdminAccountItem>>({
    url: '/admin/accounts',
    method: 'get',
  })
}

export function createAdminAccount(payload: CreateAdminAccountPayload): Promise<AdminAccountItem> {
  return request<AdminAccountItem>({
    url: '/admin/accounts',
    method: 'post',
    data: payload,
  })
}

export function updateAdminAccount(
  id: string,
  payload: UpdateAdminAccountPayload,
): Promise<AdminAccountItem> {
  return request<AdminAccountItem>({
    url: `/admin/accounts/${encodeURIComponent(id)}`,
    method: 'patch',
    data: payload,
  })
}

export function resetAdminPassword(
  id: string,
  password: string,
  version: number,
): Promise<AdminAccountItem> {
  return request<AdminAccountItem>({
    url: `/admin/accounts/${encodeURIComponent(id)}/password`,
    method: 'put',
    data: { password, version },
  })
}

export function deleteAdminAccount(id: string, version: number): Promise<null> {
  return request<null>({
    url: `/admin/accounts/${encodeURIComponent(id)}`,
    method: 'delete',
    data: { version },
  })
}

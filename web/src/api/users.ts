import { request } from './request'
import type { AdminUserItem, ListResult, UserQuery, UserStatus } from './types'

export function getUsers(query: UserQuery = {}): Promise<ListResult<AdminUserItem>> {
  const params: Record<string, string> = {}
  const keyword = query.q?.trim()
  if (keyword) params.q = keyword
  if (query.status && query.status !== 'all') params.status = query.status

  return request<ListResult<AdminUserItem>>({
    url: '/admin/users',
    method: 'get',
    params,
  })
}

export function getUser(id: string): Promise<AdminUserItem> {
  return request<AdminUserItem>({
    url: `/admin/users/${encodeURIComponent(id)}`,
    method: 'get',
  })
}

export function updateUserStatus(
  id: string,
  status: UserStatus,
  version: number,
): Promise<AdminUserItem> {
  return request<AdminUserItem>({
    url: `/admin/users/${encodeURIComponent(id)}/status`,
    method: 'patch',
    data: { status, version },
  })
}

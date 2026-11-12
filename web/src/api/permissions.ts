import { request } from './request'
import type { PermissionCatalog } from './types'

export function getPermissionCatalog(): Promise<PermissionCatalog> {
  return request<PermissionCatalog>({
    url: '/admin/permissions',
    method: 'get',
  })
}

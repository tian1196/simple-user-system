import { request } from './request'
import type { AuditLogItem, ListResult } from './types'

export function getAuditLogs(): Promise<ListResult<AuditLogItem>> {
  return request<ListResult<AuditLogItem>>({
    url: '/admin/audit-logs',
    method: 'get',
  })
}

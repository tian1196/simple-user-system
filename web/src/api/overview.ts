import { request } from './request'
import type { Overview } from './types'

export function getOverview(): Promise<Overview> {
  return request<Overview>({
    url: '/admin/overview',
    method: 'get',
  })
}

import { request } from './request'
import type { ListResult, SettingItem, SettingKey } from './types'

export function getSettings(): Promise<ListResult<SettingItem>> {
  return request<ListResult<SettingItem>>({
    url: '/admin/settings',
    method: 'get',
  })
}

export function updateSetting(
  key: SettingKey,
  value: boolean,
  version: number,
): Promise<SettingItem> {
  return request<SettingItem>({
    url: `/admin/settings/${encodeURIComponent(key)}`,
    method: 'patch',
    data: { value, version },
  })
}

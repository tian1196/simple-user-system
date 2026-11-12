import type { DeviceList, DueList } from '../api/devices'

export function deviceIcon(category: string): string {
  const icons: Record<string, string> = {
    appliance: 'air-vent',
    computer: 'laptop',
    camera: 'camera',
  }
  return icons[category] || 'notebook-pen'
}
export function deviceOverview(devices: DeviceList, due: DueList) {
  return [
    { label: '已记录设备', value: devices.total },
    { label: '维护计划', value: devices.items.reduce((sum, device) => sum + device.plan_count, 0) },
    { label: '保修将到期', value: due.items.filter((item) => item.type === 'warranty').length },
  ]
}

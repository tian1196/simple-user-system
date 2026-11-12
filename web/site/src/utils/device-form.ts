import type { DeviceInput } from '../api/devices'
export const deviceCategories = [
  { value: 'appliance', label: '家电' },
  { value: 'computer', label: '电脑' },
  { value: 'camera', label: '相机' },
  { value: 'digital', label: '数码' },
  { value: 'other', label: '其他' },
]
export function ledgerToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function isLedgerDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}
export function validateDevice(value: DeviceInput, today = ledgerToday()): string {
  if (!value.name.trim() || value.name.trim().length > 80) return '设备名称需为 1–80 字'
  if (!deviceCategories.some((category) => category.value === value.category))
    return '请选择正确的设备类别'
  if (value.model.trim().length > 80) return '型号不能超过 80 字'
  if (value.note.trim().length > 500) return '备注不能超过 500 字'
  if (value.purchased_on && (!isLedgerDate(value.purchased_on) || value.purchased_on > today))
    return '购买日期必须是有效日期，且不能晚于今天'
  if (value.warranty_until && !isLedgerDate(value.warranty_until)) return '保修截止日期不正确'
  if (value.purchased_on && value.warranty_until && value.warranty_until < value.purchased_on)
    return '保修截止日期不能早于购买日期'
  return ''
}

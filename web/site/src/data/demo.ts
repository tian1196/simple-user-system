/** 演示数据独立于真实账户，仅保存在组件内存中。 */
export const DEMO_TODAY = '2026-11-05'
export interface DemoDevice {
  id: string
  name: string
  category: string
  icon: string
  model: string
  purchasedOn: string
  warrantyUntil: string
  plans: { title: string; intervalDays: number; dueOn: string }[]
}
export function createDemoDevices(): DemoDevice[] {
  return [
    {
      id: 'demo-air',
      name: '空气净化器',
      category: '家电',
      icon: 'air-vent',
      model: '演示型号 A',
      purchasedOn: '2025-06-01',
      warrantyUntil: '2027-06-01',
      plans: [{ title: '滤芯更换', intervalDays: 180, dueOn: '2026-11-02' }],
    },
    {
      id: 'demo-camera',
      name: '微单相机',
      category: '相机',
      icon: 'camera',
      model: '演示型号 B',
      purchasedOn: '2025-11-17',
      warrantyUntil: '2026-11-17',
      plans: [],
    },
    {
      id: 'demo-laptop',
      name: '工作笔记本',
      category: '电脑',
      icon: 'laptop',
      model: '',
      purchasedOn: '2023-06-12',
      warrantyUntil: '2025-06-12',
      plans: [{ title: '清洁检查', intervalDays: 90, dueOn: '2026-11-13' }],
    },
  ]
}
export function demoDaysUntil(date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${DEMO_TODAY}T00:00:00Z`)) / 86400000,
  )
}
export function demoDueLabel(date: string): string {
  const days = demoDaysUntil(date)
  return days < 0 ? `逾期 ${-days} 天` : days === 0 ? '今日到期' : `还有 ${days} 天`
}
export function demoWarrantyLabel(date: string): string {
  if (!date) return '保修日期未填写'
  const days = demoDaysUntil(date)
  return days < 0
    ? '保修已到期'
    : days <= 30
      ? days === 0
        ? '保修今日到期'
        : `保修剩余 ${days} 天`
      : `保修至 ${date}`
}
export function demoDueItems(devices: DemoDevice[]) {
  return devices
    .flatMap((device) => [
      ...device.plans.map((plan) => ({
        id: `${device.id}-plan-${plan.title}`,
        device,
        title: plan.title,
        dueOn: plan.dueOn,
      })),
      ...(device.warrantyUntil && demoDaysUntil(device.warrantyUntil) >= 0
        ? [{ id: `${device.id}-warranty`, device, title: '保修截止', dueOn: device.warrantyUntil }]
        : []),
    ])
    .filter((item) => demoDaysUntil(item.dueOn) <= 30)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
}
function calendarEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}
export function demoCalendar(devices: DemoDevice[]): string {
  const events = demoDueItems(devices).filter((item) => demoDaysUntil(item.dueOn) >= 0)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Device Ledger//Demo//ZH',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((item) => [
      'BEGIN:VEVENT',
      `UID:${calendarEscape(item.id)}@device-ledger-demo`,
      'DTSTAMP:20261105T000000Z',
      `DTSTART;VALUE=DATE:${item.dueOn.replace(/-/g, '')}`,
      `SUMMARY:${calendarEscape(`示例：${item.device.name} · ${item.title}`)}`,
      'DESCRIPTION:合成演示数据，以 2026-11-05 为基准，不是真实设备提醒。',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

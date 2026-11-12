import { request } from './request'

export interface DeviceSummary {
  id: string
  name: string
  category: string
  category_label: string
  model: string | null
  purchased_on: string | null
  warranty_until: string | null
  warranty_label: string
  note: string | null
  created_at: number
  updated_at: number
  version: number
  plan_count: number
}
export interface DeviceList {
  today: string
  items: DeviceSummary[]
  total: number
}
export interface DueItem {
  type: 'warranty' | 'plan'
  device_id: string
  device_name: string
  plan_id: string | null
  title: string
  due_on: string
  status: 'overdue' | 'today' | 'upcoming'
  label: string
}
export interface DueList {
  today: string
  items: DueItem[]
}

export function listDevices(signal?: AbortSignal): Promise<DeviceList> {
  return request({ url: '/devices', signal })
}
export function getDueItems(signal?: AbortSignal): Promise<DueList> {
  return request({ url: '/due-items', params: { days: 30 }, signal })
}
export function getCalendar(signal?: AbortSignal): Promise<string> {
  return request({ url: '/exports/calendar', params: { days: 30 }, responseType: 'text', signal })
}

export interface DeviceInput {
  name: string
  category: string
  model: string
  purchased_on: string
  warranty_until: string
  note: string
}
export interface MaintenancePlan {
  id: string
  device_id: string
  title: string
  interval_days: number
  next_due_on: string
  status: 'active' | 'paused'
  version: number
  due_status: 'overdue' | 'today' | 'upcoming' | 'paused'
  due_label: string
}
export interface MaintenanceLog {
  id: string
  device_id: string
  plan_id: string | null
  source: 'manual' | 'plan'
  title: string
  completed_on: string
  note: string | null
  voided_at: number | null
  can_void: boolean
  created_at: number
}
export interface DeviceDetail {
  device: DeviceSummary
  plans: MaintenancePlan[]
  logs: MaintenanceLog[]
}
export interface PlanInput {
  title: string
  interval_days: number
  next_due_on: string
}
export interface LogInput {
  completed_on: string
  note: string
  request_key: string
}
const devicePath = (id: string) => `/devices/${encodeURIComponent(id)}`
const planPath = (id: string) => `/plans/${encodeURIComponent(id)}`

export function getDevice(id: string, signal?: AbortSignal): Promise<DeviceDetail> {
  return request({ url: devicePath(id), signal })
}
export function createDevice(data: DeviceInput): Promise<DeviceSummary> {
  return request({ url: '/devices', method: 'post', data })
}
export function updateDevice(
  id: string,
  data: DeviceInput & { version: number },
): Promise<DeviceSummary> {
  return request({ url: devicePath(id), method: 'patch', data })
}
export function deleteDevice(id: string, version: number): Promise<void> {
  return request({ url: devicePath(id), method: 'delete', data: { version } })
}
export function createPlan(id: string, data: PlanInput): Promise<MaintenancePlan> {
  return request({ url: `${devicePath(id)}/plans`, method: 'post', data })
}
export function updatePlan(
  id: string,
  data: Partial<PlanInput> & { status?: 'active' | 'paused'; version: number },
): Promise<MaintenancePlan> {
  return request({ url: planPath(id), method: 'patch', data })
}
export function deletePlan(id: string, version: number): Promise<void> {
  return request({ url: planPath(id), method: 'delete', data: { version } })
}
export function completePlan(
  id: string,
  data: LogInput & { version: number },
): Promise<{ log: MaintenanceLog; plan: MaintenancePlan }> {
  return request({ url: `${planPath(id)}/completions`, method: 'post', data })
}
export function createManualLog(
  id: string,
  data: LogInput & { title: string },
): Promise<MaintenanceLog> {
  return request({ url: `${devicePath(id)}/logs`, method: 'post', data })
}
export function voidLog(
  id: string,
): Promise<{ log: MaintenanceLog; plan: MaintenancePlan | null }> {
  return request({ url: `/logs/${encodeURIComponent(id)}/void`, method: 'post' })
}

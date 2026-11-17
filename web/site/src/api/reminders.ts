import { request } from './request'
export interface ReminderSettings {
  warranty_enabled: boolean
  warranty_days: number
  maintenance_enabled: boolean
  maintenance_days: number
  version: number
}
export interface ReminderItem {
  type: 'plan' | 'warranty'
  target_id: string
  device_id: string
  device_name: string
  plan_id: string | null
  title: string
  due_on: string
  source_version: number
  status: 'overdue' | 'today' | 'upcoming'
  label: string
  in_window: boolean
  snoozed_until: string | null
  snooze_version: number
}
export type ReminderFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'snoozed'
export interface Reminders {
  today: string
  timezone: string
  settings: ReminderSettings
  items: ReminderItem[]
  counts: Record<ReminderFilter, number>
}
export const reminderDefaults = { warranty_enabled: true, warranty_days: 7, maintenance_enabled: true, maintenance_days: 3 }
export const getReminders = (signal?: AbortSignal) => request<Reminders>({ url: '/reminders', signal })
export const getReminderSettings = (signal?: AbortSignal) => request<ReminderSettings>({ url: '/reminders/settings', signal })
export const saveReminderSettings = (data: ReminderSettings) => request<ReminderSettings>({ url: '/reminders/settings', method: 'put', data })
function target(item: ReminderItem) {
  return { type: item.type, target_id: item.target_id, due_on: item.due_on, source_version: item.source_version, snooze_version: item.snooze_version }
}
export const snoozeReminder = (item: ReminderItem, days: number) => request<Reminders>({ url: '/reminders/snoozes', method: 'post', data: { ...target(item), days } })
export const restoreReminder = (item: ReminderItem) => request<Reminders>({ url: '/reminders/snoozes', method: 'delete', data: target(item) })

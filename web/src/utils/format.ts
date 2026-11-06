const pad = (value: number) => String(value).padStart(2, '0')

export function formatDateTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function formatCompactDateTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

export function formatDate(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatRelative(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '从未登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const diff = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(date.getTime())
}

export function dateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 返回今天往后 N 天的日期字符串，用于日期选择器默认值 */
export function dateAfter(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dateString(date)
}

/** Element Plus 日期选择器禁用今天之前的日期 */
export function disablePastDate(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '—'
  return id.length > length ? id.slice(0, length) : id
}

export function initialOf(name: string | null | undefined): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

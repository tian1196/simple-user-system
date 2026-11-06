function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + Number(days)))
  return date.toISOString().slice(0, 10)
}

function diffDays(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86400000)
}

function dueLabel(dueOn, todayValue = today()) {
  const delta = diffDays(todayValue, dueOn)
  if (delta < 0) return { status: 'overdue', label: `逾期 ${-delta} 天` }
  if (delta === 0) return { status: 'today', label: '今日到期' }
  return { status: 'upcoming', label: `还有 ${delta} 天` }
}

function warrantyLabel(until, todayValue = today()) {
  if (!until) return '保修未知'
  const delta = diffDays(todayValue, until)
  if (delta < 0) return '保修已到期'
  if (delta === 0) return '保修今日到期'
  return `保修剩余 ${delta} 天`
}

module.exports = { today, isDate, addDays, diffDays, dueLabel, warrantyLabel }

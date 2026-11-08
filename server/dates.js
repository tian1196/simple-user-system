/**
 * dates.js —— 业务日期工具。
 *
 * 整个系统在“按天”粒度上工作：购买日、保修截止、维护周期、
 * 到期判断都使用本地时区（Asia/Shanghai）下的 `YYYY-MM-DD` 字符串，
 * 而不是时间戳，避免因夏令时/时区换算造成跨天误差。
 *
 * 注意：en-CA 是 Intl 中稳定输出 `YYYY-MM-DD` 的取巧 locale，
 * 并不表示业务面向加拿大。
 */

/**
 * 返回上海时区的今天，格式 `YYYY-MM-DD`。
 * 所有“今天 / 是否到期”的判断都以这个日期为基准。
 */
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * 判断字符串是否为真实存在的日历日期（能拦住 2026-02-30 这类输入）。
 * 先用正则限定格式，再用 Date.UTC 往返校验年月日是否一致。
 * @param {unknown} value 待校验字符串
 * @returns {boolean}
 */
function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * 在某个日期上增加（或减少）若干天，返回新的 `YYYY-MM-DD`。
 * 用 UTC 运算 + toISOString 截断，避免本地时区参与。
 * @param {string} iso 起始日期
 * @param {number} days 天数，可为负数
 * @returns {string}
 */
function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + Number(days)))
  return date.toISOString().slice(0, 10)
}

/**
 * 计算两个日期相差的整天数：to - from。
 * 结果为正表示 to 在 from 之后，为负表示已过去。
 * @param {string} from 起始日期
 * @param {string} to 结束日期
 * @returns {number}
 */
function diffDays(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86400000)
}

/**
 * 给出维护计划的到期状态和中文文案。
 * @param {string} dueOn 到期日
 * @param {string} [todayValue] 基准“今天”，默认实时计算，测试可注入
 * @returns {{status:'overdue'|'today'|'upcoming', label:string}}
 */
function dueLabel(dueOn, todayValue = today()) {
  const delta = diffDays(todayValue, dueOn)
  if (delta < 0) return { status: 'overdue', label: `逾期 ${-delta} 天` }
  if (delta === 0) return { status: 'today', label: '今日到期' }
  return { status: 'upcoming', label: `还有 ${delta} 天` }
}

/**
 * 给出保修期的中文状态：未知 / 已到期 / 今日到期 / 剩余 N 天。
 * @param {string|null|undefined} until 保修截止日
 * @param {string} [todayValue] 基准“今天”，测试可注入
 * @returns {string}
 */
function warrantyLabel(until, todayValue = today()) {
  if (!until) return '保修未知'
  const delta = diffDays(todayValue, until)
  if (delta < 0) return '保修已到期'
  if (delta === 0) return '保修今日到期'
  return `保修剩余 ${delta} 天`
}

module.exports = { today, isDate, addDays, diffDays, dueLabel, warrantyLabel }

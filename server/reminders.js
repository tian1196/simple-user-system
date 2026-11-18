const dates = require('./dates')
const { transaction } = require('./database-tools')
const DEFAULTS = Object.freeze({ warranty_enabled: true, warranty_days: 7, maintenance_enabled: true, maintenance_days: 3 })

function createReminders(database, { fail, assertWrites }) {
  function settings(userId) {
    const row = database.prepare('SELECT * FROM reminder_settings WHERE user_id=?').get(userId)
    return row ? { warranty_enabled: Boolean(row.warranty_enabled), warranty_days: row.warranty_days,
      maintenance_enabled: Boolean(row.maintenance_enabled), maintenance_days: row.maintenance_days, version: row.version }
      : { ...DEFAULTS, version: 0 }
  }
  function saveSettings(userId, input) {
    assertWrites(userId)
    for (const key of ['warranty_enabled', 'maintenance_enabled']) {
      if (typeof input[key] !== 'boolean') throw fail(400, 'VALIDATION_ERROR', '提醒开关必须为布尔值')
    }
    if (![1, 3, 7, 14, 30].includes(input.warranty_days) || ![0, 1, 3, 7].includes(input.maintenance_days)) {
      throw fail(400, 'VALIDATION_ERROR', '请选择有效的提前提醒天数')
    }
    if (!Number.isInteger(input.version) || input.version !== settings(userId).version) {
      throw fail(409, 'VERSION_CONFLICT', '提醒设置已更新，请重新加载后再保存')
    }
    const values = [Number(input.warranty_enabled), input.warranty_days, Number(input.maintenance_enabled), input.maintenance_days, Date.now(), userId]
    if (input.version === 0) {
      const result = database.prepare(`INSERT OR IGNORE INTO reminder_settings
        (warranty_enabled,warranty_days,maintenance_enabled,maintenance_days,updated_at,user_id) VALUES(?,?,?,?,?,?)`).run(...values)
      if (!result.changes) throw fail(409, 'VERSION_CONFLICT', '提醒设置已更新，请重新加载')
    } else {
      const result = database.prepare(`UPDATE reminder_settings SET warranty_enabled=?,warranty_days=?,maintenance_enabled=?,maintenance_days=?,updated_at=?,version=version+1 WHERE user_id=? AND version=?`).run(...values, input.version)
      if (!result.changes) throw fail(409, 'VERSION_CONFLICT', '提醒设置已更新，请重新加载')
    }
    return settings(userId)
  }
  function list(userId, today = dates.today()) {
    const preference = settings(userId)
    const until = dates.addDays(today, 30)
    const rows = database.prepare(`SELECT 'plan' AS type, p.id AS target_id,p.device_id,p.id AS plan_id,
      d.name AS device_name,p.title,p.next_due_on AS due_on,p.version AS source_version
      FROM maintenance_plans p JOIN devices d ON d.id=p.device_id
      WHERE d.user_id=? AND p.status='active' AND p.next_due_on<=?
      UNION ALL SELECT 'warranty',d.id,d.id,NULL,d.name,'保修截止',d.warranty_until,d.version
      FROM devices d WHERE d.user_id=? AND d.warranty_until>=? AND d.warranty_until<=?`).all(userId, until, userId, today, until)
    const deferred = database.prepare('SELECT * FROM reminder_snoozes WHERE user_id=?').all(userId)
    const snoozes = new Map(deferred.map(row => [`${row.kind}:${row.target_id}`, row]))
    const items = rows.filter(row => row.type === 'plan' ? preference.maintenance_enabled : preference.warranty_enabled).map(row => {
      const saved = snoozes.get(`${row.type}:${row.target_id}`)
      const valid = saved?.due_on === row.due_on && saved.until_on > today
      const days = dates.diffDays(today, row.due_on)
      const inWindow = days <= (row.type === 'plan' ? preference.maintenance_days : preference.warranty_days)
      const status = dates.dueLabel(row.due_on, today)
      return { ...row, ...status, in_window: inWindow, snoozed_until: valid ? saved.until_on : null,
        snooze_version: saved?.version || 0 }
    }).sort((a, b) => a.due_on.localeCompare(b.due_on) || a.type.localeCompare(b.type) || a.target_id.localeCompare(b.target_id))
    const active = items.filter(row => row.in_window && !row.snoozed_until)
    return { today, timezone: 'Asia/Shanghai', settings: preference, items, counts: {
      all: active.length, overdue: active.filter(row => row.status === 'overdue').length,
      today: active.filter(row => row.status === 'today').length,
      upcoming: items.filter(row => row.status === 'upcoming' && !row.snoozed_until).length,
      snoozed: items.filter(row => row.snoozed_until).length,
    } }
  }
  function currentItem(userId, input, today) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['plan', 'warranty'].includes(input.type) ||
      typeof input.target_id !== 'string' || !input.target_id.trim() || !dates.isDate(input.due_on) ||
      !Number.isInteger(input.source_version) || input.source_version < 1 ||
      !Number.isInteger(input.snooze_version) || input.snooze_version < 0) {
      throw fail(400, 'VALIDATION_ERROR', '提醒事项不正确')
    }
    const item = list(userId, today).items.find(row => row.type === input.type && row.target_id === input.target_id)
    if (!item) throw fail(404, 'REMINDER_NOT_FOUND', '事项不存在、已暂停或已关闭，请刷新待办')
    if (item.due_on !== input.due_on || item.source_version !== input.source_version) {
      throw fail(409, 'VERSION_CONFLICT', '事项已完成或调整，请刷新待办')
    }
    return item
  }
  function snooze(userId, input, today = dates.today()) {
    assertWrites(userId)
    if (!input || ![1, 3, 7].includes(input.days)) throw fail(400, 'VALIDATION_ERROR', '请选择明天、3天后或7天后')
    return transaction(database, () => {
      const item = currentItem(userId, input, today)
      if (!item.in_window) throw fail(422, 'REMINDER_NOT_DUE', '事项尚未进入提醒窗口')
      const until = dates.addDays(today, input.days)
      if (item.type === 'warranty' && until > item.due_on) throw fail(422, 'WARRANTY_SNOOZE_LIMIT', '暂缓日期不能超过保修截止日')
      if (item.snooze_version !== input.snooze_version) {
        if (item.snoozed_until === until) return list(userId, today)
        throw fail(409, 'VERSION_CONFLICT', '暂缓状态已更新，请刷新待办')
      }
      database.prepare(`INSERT INTO reminder_snoozes(user_id,device_id,plan_id,kind,target_id,due_on,until_on,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET due_on=excluded.due_on,
        until_on=excluded.until_on,updated_at=excluded.updated_at,version=reminder_snoozes.version+1`).run(
        userId, item.device_id, item.plan_id, item.type, item.target_id, item.due_on, until, Date.now())
      return list(userId, today)
    })
  }
  function restore(userId, input, today = dates.today()) {
    assertWrites(userId)
    return transaction(database, () => {
      const item = currentItem(userId, input, today)
      if (!item.snoozed_until) return list(userId, today)
      if (item.snooze_version !== input.snooze_version) throw fail(409, 'VERSION_CONFLICT', '暂缓状态已更新，请刷新待办')
      // 保留递增版本，避免恢复后再次暂缓重置为1，让旧页面误恢复新的暂缓。
      database.prepare('UPDATE reminder_snoozes SET until_on=?,updated_at=?,version=version+1 WHERE user_id=? AND kind=? AND target_id=? AND version=?')
        .run(today, Date.now(), userId, item.type, item.target_id, item.snooze_version)
      return list(userId, today)
    })
  }
  function clearPlan(planId) { database.prepare('DELETE FROM reminder_snoozes WHERE plan_id=?').run(planId) }
  function clearWarranty(deviceId) { database.prepare("DELETE FROM reminder_snoozes WHERE kind='warranty' AND device_id=?").run(deviceId) }
  function exportData(userId) {
    return { settings: settings(userId), snoozes: database.prepare('SELECT kind,target_id,due_on,until_on FROM reminder_snoozes WHERE user_id=?').all(userId) }
  }
  return { settings, saveSettings, list, snooze, restore, clearPlan, clearWarranty, exportData }
}
module.exports = { createReminders, DEFAULTS }

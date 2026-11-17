const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { migrateReminders } = require('../server/reminder-migration')
const { createReminders, DEFAULTS } = require('../server/reminders')
const { openDatabase } = require('../server/database-tools')
const dates = require('../server/dates')
function fixture(t, upgrade = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-reminders-'))
  const filename = path.join(dir, 'test.sqlite')
  const db = new DatabaseSync(filename)
  db.exec(fs.readFileSync('migrations/001_initial.sql', 'utf8'))
  db.prepare('INSERT INTO users(id,username) VALUES(?,?)').run('u1', 'reminder_one')
  db.prepare('INSERT INTO users(id,username) VALUES(?,?)').run('u2', 'reminder_two')
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const backup = upgrade ? migrateReminders(db, filename) : null
  const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
  const api = upgrade ? createReminders(db, { fail, assertWrites: () => {} }) : null
  return { db, filename, backup, api }
}
function seed(db) {
  db.exec(`INSERT INTO devices(id,user_id,name,warranty_until) VALUES('d1','u1','设备一','2026-11-20'),('d2','u2','设备二','2026-11-14');
    INSERT INTO maintenance_plans(id,device_id,title,interval_days,next_due_on,status) VALUES
    ('past','d1','逾期维护',30,'2026-11-11','active'),('today','d1','今日维护',30,'2026-11-13','active'),
    ('soon','d1','近期维护',30,'2026-11-15','active'),('far','d1','远期维护',30,'2026-11-22','active'),
    ('paused','d1','已暂停',30,'2026-11-01','paused');`)
}
const target = item => ({ type: item.type, target_id: item.target_id, due_on: item.due_on, source_version: item.source_version, snooze_version: item.snooze_version })

test('reminder migration backs up WAL data, preserves business rows and is restart-safe', t => {
  const { db, filename } = fixture(t, false)
  db.exec("PRAGMA journal_mode=WAL; INSERT INTO devices(id,user_id,name) VALUES('keep','u1','保留设备')")
  const before = db.prepare('SELECT * FROM users ORDER BY id').all()
  const backupPath = migrateReminders(db, filename)
  const snapshot = new DatabaseSync(backupPath, { readOnly: true })
  assert.equal(snapshot.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(snapshot.prepare('SELECT count(*) AS n FROM devices').get().n, 1)
  snapshot.close()
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2)
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), before)
  assert.equal(migrateReminders(db, filename), null)
  const reopened = openDatabase(filename)
  reopened.connection.close()
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600)
})

test('failed reminder upgrade rolls back schema version and retains its recovery snapshot', t => {
  const { db, filename } = fixture(t, false)
  db.exec('CREATE TABLE reminder_settings(unexpected TEXT)')
  assert.throws(() => migrateReminders(db, filename), /already exists/)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 2)
  assert.equal(fs.readdirSync(path.dirname(filename)).filter(name => name.includes('.pre-reminders-')).length, 1)
})

test('reminder windows, future preview, disabling, dates and preferences isolate users', t => {
  const { db, api } = fixture(t)
  seed(db)
  const list = api.list('u1', '2026-11-13')
  assert.deepEqual(list.counts, { all: 4, overdue: 1, today: 1, upcoming: 3, snoozed: 0 })
  assert.equal(list.items.find(i => i.target_id === 'far').in_window, false)
  assert.equal(list.items.some(i => i.target_id === 'paused'), false)
  assert.equal(list.items.some(i => i.device_id === 'd2'), false)
  assert.equal(api.list('u1', '2026-11-12').items.find(i => i.type === 'warranty').in_window, false)
  assert.equal(api.list('u1', '2026-11-20').items.find(i => i.type === 'warranty').status, 'today')
  assert.equal(api.list('u1', '2026-11-21').items.some(i => i.type === 'warranty'), false)
  let settings = api.saveSettings('u1', { ...DEFAULTS, version: 0, warranty_enabled: false, maintenance_enabled: false })
  assert.equal(api.list('u1', '2026-11-13').items.length, 0)
  assert.equal(api.settings('u2').warranty_enabled, true)
  assert.throws(() => api.saveSettings('u1', { ...DEFAULTS, version: 0 }), e => e.code === 'VERSION_CONFLICT')
  assert.throws(() => api.saveSettings('u1', { ...settings, maintenance_days: 2 }), e => e.status === 400)
  assert.throws(() => api.saveSettings('u1', { ...settings, warranty_enabled: 'false' }), e => e.status === 400)
  settings = api.saveSettings('u1', { ...settings, ...DEFAULTS, maintenance_days: 0 })
  assert.equal(api.list('u1', '2026-11-13').counts.all, 3)
  assert.equal(db.prepare('SELECT count(*) AS n FROM maintenance_plans').get().n, 5)
})

test('snoozes expire at Shanghai date boundary without changing due dates, and reject stale or foreign targets', t => {
  const { db, api } = fixture(t)
  seed(db)
  const before = api.list('u1', '2026-11-13')
  const item = before.items.find(i => i.target_id === 'past')
  const request = { ...target(item), days: 1 }
  const saved = api.snooze('u1', request, '2026-11-13')
  assert.equal(saved.counts.all, 3)
  assert.equal(saved.counts.snoozed, 1)
  assert.equal(saved.items[0].snoozed_until, '2026-11-14')
  api.snooze('u1', request, '2026-11-13')
  assert.equal(db.prepare('SELECT count(*) AS n FROM reminder_snoozes').get().n, 1)
  assert.equal(db.prepare("SELECT next_due_on FROM maintenance_plans WHERE id='past'").get().next_due_on, '2026-11-11')
  assert.equal(api.list('u1', '2026-11-14').counts.snoozed, 0)
  assert.equal(api.list('u1', '2026-11-14').items[0].label, '逾期 3 天')
  assert.throws(() => api.snooze('u2', request, '2026-11-13'), e => e.status === 404)
  assert.throws(() => api.snooze('u1', { ...request, days: 2 }, '2026-11-13'), e => e.status === 400)
  const fresh = saved.items.find(i => i.target_id === 'past')
  api.snooze('u1', { ...target(fresh), days: 3 }, '2026-11-13')
  assert.throws(() => api.restore('u1', target(fresh), '2026-11-13'), e => e.status === 409)
  const latest = api.list('u1', '2026-11-13').items[0]
  assert.equal(api.restore('u1', target(latest), '2026-11-13').counts.snoozed, 0)
  const warranty = before.items.find(i => i.type === 'warranty')
  api.snooze('u1', { ...target(warranty), days: 7 }, '2026-11-13')
  const onLastDay = api.list('u1', '2026-11-20').items.find(i => i.type === 'warranty')
  assert.throws(() => api.snooze('u1', { ...target(onLastDay), days: 1 }, '2026-11-20'), e => e.code === 'WARRANTY_SNOOZE_LIMIT')
  assert.throws(() => api.snooze('u1', { ...request, due_on: '2026-11-10' }, '2026-11-13'), e => e.code === 'VERSION_CONFLICT')
  assert.equal(dates.diffDays('2026-12-31', dates.addDays('2026-12-31', 1)), 1)
})

test('real reminder APIs persist across restart and clear old snoozes on plan lifecycle changes', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-reminder-api-'))
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31998', HOST: '127.0.0.1' }
  const run = file => spawnSync(process.execPath, [file], { env, encoding: 'utf8' })
  assert.equal(run('scripts/db-init.js').status, 0)
  const invite = run('scripts/create-invite.js').stdout.match(/：([^\n]+)/)[1]
  let child
  const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done } }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }) })
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    for await (const chunk of child.stdout) if (chunk.toString().includes('设备台账已挂')) return
    throw new Error('backend failed')
  }
  await start()
  let cookie = ''
  async function req(route, method = 'GET', data, headers = {}) {
    const response = await fetch('http://127.0.0.1:31998/api/v1' + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) })
    const body = response.status === 204 ? null : await response.json()
    return { status: response.status, data: body?.data, response }
  }
  assert.equal((await req('/reminders')).status, 401)
  const registered = await req('/auth/register', 'POST', { username: 'reminder_flow', password: 'test-password-123', invite_code: invite, policy_version: '2026-11-05' })
  cookie = registered.response.headers.get('set-cookie').split(';')[0]
  let settings = (await req('/reminders/settings')).data
  settings = (await req('/reminders/settings', 'PUT', { ...settings, maintenance_days: 7 })).data
  assert.equal(settings.maintenance_days, 7)
  assert.equal((await req('/reminders/settings', 'PUT', settings, { Origin: 'https://evil.example' })).status, 403)
  const today = dates.today()
  const device = (await req('/devices', 'POST', { name: '提醒设备', warranty_until: dates.addDays(today, 2) })).data
  let plan = (await req(`/devices/${device.id}/plans`, 'POST', { title: '维护测试', interval_days: 30, next_due_on: dates.addDays(today, -2) })).data
  async function deferPlan() {
    const item = (await req('/reminders')).data.items.find(i => i.target_id === plan.id)
    const result = await req('/reminders/snoozes', 'POST', { ...target(item), days: 1 })
    assert.equal(result.status, 200)
  }
  await deferPlan()
  await stop(); await start()
  assert.equal((await req('/reminders')).data.counts.snoozed, 1)
  assert.equal((await req('/reminders/settings')).data.maintenance_days, 7)
  const completed = (await req(`/plans/${plan.id}/completions`, 'POST', { version: plan.version, completed_on: today, note: '', request_key: 'reminder-complete' })).data
  assert.equal(completed.plan.next_due_on, dates.addDays(today, 30))
  assert.equal((await req('/reminders')).data.counts.snoozed, 0)
  plan = (await req(`/logs/${completed.log.id}/void`, 'POST', {})).data.plan
  assert.equal(plan.next_due_on, dates.addDays(today, -2))
  await deferPlan()
  plan = (await req(`/plans/${plan.id}`, 'PATCH', { version: plan.version, status: 'paused' })).data
  assert.equal((await req('/reminders')).data.items.some(i => i.target_id === plan.id), false)
  plan = (await req(`/plans/${plan.id}`, 'PATCH', { version: plan.version, status: 'active' })).data
  assert.equal((await req('/reminders')).data.counts.snoozed, 0)
  await deferPlan()
  plan = (await req(`/plans/${plan.id}`, 'PATCH', { version: plan.version, next_due_on: dates.addDays(today, 3) })).data
  assert.equal((await req('/reminders')).data.counts.snoozed, 0)
  const warranty = (await req('/reminders')).data.items.find(i => i.type === 'warranty')
  assert.equal((await req('/reminders/snoozes', 'POST', { ...target(warranty), days: 3 })).status, 422)
  await req('/reminders/snoozes', 'POST', { ...target(warranty), days: 1 })
  await req(`/devices/${device.id}`, 'PATCH', { version: device.version, name: '改期设备', warranty_until: dates.addDays(today, 7) })
  assert.equal((await req('/reminders')).data.counts.snoozed, 0)
  await req('/auth/reauth', 'POST', { password: 'test-password-123' })
  const exported = (await req('/exports/account')).data
  assert.equal(exported.reminders.settings.maintenance_days, 7)
  assert.equal((await req('/me', 'DELETE', { confirm_username: 'reminder_flow' })).status, 204)
  assert.equal((await req('/auth/me')).status, 401)
  const db = new DatabaseSync(env.DATABASE_PATH)
  assert.equal(db.prepare('SELECT count(*) AS n FROM reminder_settings').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM reminder_snoozes').get().n, 0)
  db.close()
})

test('Shanghai midnight expires snoozes even while UTC remains the previous date', t => {
  const { db, api } = fixture(t)
  seed(db)
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T15:59:59Z').getTime() })
  assert.equal(dates.today(), '2026-11-13')
  const item = api.list('u1').items.find(i => i.target_id === 'past')
  api.snooze('u1', { ...target(item), days: 1 })
  assert.equal(api.list('u1').counts.snoozed, 1)
  t.mock.timers.tick(1000)
  assert.equal(dates.today(), '2026-11-14')
  assert.equal(new Date().toISOString().slice(0, 10), '2026-11-13')
  assert.equal(api.list('u1').counts.snoozed, 0)
  assert.equal(api.list('u1').items[0].label, '逾期 3 天')
})

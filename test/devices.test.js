const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const dates = require('../server/dates')

test('device overview counts all plans and only warranty due items', async () => {
  const { deviceIcon, deviceOverview } = await import('../web/site/src/utils/devices.ts')
  assert.equal(deviceIcon('computer'), 'laptop')
  assert.equal(deviceIcon('unknown-category'), 'notebook-pen')
  assert.deepEqual(deviceOverview({ total: 2, items: [{ plan_count: 3 }, { plan_count: 1 }] }, { items: [{ type: 'plan' }, { type: 'warranty' }] }).map(metric => metric.value), [2, 4, 1])
  assert.deepEqual(deviceOverview({ total: 0, items: [] }, { items: [] }).map(metric => metric.value), [0, 0, 0])
})

test('private ledger APIs return empty and populated states, real calendar and isolate users', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-devices-'))
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31991', HOST: '127.0.0.1' }
  const run = script => spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(run('scripts/db-init.js').status, 0)
  const invite = run('scripts/create-invite.js')
  assert.equal(invite.status, 0, invite.stderr)
  const code = invite.stdout.match(/：([^\n]+)/)[1]
  const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(async () => {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  for await (const chunk of child.stdout) { if (chunk.toString().includes('设备台账已挂')) break }
  const base = 'http://127.0.0.1:31991/api/v1'
  let cookie = ''
  async function request(route, method = 'GET', data) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: data === undefined ? undefined : JSON.stringify(data) })
    const body = response.status === 204 ? null : await response.json()
    return { response, body }
  }
  async function register(name) {
    const result = await request('/auth/register', 'POST', { username: name, password: 'test-password-123', invite_code: code, policy_version: '2026-11-05' })
    assert.equal(result.response.status, 201)
    cookie = result.response.headers.get('set-cookie').split(';')[0]
  }
  assert.equal((await request('/devices')).response.status, 401)
  await register('devices_test')
  assert.equal((await request('/devices')).body.data.total, 0)
  assert.deepEqual((await request('/due-items?days=30')).body.data.items, [])
  const today = dates.today()
  const device = (await request('/devices', 'POST', { name: '测试电脑', category: 'computer', warranty_until: dates.addDays(today, 12) })).body.data
  const plan = await request(`/devices/${device.id}/plans`, 'POST', { title: '清洁', interval_days: 90, next_due_on: dates.addDays(today, -3) })
  assert.equal(plan.response.status, 201)
  const listed = (await request('/devices')).body.data
  assert.equal(listed.total, 1)
  assert.equal(listed.items[0].plan_count, 1)
  assert.equal(listed.items[0].category_label, '电脑')
  const due = (await request('/due-items?days=30')).body.data
  assert.equal(due.today, today)
  assert.equal(due.items.length, 2)
  assert.equal(due.items[0].status, 'overdue')
  assert.equal(due.items[0].label, '逾期 3 天')
  const calendar = await fetch(base + '/exports/calendar?days=30', { headers: { Cookie: cookie } })
  assert.equal(calendar.status, 200)
  assert.match(calendar.headers.get('content-type'), /text\/calendar/)
  const text = await calendar.text()
  assert.match(text, /BEGIN:VCALENDAR/)
  assert.match(text, /保修截止/)
  assert.doesNotMatch(text, /SUMMARY:测试电脑 清洁/)
  const completed = await request(`/plans/${plan.body.data.id}/completions`, 'POST', { completed_on: today, note: '完成清洁', request_key: 'complete-test', version: plan.body.data.version })
  assert.equal(completed.response.status, 201)
  assert.equal(completed.body.data.plan.next_due_on, dates.addDays(today, 90))
  const paused = await request(`/plans/${plan.body.data.id}`, 'PATCH', { status: 'paused', version: completed.body.data.plan.version })
  assert.equal(paused.body.data.status, 'paused')
  const resumed = await request(`/plans/${plan.body.data.id}`, 'PATCH', { status: 'active', next_due_on: dates.addDays(today, 5), version: paused.body.data.version })
  assert.equal(resumed.body.data.status, 'active')
  assert.equal((await request(`/plans/${plan.body.data.id}`, 'PATCH', { title: 'stale', version: paused.body.data.version })).response.status, 409)
  assert.equal((await request(`/logs/${completed.body.data.log.id}/void`, 'POST', {})).response.status, 422)
  const manualBody = { title: '外壳清洁', completed_on: today, note: '手工记录', request_key: 'manual-test' }
  const manual = await request(`/devices/${device.id}/logs`, 'POST', manualBody)
  assert.equal(manual.response.status, 201)
  const replay = await request(`/devices/${device.id}/logs`, 'POST', manualBody)
  assert.equal(replay.body.data.id, manual.body.data.id)
  assert.equal((await request(`/logs/${manual.body.data.id}/void`, 'POST', {})).response.status, 200)
  const changed = await request(`/devices/${device.id}`, 'PATCH', { name: '更新后的电脑', category: 'computer', version: device.version })
  assert.equal(changed.response.status, 200)
  assert.equal((await request(`/devices/${device.id}`, 'PATCH', { name: '旧版本', version: device.version })).response.status, 409)
  const completedAgain = await request(`/plans/${plan.body.data.id}/completions`, 'POST', { completed_on: today, note: '', request_key: 'complete-second', version: resumed.body.data.version })
  assert.equal(completedAgain.response.status, 201)
  const restored = await request(`/logs/${completedAgain.body.data.log.id}/void`, 'POST', {})
  assert.equal(restored.response.status, 200)
  assert.equal(restored.body.data.plan.next_due_on, dates.addDays(today, 5))
  const ownerCookie = cookie
  await register('other_device_user')
  assert.equal((await request('/devices')).body.data.total, 0)
  assert.deepEqual((await request('/due-items?days=30')).body.data.items, [])
  assert.equal((await request(`/devices/${device.id}`)).response.status, 404)
  cookie = ownerCookie
  assert.equal((await request(`/plans/${plan.body.data.id}`, 'DELETE', { version: restored.body.data.plan.version })).response.status, 204)
  assert.equal((await request(`/devices/${device.id}`, 'DELETE', { version: changed.body.data.version })).response.status, 204)
  assert.equal((await request(`/devices/${device.id}`)).response.status, 404)
})

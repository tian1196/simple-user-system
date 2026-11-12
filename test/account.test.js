const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { openDatabase } = require('../server/database-tools')

test('account reauthentication, credential rotation, private export and deletion lifecycle', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-account-'))
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31993', HOST: '127.0.0.1' }
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
  let cookie = ''
  async function request(route, method = 'GET', data) {
    const response = await fetch('http://127.0.0.1:31993/api/v1' + route, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { response, body: response.status === 204 ? null : await response.json() }
  }
  const registered = await request('/auth/register', 'POST', { username: 'account_test', password: 'test-password-123', invite_code: code, policy_version: '2026-11-05' })
  assert.equal(registered.response.status, 201)
  cookie = registered.response.headers.get('set-cookie').split(';')[0]
  const device = (await request('/devices', 'POST', { name: '账户测试设备', category: 'computer' })).body.data
  await request(`/devices/${device.id}/plans`, 'POST', { title: '清洁', interval_days: 90, next_due_on: '2026-11-12' })
  await request(`/devices/${device.id}/logs`, 'POST', { title: '检查', completed_on: '2026-11-01', request_key: 'account-test-log' })
  assert.equal((await request('/exports/account')).body.error.code, 'REAUTH_REQUIRED')
  assert.equal((await request('/me', 'DELETE', { confirm_username: 'account_test' })).response.status, 403)
  assert.equal((await request('/auth/reauth', 'POST', { password: 'wrong' })).response.status, 401)
  assert.equal((await request('/auth/me')).response.status, 200, 'wrong password must not invalidate the session')
  assert.equal((await request('/auth/reauth', 'POST', { password: 'test-password-123' })).response.status, 200)
  const exported = (await request('/exports/account')).body.data
  assert.equal(exported.user.username, 'account_test')
  assert.equal(exported.devices.length, 1)
  assert.equal(exported.devices[0].plans.length, 1)
  assert.equal(exported.devices[0].logs.length, 1)
  assert.doesNotMatch(JSON.stringify(exported), /password_hash|recovery_code|token_hash|test-password/)
  assert.equal((await request('/auth/password', 'PUT', { current_password: 'wrong', new_password: 'new-password-456' })).response.status, 401)
  assert.equal((await request('/auth/me')).response.status, 200)
  const changed = await request('/auth/password', 'PUT', { current_password: 'test-password-123', new_password: 'new-password-456' })
  assert.equal(changed.response.status, 200)
  assert.notEqual(changed.body.data.recovery_code, registered.body.data.recovery_code)
  assert.equal((await request('/auth/me')).response.status, 401)
  assert.equal((await request('/auth/login', 'POST', { username: 'account_test', password: 'test-password-123' })).response.status, 401)
  assert.equal((await request('/auth/recover', 'POST', { username: 'account_test', recovery_code: registered.body.data.recovery_code, new_password: 'other-password' })).response.status, 401)
  const loggedIn = await request('/auth/login', 'POST', { username: 'account_test', password: 'new-password-456' })
  assert.equal(loggedIn.response.status, 200)
  cookie = loggedIn.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/exports/account')).response.status, 403)
  await request('/auth/reauth', 'POST', { password: 'new-password-456' })
  assert.equal((await request('/me', 'DELETE', { confirm_username: 'wrong_user' })).response.status, 400)
  assert.equal((await request('/auth/me')).response.status, 200)
  assert.equal((await request('/me', 'DELETE', { confirm_username: 'account_test' })).response.status, 204)
  assert.equal((await request('/auth/me')).response.status, 401)
  assert.equal((await request('/auth/login', 'POST', { username: 'account_test', password: 'new-password-456' })).response.status, 401)
  const store = openDatabase(env.DATABASE_PATH)
  try {
    for (const table of ['devices', 'maintenance_plans', 'maintenance_logs']) {
      assert.equal(store.connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
    }
  } finally { store.connection.close() }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { openDatabase } = require('../server/database-tools')

test('merged account, device, maintenance and deployment tools', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-merge-'))
  const filename = path.join(dir, 'test.sqlite')
  const env = { ...process.env, DATABASE_PATH: filename, PORT: '31987', HOST: '127.0.0.1', APP_ORIGINS: 'http://127.0.0.1:31987' }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const run = (script, args = []) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
  assert.equal(run('scripts/db-init.js').status, 0)
  assert.notEqual(run('scripts/db-init.js').status, 0, 'must not overwrite a database')
  assert.equal(run('scripts/db-check.js').status, 0)
  assert.throws(() => openDatabase(path.join(dir, 'missing.sqlite')), /不存在/)
  const invite = run('scripts/create-invite.js')
  assert.equal(invite.status, 0, invite.stderr)
  const code = invite.stdout.match(/：([^\n]+)/)[1]
  const store = openDatabase(filename)
  store.connection.prepare("INSERT INTO users(id,username,role) VALUES('owner-id','owner','owner')").run()
  store.connection.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_key,password_hash) VALUES('owner-auth','owner-id','password','owner',?)").run(require('bcryptjs').hashSync('owner-test-password', 10))
  store.connection.close()
  let child
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for await (const chunk of child.stdout) { output += chunk; if (output.includes('设备台账已挂')) return }
    throw new Error('server failed to start')
  }
  async function stop() { if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done } }
  t.after(stop)
  await start()
  let cookie = ''
  async function request(route, method = 'GET', data, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${env.PORT}/api/v1${route}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { response, body: response.status === 204 ? null : await response.json() }
  }
  assert.equal((await request('/devices')).response.status, 401)
  assert.equal((await request('/health/ready')).body.database.connected, true)
  const registered = await request('/auth/register', 'POST', { username: 'merge_user', password: 'test-password-123', invite_code: code, policy_version: '2026-11-05' })
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body))
  cookie = registered.response.headers.get('set-cookie').split(';')[0]
  assert.match(registered.response.headers.get('set-cookie'), /HttpOnly/)
  const duplicate = await request('/auth/register', 'POST', { username: 'merge_user', password: 'test-password-123', invite_code: code, policy_version: '2026-11-05' })
  assert.equal(duplicate.response.status, 409)
  assert.equal((await request('/devices', 'POST', { name: 'blocked' }, { Origin: 'https://evil.example' })).response.status, 403)
  const created = await request('/devices', 'POST', { name: '合并测试设备', category: 'computer' })
  assert.equal(created.response.status, 201, JSON.stringify(created.body))
  const device = created.body.data
  const plan = await request(`/devices/${device.id}/plans`, 'POST', { title: '清洁', interval_days: 30, next_due_on: '2026-11-06' })
  assert.equal(plan.response.status, 201, JSON.stringify(plan.body))
  assert.equal((await request(`/devices/${device.id}`)).body.data.plans.length, 1)
  assert.equal((await request(`/devices/${device.id}`, 'PATCH', { name: '更新', version: 99 })).response.status, 409)
  await stop(); await start()
  assert.equal((await request('/auth/me')).body.data.username, 'merge_user')
  assert.equal((await request('/devices')).body.data.total, 1)
  assert.equal((await request('/auth/logout', 'POST', {})).response.status, 204)
  assert.equal((await request('/devices')).response.status, 401)
  const admin = await request('/admin/auth/login', 'POST', { username: 'owner', password: 'owner-test-password', totp: '123456' })
  assert.equal(admin.response.status, 200, JSON.stringify(admin.body))
  cookie = admin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/admin/overview')).response.status, 200)
})

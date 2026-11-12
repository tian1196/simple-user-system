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
  const env = {
    ...process.env,
    DATABASE_PATH: filename,
    PORT: '31987',
    HOST: '127.0.0.1',
    APP_ORIGINS: 'http://127.0.0.1:31987',
    CAPTCHA_DEBUG: '1',
  }
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
  store.connection.prepare("INSERT INTO users(id,username,role) VALUES('owner-id','owner','admin')").run()
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
  async function captchaLogin(username, password) {
    const challenge = await request('/admin/auth/captcha')
    assert.equal(challenge.response.status, 200, JSON.stringify(challenge.body))
    assert.ok(challenge.body.data.captcha_id)
    assert.ok(challenge.body.data.image)
    assert.ok(challenge.body.data.captcha_text)
    return request('/admin/auth/login', 'POST', {
      username,
      password,
      captcha_id: challenge.body.data.captcha_id,
      captcha_text: challenge.body.data.captcha_text,
    })
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
  const me = await request('/auth/me')
  assert.equal(me.body.data.username, 'merge_user')
  assert.deepEqual(me.body.data.permissions, [])
  assert.equal((await request('/devices')).body.data.total, 1)
  assert.equal((await request('/auth/logout', 'POST', {})).response.status, 204)
  assert.equal((await request('/devices')).response.status, 401)

  assert.equal((await request('/admin/auth/login', 'POST', {
    username: 'owner',
    password: 'owner-test-password',
    captcha_id: 'missing',
    captcha_text: 'ABCD',
  })).response.status, 400)

  const admin = await captchaLogin('owner', 'owner-test-password')
  assert.equal(admin.response.status, 200, JSON.stringify(admin.body))
  cookie = admin.response.headers.get('set-cookie').split(';')[0]
  const adminCookie = cookie
  assert.equal((await request('/admin/overview')).response.status, 200)
  const listed = await request('/admin/users?q=merge_user')
  const mergeUser = listed.body.data.items.find((item) => item.username === 'merge_user')
  const resetUser = await request(`/admin/users/${mergeUser.id}/password`, 'PUT', { version: mergeUser.version })
  assert.equal(resetUser.response.status, 200, JSON.stringify(resetUser.body))
  assert.match(resetUser.body.data.password, /^Ld[A-Za-z]{2}\d{2}-[A-Za-z]{4}-\d{4}$/)
  assert.equal((await request('/auth/login', 'POST', { username: 'merge_user', password: 'test-password-123' })).response.status, 401)
  const relogin = await request('/auth/login', 'POST', { username: 'merge_user', password: resetUser.body.data.password })
  assert.equal(relogin.response.status, 200, JSON.stringify(relogin.body))
  cookie = adminCookie

  const ownerCookie = cookie
  const accountsBefore = await request('/admin/accounts')
  assert.equal(accountsBefore.response.status, 200)
  assert.equal(accountsBefore.body.data.items.length, 1)
  const ownerAccount = accountsBefore.body.data.items[0]
  assert.equal(ownerAccount.role, 'admin')
  assert.ok(admin.body.data.user.permissions.includes('accounts.manage'))

  const createdOperator = await request('/admin/accounts', 'POST', {
    username: 'ops_user',
    password: 'ops-password-123',
    role: 'operator',
  })
  assert.equal(createdOperator.response.status, 201, JSON.stringify(createdOperator.body))
  const operator = createdOperator.body.data
  assert.equal(operator.role, 'operator')
  assert.equal(operator.status, 'active')

  assert.equal((await request('/admin/accounts', 'POST', {
    username: 'ops_user',
    password: 'ops-password-123',
    role: 'operator',
  })).response.status, 409)
  assert.equal((await request('/admin/accounts', 'POST', {
    username: 'bad_admin',
    password: 'bad-admin-password',
    role: 'user',
  })).response.status, 400)

  const operatorLogin = await captchaLogin('ops_user', 'ops-password-123')
  assert.equal(operatorLogin.response.status, 200, JSON.stringify(operatorLogin.body))
  cookie = operatorLogin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/admin/accounts')).response.status, 403)
  cookie = ownerCookie

  const partner = await request('/admin/accounts', 'POST', {
    username: 'partner_user',
    password: 'partner-password-1',
    role: 'partner',
  })
  assert.equal(partner.response.status, 201, JSON.stringify(partner.body))
  const auditor = await request('/admin/accounts', 'POST', {
    username: 'audit_user',
    password: 'auditor-password-1',
    role: 'auditor',
  })
  assert.equal(auditor.response.status, 201, JSON.stringify(auditor.body))
  const catalog = await request('/admin/permissions')
  assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body))
  assert.deepEqual(catalog.body.data.roles.map((item) => item.key), ['admin', 'operator', 'support', 'auditor', 'partner', 'user'])
  const partnerLogin = await captchaLogin('partner_user', 'partner-password-1')
  assert.equal(partnerLogin.response.status, 200, JSON.stringify(partnerLogin.body))
  cookie = partnerLogin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/admin/overview')).response.status, 200)
  assert.equal((await request('/admin/users')).response.status, 403)
  assert.equal((await request('/admin/accounts')).response.status, 403)
  const auditorLogin = await captchaLogin('audit_user', 'auditor-password-1')
  cookie = auditorLogin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/admin/audit-logs')).response.status, 200)
  assert.equal((await request('/admin/settings')).response.status, 403)
  cookie = ownerCookie
  assert.equal((await request(`/admin/accounts/${partner.body.data.id}`, 'DELETE', { version: partner.body.data.version })).response.status, 204)
  assert.equal((await request(`/admin/accounts/${auditor.body.data.id}`, 'DELETE', { version: auditor.body.data.version })).response.status, 204)

  assert.equal((await request(`/admin/accounts/${operator.id}`, 'PATCH', {
    status: 'disabled',
    version: 999,
  })).response.status, 409)

  const disabled = await request(`/admin/accounts/${operator.id}`, 'PATCH', {
    status: 'disabled',
    version: operator.version,
  })
  assert.equal(disabled.response.status, 200, JSON.stringify(disabled.body))
  assert.equal(disabled.body.data.status, 'disabled')
  assert.equal((await captchaLogin('ops_user', 'ops-password-123')).response.status, 403)

  const enabled = await request(`/admin/accounts/${operator.id}`, 'PATCH', {
    status: 'active',
    version: disabled.body.data.version,
  })
  assert.equal(enabled.response.status, 200, JSON.stringify(enabled.body))

  const reset = await request(`/admin/accounts/${operator.id}/password`, 'PUT', {
    password: 'ops-password-456',
    version: enabled.body.data.version,
  })
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body))
  assert.equal((await captchaLogin('ops_user', 'ops-password-123')).response.status, 401)
  assert.equal((await captchaLogin('ops_user', 'ops-password-456')).response.status, 200)

  cookie = ownerCookie
  assert.equal((await request(`/admin/accounts/${ownerAccount.id}`, 'PATCH', {
    role: 'operator',
    version: ownerAccount.version,
  })).response.status, 409)
  assert.equal((await request(`/admin/accounts/${ownerAccount.id}`, 'PATCH', {
    status: 'disabled',
    version: ownerAccount.version,
  })).response.status, 409)
  assert.equal((await request(`/admin/accounts/${ownerAccount.id}`, 'DELETE', {
    version: ownerAccount.version,
  })).response.status, 409)

  const secondOwner = await request('/admin/accounts', 'POST', {
    username: 'owner_two',
    password: 'owner-two-password',
    role: 'admin',
  })
  assert.equal(secondOwner.response.status, 201, JSON.stringify(secondOwner.body))
  assert.equal((await request(`/admin/accounts/${secondOwner.body.data.id}`, 'DELETE', {
    version: secondOwner.body.data.version,
  })).response.status, 204)

  assert.equal((await request(`/admin/accounts/${operator.id}`, 'DELETE', {
    version: reset.body.data.version,
  })).response.status, 204)
  const accountsAfter = await request('/admin/accounts')
  assert.equal(accountsAfter.body.data.items.length, 1)
})

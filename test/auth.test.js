const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')

test('auth form validation and return paths reject malformed input and external redirects', async () => {
  const { safeUserRedirect, validateAuth } = await import('../web/site/src/utils/auth.ts')
  for (const target of ['https://example.com', '//example.com', '/admin', '/app/../admin', '/app\\evil', '/login', ['/app']]) {
    assert.equal(safeUserRedirect(target), '/app')
  }
  assert.equal(safeUserRedirect('/app/devices/device-1?tab=plans'), '/app/devices/device-1?tab=plans')
  const fields = { username: 'test_user', password: 'test-password', invite: 'invite', recovery: 'code', policy: true }
  assert.equal(validateAuth('register', fields), '')
  assert.match(validateAuth('register', { ...fields, policy: false }), /隐私/)
  assert.match(validateAuth('register', { ...fields, username: 'x' }), /用户名/)
  assert.match(validateAuth('recover', { ...fields, password: 'short' }), /8–128/)
  assert.match(validateAuth('recover', { ...fields, recovery: ' ' }), /恢复码/)
  assert.match(validateAuth('login', { ...fields, username: ' ' }), /用户名/)
})

test('user auth lifecycle: invite registration, Cookie login, recovery rotation and session revocation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-user-auth-'))
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31989', HOST: '127.0.0.1', APP_ORIGINS: 'http://127.0.0.1:31989' }
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
  async function request(route, method = 'GET', body) {
    const response = await fetch('http://127.0.0.1:31989/api/v1' + route, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { response, data: response.status === 204 ? null : await response.json() }
  }
  const payload = { username: 'auth_test', password: 'test-password-123', invite_code: code, policy_version: '2026-11-05' }
  assert.equal((await request('/auth/register', 'POST', { ...payload, invite_code: 'invalid' })).response.status, 422)
  const registered = await request('/auth/register', 'POST', payload)
  assert.equal(registered.response.status, 201)
  assert.ok(registered.data.data.recovery_code)
  assert.match(registered.response.headers.get('set-cookie'), /HttpOnly/)
  cookie = registered.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/auth/me')).data.data.username, 'auth_test')
  assert.equal((await request('/auth/register', 'POST', payload)).response.status, 409)
  const oldCookie = cookie
  const oldCode = registered.data.data.recovery_code
  assert.equal((await request('/auth/login', 'POST', { username: 'auth_test', password: 'wrong' })).response.status, 401)
  assert.equal((await request('/auth/recover', 'POST', { username: 'auth_test', recovery_code: 'wrong', new_password: 'new-password-456' })).response.status, 401)
  const recovered = await request('/auth/recover', 'POST', { username: 'auth_test', recovery_code: oldCode, new_password: 'new-password-456' })
  assert.equal(recovered.response.status, 200)
  assert.notEqual(recovered.data.data.recovery_code, oldCode)
  cookie = oldCookie
  assert.equal((await request('/auth/me')).response.status, 401)
  assert.equal((await request('/auth/login', 'POST', { username: 'auth_test', password: payload.password })).response.status, 401)
  assert.equal((await request('/auth/recover', 'POST', { username: 'auth_test', recovery_code: oldCode, new_password: 'another-password' })).response.status, 401)
  const loggedIn = await request('/auth/login', 'POST', { username: 'AUTH_TEST', password: 'new-password-456' })
  assert.equal(loggedIn.response.status, 200)
  cookie = loggedIn.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/auth/me')).data.data.role, 'user')
  assert.equal((await request('/auth/logout', 'POST')).response.status, 204)
  assert.equal((await request('/auth/me')).response.status, 401)
})

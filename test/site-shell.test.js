const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')

test('user site shell keeps SPA deep links, API and admin entry isolated', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-site-shell-'))
  const site = path.join(dir, 'site')
  const admin = path.join(dir, 'admin')
  fs.mkdirSync(site)
  fs.mkdirSync(admin)
  fs.writeFileSync(path.join(site, 'index.html'), '<html>user-site-shell</html>')
  fs.writeFileSync(path.join(site, 'shell.js'), 'window.siteShell = true')
  fs.writeFileSync(path.join(admin, 'index.html'), '<html>admin-shell</html>')
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31988', HOST: '127.0.0.1', SITE_DIST: site, ADMIN_DIST: admin }
  const initialized = spawnSync(process.execPath, ['scripts/db-init.js'], { env, encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(async () => {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  let started = false
  for await (const chunk of child.stdout) {
    if (chunk.toString().includes('设备台账已挂')) { started = true; break }
  }
  assert.ok(started, 'server starts')
  const base = 'http://127.0.0.1:31988'
  for (const route of ['/', '/demo', '/login', '/register', '/recover', '/app', '/app/devices/new', '/app/devices/test-id', '/app/account', '/about', '/privacy']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 200, route)
    assert.match(await response.text(), /user-site-shell/, route)
    assert.match(response.headers.get('cache-control'), /no-cache/)
  }
  for (const route of ['/admin', '/admin/users', '/admin/login']) {
    assert.match(await (await fetch(base + route)).text(), /admin-shell/, route)
  }
  assert.match(await (await fetch(base + '/shell.js')).text(), /window.siteShell/)
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404)
  assert.equal((await fetch(base + '/admin/assets/missing.js')).status, 404)
  const privateApi = await fetch(base + '/api/v1/devices')
  assert.equal(privateApi.status, 401)
  assert.equal((await privateApi.json()).error.code, 'AUTH_REQUIRED')
  const missingApi = await fetch(base + '/api/v1/missing')
  assert.equal(missingApi.status, 404)
  assert.doesNotMatch(await missingApi.text(), /user-site-shell/)
})

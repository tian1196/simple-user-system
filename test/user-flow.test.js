const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const dates = require('../server/dates')

test('real site API clients complete the isolated user journey', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-full-flow-'))
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), PORT: '31994', HOST: '127.0.0.1' }
  const run = script => spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(run('scripts/db-init.js').status, 0)
  const invite = run('scripts/create-invite.js')
  assert.equal(invite.status, 0, invite.stderr)
  const inviteCode = invite.stdout.match(/：([^\n]+)/)[1]
  const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let vite
  let restoreAdapter = () => {}
  t.after(async () => {
    restoreAdapter()
    if (vite) await vite.close()
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  for await (const chunk of child.stdout) { if (chunk.toString().includes('设备台账已挂')) break }

  // Execute the same TypeScript clients shipped to the browser, with an isolated Cookie jar.
  const { default: axios } = await import('../web/node_modules/axios/index.js')
  const originalAdapter = axios.defaults.adapter
  const httpAdapter = axios.getAdapter('http')
  let cookie = ''
  let holdProfile = false
  let releaseProfile
  let profileStarted
  const profileGate = new Promise(resolve => { releaseProfile = resolve })
  const profileSeen = new Promise(resolve => { profileStarted = resolve })
  axios.defaults.adapter = async config => {
    config.headers.set('Cookie', cookie)
    if (holdProfile && config.url === '/auth/me') { profileStarted(); await profileGate }
    const response = await httpAdapter(config)
    const setCookie = response.headers['set-cookie']?.find(value => value.startsWith('ledger_session='))
    if (setCookie) cookie = setCookie.split(';')[0]
    return response
  }
  restoreAdapter = () => { axios.defaults.adapter = originalAdapter }
  process.env.VITE_API_BASE_URL = 'http://127.0.0.1:31994/api/v1'
  const { createServer } = await import('../web/node_modules/vite/dist/node/index.js')
  vite = await createServer({ configFile: path.resolve('web/vite.site.config.ts'), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const auth = await vite.ssrLoadModule('/src/api/session.ts')
  const devices = await vite.ssrLoadModule('/src/api/devices.ts')
  const account = await vite.ssrLoadModule('/src/api/account.ts')
  const request = await vite.ssrLoadModule('/src/api/request.ts')
  const { pinia } = await vite.ssrLoadModule('/src/stores/index.ts')
  const { useSessionStore } = await vite.ssrLoadModule('/src/stores/session.ts')
  const session = useSessionStore(pinia)
  let expired = 0
  request.onSessionExpired(() => { expired++; session.reset() })
  const fails = (operation, status, code) => assert.rejects(operation, error => error.status === status && (!code || error.code === code))
  const register = username => auth.register({ username, password: 'flow-password-123', invite_code: inviteCode, policy_version: '2026-11-05' })

  await fails(auth.register({ username: 'flow_user', password: 'flow-password-123', invite_code: 'invalid', policy_version: '2026-11-05' }), 422, 'INVITE_INVALID')
  const registered = await register('flow_user')
  assert.ok(registered.recovery_code)
  session.setUser(registered.user)
  assert.equal(session.authenticated, true)
  assert.equal((await devices.listDevices()).total, 0)
  await session.logout()
  assert.equal(session.authenticated, false)
  await fails(auth.login({ username: 'flow_user', password: 'wrong' }), 401)
  assert.equal(expired, 0, 'bad login credentials must not run the session-expired handler')
  session.setUser((await auth.login({ username: 'FLOW_USER', password: 'flow-password-123' })).user)

  const today = dates.today()
  const input = { name: '流程测试设备', category: 'appliance', model: 'Model A', purchased_on: dates.addDays(today, -10), warranty_until: dates.addDays(today, 12), note: '测试备注 <script>字面文本</script>' }
  const device = await devices.createDevice(input)
  assert.equal((await devices.getDevice(device.id)).device.note, input.note)
  await fails(devices.createDevice({ ...input, purchased_on: dates.addDays(today, 1) }), 400)
  const plan = await devices.createPlan(device.id, { title: '滤芯维护', interval_days: 90, next_due_on: dates.addDays(today, -3) })
  const completion = { completed_on: today, note: '维护完成', version: plan.version, request_key: 'flow-completion' }
  const completed = await devices.completePlan(plan.id, completion)
  assert.equal(completed.plan.next_due_on, dates.addDays(today, 90))
  const replayed = await devices.completePlan(plan.id, completion)
  assert.equal(replayed.log.id, completed.log.id, 'retrying a completed request must not create a duplicate')
  await fails(devices.completePlan(plan.id, { ...completion, note: 'changed' }), 409, 'DUPLICATE_REQUEST')
  assert.equal((await devices.getDevice(device.id)).logs.length, 1)
  const manualInput = { title: '外壳清洁', completed_on: today, note: '手工记录', request_key: 'flow-manual' }
  await new Promise(resolve => setTimeout(resolve, 5))
  const manual = await devices.createManualLog(device.id, manualInput)
  assert.equal((await devices.getDevice(device.id)).logs[0].id, manual.id, 'newer records on the same date appear first')
  assert.equal((await devices.createManualLog(device.id, manualInput)).id, manual.id)
  await devices.voidLog(manual.id)
  const undone = await devices.voidLog(completed.log.id)
  assert.equal(undone.plan.next_due_on, plan.next_due_on)
  const paused = await devices.updatePlan(plan.id, { status: 'paused', version: undone.plan.version })
  assert.equal((await devices.getDueItems()).items.some(item => item.plan_id === plan.id), false)
  const resumed = await devices.updatePlan(plan.id, { status: 'active', next_due_on: dates.addDays(today, 8), version: paused.version })
  await fails(devices.updatePlan(plan.id, { title: 'stale', version: paused.version }), 409, 'VERSION_CONFLICT')
  const edited = await devices.updateDevice(device.id, { ...input, name: '更新设备', version: device.version })
  await fails(devices.updateDevice(device.id, { ...input, version: device.version }), 409)
  assert.equal((await devices.listDevices()).items[0].name, edited.name)
  const due = await devices.getDueItems()
  assert.equal(due.items.length, 2)
  const calendar = await devices.getCalendar()
  assert.match(calendar, /BEGIN:VCALENDAR/)
  assert.match(calendar, /更新设备 滤芯维护/)
  await fails(account.exportAccount(), 403, 'REAUTH_REQUIRED')
  await fails(account.reauthenticate('wrong'), 401)
  assert.equal(expired, 0, 'incorrect reauthentication must leave the session intact')
  await account.reauthenticate('flow-password-123')
  const json = await account.exportAccount()
  assert.equal(json.devices[0].plans.length, 1)
  assert.equal(json.devices[0].logs.length, 2)
  assert.doesNotMatch(JSON.stringify(json), /password_hash|recovery_code|token_hash|flow-password/)

  await fails(account.changePassword('wrong', 'changed-password-456'), 401)
  assert.equal(expired, 0)
  const changed = await account.changePassword('flow-password-123', 'changed-password-456')
  assert.ok(changed.recovery_code)
  await fails(auth.getProfile(), 401)
  await fails(auth.login({ username: 'flow_user', password: 'flow-password-123' }), 401)
  session.setUser((await auth.login({ username: 'flow_user', password: 'changed-password-456' })).user)
  const restored = await auth.recover({ username: 'flow_user', recovery_code: changed.recovery_code, new_password: 'recovered-password-789' })
  assert.notEqual(restored.recovery_code, changed.recovery_code)
  await fails(auth.getProfile(), 401)
  session.setUser((await auth.login({ username: 'flow_user', password: 'recovered-password-789' })).user)
  await session.logout()
  const other = await register('flow_other')
  session.setUser(other.user)
  await fails(devices.getDevice(device.id), 404)
  await fails(devices.updateDevice(device.id, { ...input, version: edited.version }), 404)
  await session.logout()
  session.setUser((await auth.login({ username: 'flow_user', password: 'recovered-password-789' })).user)
  await devices.deletePlan(plan.id, resumed.version)
  await devices.deleteDevice(device.id, edited.version)
  assert.equal((await devices.listDevices()).total, 0)
  await account.reauthenticate('recovered-password-789')
  await fails(account.deleteAccount('wrong-user'), 400)
  await account.deleteAccount('flow_user')
  await fails(auth.login({ username: 'flow_user', password: 'recovered-password-789' }), 401)

  // A stale guest probe must not erase a newer successful login in the store.
  const { createPinia } = await import('../web/node_modules/pinia/dist/pinia.mjs')
  const freshSession = useSessionStore(createPinia())
  holdProfile = true
  const oldProbe = freshSession.restore()
  await profileSeen
  freshSession.setUser(other.user)
  releaseProfile()
  await oldProbe
  assert.equal(freshSession.authenticated, true, 'a stale 401 response must not clear a newer login')
  assert.equal(freshSession.user.id, other.user.id)
})

// 解压实际交付包、安装锁定生产依赖、使用临时数据库启动并验收；不读取业务库。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { checkRelease } = require('./check-release')
async function main() {
  const archive = path.resolve(process.argv[2] || 'dist/device-ledger.tar.gz')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-release-check-'))
  let child
  function run(command, args, env = process.env) {
    const result = spawnSync(command, args, { cwd: dir, env, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  }
  try {
    run('tar', ['-xzf', archive, '-C', dir])
    for (const forbidden of ['.env', 'data', 'node_modules', 'web/.env', 'web/.env.production']) {
      if (fs.existsSync(path.join(dir, forbidden))) throw new Error(`部署包不应包含 ${forbidden}`)
    }
    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'])
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1')
    await once(probe, 'listening')
    const port = probe.address().port
    await new Promise(resolve => probe.close(resolve))
    const env = { ...process.env, DATABASE_PATH: path.join(dir, 'test.sqlite'), HOST: '127.0.0.1', PORT: String(port), COOKIE_SECURE: 'false', ADMIN_DIST: path.join(dir, 'web/dist'), SITE_DIST: path.join(dir, 'web/site-dist') }
    run(process.execPath, ['scripts/db-init.js'], env)
    child = spawn(process.execPath, ['server/index.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const origin = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(output)
      try { if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* wait for listen */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error(`启动超时：${output}`)
    await checkRelease(origin)
    console.log('实际部署包隔离启动验收通过，未使用现有端口或业务数据库')
  } finally {
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

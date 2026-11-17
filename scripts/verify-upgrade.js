// 仅在一次性副本上演练升级与路由验收，核对既有业务行不变。
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { DatabaseSync } = require('node:sqlite')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { checkRelease } = require('./check-release')
const filename = path.resolve(process.argv[2] || '')
if (path.basename(filename) !== 'upgrade.sqlite' || filename === path.resolve(process.env.DATABASE_PATH || 'data/ledger.sqlite')) throw new Error('仅接受名为upgrade.sqlite的一次性副本，禁止指定业务库')
function fingerprint() {
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).filter(n => !['sessions', 'schema_migrations', 'sqlite_sequence'].includes(n))
    return Object.fromEntries(names.map(name => {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row => JSON.stringify(row)).sort()
      return [name, { count: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
    }))
  } finally { db.close() }
}
async function main() {
  const before = fingerprint()
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_PATH: filename, HOST: '127.0.0.1', PORT: String(port), COOKIE_SECURE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', x => { output += x }); child.stderr.on('data', x => { output += x })
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(output)
      try { if ((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok) { ready = true; break } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('副本升级启动超时')
    await checkRelease(`http://127.0.0.1:${port}`)
    const after = fingerprint()
    for (const [name, original] of Object.entries(before)) {
      if (JSON.stringify(after[name]) !== JSON.stringify(original)) throw new Error(`既有表内容发生变化：${name}`)
    }
    console.log(`升级演练通过：${Object.keys(before).length}张既有业务表逐行摘要一致；仅排除过期会话与迁移元数据`)
  } finally {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

// 检查真实构建产物的页面回退、资源与接口隔离。可用于本地验收和远端部署。
const assert = require('node:assert/strict')
async function checkRelease(base) {
  const origin = new URL(base)
  const assets = new Set()
  for (const route of ['/', '/demo', '/login', '/register', '/recover', '/app', '/app/devices/new', '/app/devices/release-check', '/app/account', '/about', '/privacy', '/admin/', '/admin/login', '/admin/users']) {
    const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200, route)
    const html = await response.text()
    assert.match(html, /<div id="app"><\/div>/, route)
    const links = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(match => match[1])
    assert.ok(links.some(link => link.startsWith(route.startsWith('/admin') ? '/admin/assets/' : '/assets/')), `正确站点入口：${route}`)
    for (const link of links) assets.add(link)
    assert.match(response.headers.get('cache-control') || '', /no-cache/, `入口不长期缓存：${route}`)
  }
  for (const asset of assets) {
    const response = await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200, asset)
    assert.doesNotMatch(response.headers.get('content-type'), /text\/html/, asset)
    const contents = await response.text()
    assert.ok(contents.length > 0, asset)
    assert.doesNotMatch(contents, /http:\/\/(?:localhost|127\.0\.0\.1):(?:3000|5173|5174)/, asset)
  }
  for (const route of ['/assets/missing.js', '/admin/assets/missing.js', '/api/v1/missing']) {
    assert.equal((await fetch(new URL(route, origin))).status, 404, route)
  }
  assert.equal((await fetch(new URL('/api/v1/devices', origin))).status, 401)
  const ready = await fetch(new URL('/api/v1/health/ready', origin))
  assert.equal(ready.status, 200)
  assert.equal((await ready.json()).ok, true)
  console.log(`部署验收通过：14 条页面路由、${assets.size} 个入口资源、接口隔离与数据库就绪`)
}
if (require.main === module) checkRelease(process.argv[2] || 'http://127.0.0.1:3000').catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { checkRelease }

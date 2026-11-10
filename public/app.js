const POLICY_VERSION = '2026-11-05'
const CATEGORIES = [
  ['appliance', '家电'],
  ['computer', '电脑'],
  ['camera', '相机'],
  ['digital', '数码'],
  ['other', '其他'],
]

const state = { me: null, admin: null, device: null }
let renderSeq = 0
let toastTimer

const $ = (selector) => document.querySelector(selector)
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))

class Redirect extends Error {}

function requestKey() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/calendar')) {
    if (!response.ok) throw new Error('日历导出失败')
    return response.text()
  }
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 && options.allow401) return null
  if (!response.ok) {
    const error = new Error(payload.error?.message || '请求失败')
    error.status = response.status
    throw error
  }
  return payload.data
}

function notify(message) {
  $('#notice').innerHTML = `<div class="toast">${esc(message)}</div>`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('#notice').innerHTML = '' }, 3200)
}

function box(html) {
  $('#dialog').innerHTML = `<div class="overlay"><section class="modal" role="dialog" aria-modal="true">${html}</section></div>`
  $('#dialog input, #dialog button, #dialog select, #dialog textarea')?.focus()
}

function closeDialog() {
  $('#dialog').innerHTML = ''
}

function failForm(message) {
  const slot = $('#form-error')
  if (slot) slot.textContent = message
  else notify(message)
}

function navigate(path, { replace = false } = {}) {
  if (location.pathname !== path) {
    if (replace) history.replaceState({}, '', path)
    else history.pushState({}, '', path)
  }
  return render()
}

function header(path) {
  const adminArea = path.startsWith('/admin') && path !== '/admin/login'
  if (adminArea) {
    const role = state.admin?.role === 'owner' ? '所有者' : '运营者'
    return `<header class="header"><a class="brand" href="/admin"><i></i>设备台账 / 管理后台</a><nav class="nav"><span class="tag">${role}</span><a href="/admin/login" data-logout="admin">退出</a></nav></header>`
  }
  const account = state.me ? `<a href="/app/account">${esc(state.me.username)}</a>` : '<a href="/login">登录</a>'
  return `<header class="header"><a class="brand" href="/"><i></i>设备台账</a><nav class="nav"><a href="/demo">体验示例</a><a class="desktop" href="/about">关于</a><a href="/app">我的设备</a>${account}</nav></header>`
}

function footer() {
  return `<footer class="footer"><span><a href="/about">关于</a><a href="/privacy">隐私说明</a>本地 SQLite · 非正式上线</span><span>备案及运营者信息：正式上线前补齐</span></footer>`
}

function field(label, name, type = 'text', extra = '') {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${extra}></div>`
}

function categoryOptions(selected = 'other') {
  return CATEGORIES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')
}

function shellError(message) {
  return `<div class="wrap"><div class="empty"><h2>暂时无法加载</h2><p class="muted">${esc(message)}</p><button class="primary" data-action="retry">重试</button></div></div>`
}

function homeView() {
  return `<div class="wrap"><section class="hero"><div><div class="eyebrow">个人设备保修与维护台账</div><h1>设备买回来以后，<br>也值得有一份记录。</h1><p>把保修日期、维护计划和处理记录放在一起。需要时找得到，到期时看得清。</p><div class="row"><a href="/demo"><button class="primary">体验示例</button></a><a href="/register"><button>已有邀请，开始使用</button></a></div><p style="font-size:12px;margin-top:18px">邀请试用 · 无需手机号 · 不上传发票或照片</p></div><div class="mock"><div class="top"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div><div class="row between"><h3>我的设备 / 近期事项</h3><span class="tag">示例</span></div><div class="list-item"><div>空气净化器<p class="muted">滤芯更换 · 2026-11-02</p></div><span class="tag alert">逾期 3 天</span></div><div class="list-item"><div>微单相机<p class="muted">保修截止 · 2026-11-17</p></div><span class="tag">还有 12 天</span></div><div class="list-item"><div>工作笔记本<p class="muted">清洁检查 · 2026-11-13</p></div><span class="tag">还有 8 天</span></div></div></section><div class="grid">${[
    ['01', '记录设备', '仅名称必填。购买日、型号和保修日知道多少填多少。'],
    ['02', '安排维护', '按天设置周期，完成后保留下次日期和历史。'],
    ['03', '带到日历', '手动导出未来事项，在自己的日历中设置提醒。'],
  ].map((item) => `<div class="card"><div class="number">${item[0]}</div><h2>${item[1]}</h2><p class="muted">${item[2]}</p></div>`).join('')}</div><div class="section row between"><p class="muted">第一版专注私人记录，不提供维修建议或保修承诺。</p><a href="/about">了解项目边界 →</a></div></div>`
}

function demoView() {
  const cards = [
    ['空气净化器', '家电', '演示型号 A', '保修剩余 208 天', '1 项维护计划'],
    ['微单相机', '相机', '演示型号 B', '保修剩余 12 天', '暂无维护计划'],
    ['工作笔记本', '电脑', '未填写型号', '保修已到期', '1 项维护计划'],
  ]
  return `<div class="wrap"><div class="banner">静态示例 · 这些设备不会写入数据库。</div><div class="eyebrow">PRIVATE DEVICE LEDGER</div><h1>示例台账</h1><p class="muted">合成数据，仅供看清记录方式。</p><section class="card section"><h2>近期事项</h2><div class="list-item"><div><strong>空气净化器 · 滤芯更换</strong><p class="muted">2026-11-02</p></div><span class="tag alert">逾期 3 天</span></div><div class="list-item"><div><strong>工作笔记本 · 清洁检查</strong><p class="muted">2026-11-13</p></div><span class="tag">还有 8 天</span></div><div class="list-item"><div><strong>微单相机 · 保修截止</strong><p class="muted">2026-11-17</p></div><span class="tag">还有 12 天</span></div></section><div class="grid">${cards.map((card) => `<article class="card"><div class="device-icon">□</div><div class="row between"><h2>${card[0]}</h2><span class="tag">${card[1]}</span></div><p class="muted">${card[2]}</p><p>${card[3]}</p><p class="muted">${card[4]}</p></article>`).join('')}</div></div>`
}

async function authView(kind) {
  const titles = { login: '登录你的台账', register: '通过邀请开始使用', recover: '使用恢复码重置密码', admin: '管理员登录' }
  const invite = kind === 'register' ? field('邀请码', 'invite_code', 'text', 'required') : ''
  const recovery = kind === 'recover' ? field('一次性恢复码', 'recovery_code', 'text', 'required') : ''
  const passwordLabel = kind === 'recover' ? '新密码' : '密码'
  const passwordName = kind === 'recover' ? 'new_password' : 'password'
  let captcha = ''
  if (kind === 'admin') {
    const challenge = await api('/admin/auth/captcha')
    state.captchaId = challenge.captcha_id
    captcha = `<div class="field"><label for="f-captcha_text">图形验证码</label><div class="row" style="gap:10px;align-items:center"><input id="f-captcha_text" name="captcha_text" required maxlength="6" autocomplete="off" placeholder="不区分大小写" style="flex:1"><img src="${esc(challenge.image)}" alt="验证码" width="132" height="44" style="border-radius:8px;background:#f4f7fb;cursor:pointer" data-action="refresh-captcha"></div><p class="muted">看不清可点击图片刷新。</p></div>`
  }
  const policy = kind === 'register' ? `<label class="check"><input name="policy" type="checkbox" required><span>已阅读<a href="/privacy">隐私说明</a>，了解数据保存在本机数据库。</span></label>` : ''
  const submit = { login: '登录', register: '创建账户', recover: '重置密码', admin: '进入管理后台' }[kind]
  const links = kind === 'login'
    ? `<div class="row between"><a href="/register">有邀请码？注册</a><a href="/recover">忘记密码</a></div>`
    : '<a href="/login">返回用户登录</a>'
  return `<div class="wrap"><div class="auth"><div class="eyebrow">${kind === 'admin' ? '运营入口' : '个人设备台账'}</div><h1>${titles[kind]}</h1><div class="card"><form data-form="${kind}">${invite}${field('用户名', 'username', 'text', 'required autocomplete="username"')}${recovery}${field(passwordLabel, passwordName, 'password', 'required minlength="8" autocomplete="current-password"')}${captcha}${policy}<div class="error" id="form-error"></div><button class="primary wide" type="submit">${submit}</button></form><div class="rule"></div>${links}</div></div></div>`
}

function proseView(privacy) {
  const body = privacy
    ? `<div class="banner">正式上线前需补齐真实运营者、联系渠道和备案信息。</div><h2>收集什么</h2><p>登录需要用户名、密码哈希和恢复码哈希。台账只保存你主动填写的设备名称、分类、型号、日期、备注和维护记录。不收集手机号、邮箱、身份证、位置或照片。</p><h2>存在哪里</h2><p>当前版本写在运行这套服务的机器上的 SQLite 文件里。会话放在同一数据库。导出的 JSON 不含密码和恢复码。</p><h2>你的选择</h2><p>可以修改或删除自己的设备，导出完整数据，或注销账户。密码和恢复码同时丢失时无法找回。</p>`
    : `<p>这个项目帮助个人整理设备保修与维护信息。第一版把记录、待办和历史连起来，不提供维修撮合、厂家承诺或自动保修判断。</p><h2>第一版的范围</h2><p>邀请制试用。设备名称即可开始。按天维护、站内待办、手动日历导出。没有支付、附件、公开分享或自动站外通知。</p><h2>项目状态</h2><p>目前是本地可运行的第一版界面，需求尚未经过真实用户验证。</p>`
  return `<div class="wrap prose"><div class="eyebrow">${privacy ? 'PRIVACY' : 'ABOUT'}</div><h1>${privacy ? '隐私说明' : '把设备的后续事项记清楚'}</h1>${body}<div class="section"><a href="/"><button>返回首页</button></a></div></div>`
}

async function dashboardView() {
  const [due, devices] = await Promise.all([api('/due-items?days=30'), api('/devices')])
  const items = due.items.length
    ? due.items.map((item) => `<div class="list-item"><div><strong>${esc(item.device_name)} · ${esc(item.title)}</strong><p class="muted">${esc(item.due_on)}</p></div><div class="row"><span class="tag ${item.status === 'overdue' ? 'alert' : ''}">${esc(item.label)}</span><a href="/app/devices/${item.device_id}"><button class="small">查看</button></a></div></div>`).join('')
    : '<p class="muted">近期没有待处理事项。</p>'
  const cards = devices.items.length
    ? `<div class="grid">${devices.items.map((device) => `<article class="card"><div class="device-icon">□</div><div class="row between"><h2>${esc(device.name)}</h2><span class="tag">${esc(device.category_label)}</span></div><p class="muted">${esc(device.model || '未填写型号')}</p><p>${esc(device.warranty_label)}</p><p class="muted">${device.plan_count ? `${device.plan_count} 项维护计划` : '暂无维护计划'}</p><a href="/app/devices/${device.id}"><button class="wide">查看设备 →</button></a></article>`).join('')}</div>`
    : `<div class="empty"><h2>还没有设备</h2><p>名称即可开始，其他信息以后再补。</p><a href="/app/devices/new"><button class="primary">新增第一台设备</button></a></div>`
  return `<div class="wrap"><div class="row between"><div><div class="eyebrow">PRIVATE DEVICE LEDGER</div><h1>我的设备</h1><p class="muted">${esc(due.today)} · 私人记录，仅本人可见</p></div><div class="row"><button data-action="calendar">导出日历</button><a href="/app/devices/new"><button class="primary">+ 新增设备</button></a></div></div><section class="card section"><div class="row between"><h2>近期事项</h2><span class="tag">逾期与未来 30 天</span></div>${items}</section><div class="row between section"><h2>设备台账 <small>${devices.total} 台</small></h2></div>${cards}</div>`
}

async function deviceView(id) {
  const data = await api(`/devices/${id}`)
  state.device = data
  const { device, plans, logs } = data
  const planHtml = plans.length
    ? plans.map((plan) => `<div class="section"><div class="row between"><h3>${esc(plan.title)}</h3><span class="tag ${plan.due_status === 'overdue' ? 'alert' : ''}">${esc(plan.due_label)}</span></div><p class="muted">每 ${plan.interval_days} 天 · 下次 ${esc(plan.next_due_on)}</p><div class="row"><button class="primary small" data-action="complete" data-id="${plan.id}">完成维护</button><button class="small" data-action="edit-plan" data-id="${plan.id}">编辑</button><button class="small" data-action="pause" data-id="${plan.id}">${plan.status === 'paused' ? '恢复' : '暂停'}</button><button class="small" data-action="delete-plan" data-id="${plan.id}">删除</button></div></div>`).join('')
    : '<div class="empty"><p>还没有维护计划</p><small>按实际需要添加，不必为每件设备设置。</small></div>'
  const logHtml = logs.length
    ? logs.map((log) => `<div class="list-item"><div><strong>${esc(log.title)} ${log.voided_at ? '<span class="tag">已撤销</span>' : ''}</strong><p class="muted">${esc(log.completed_on)} · ${esc(log.note || '无备注')}</p></div>${log.can_void ? `<button class="small" data-action="void" data-id="${log.id}">撤销</button>` : ''}</div>`).join('')
    : '<p class="muted">还没有维护记录。</p>'
  return `<div class="wrap"><div class="row between"><div><p><a href="/app">← 返回台账</a></p><h1>${esc(device.name)}</h1><span class="muted">${esc(device.category_label)} / 私人设备</span></div><button data-action="edit-device">编辑设备</button></div><div class="detail-grid section"><div class="stack"><section class="card"><div class="row between"><h2>维护计划</h2><button class="small" data-action="add-plan">+ 添加计划</button></div>${planHtml}</section><section class="card"><div class="row between"><h2>维护历史</h2><button class="small" data-action="manual-log">+ 手工记录</button></div>${logHtml}</section></div><aside class="stack"><section class="card"><h2>设备信息</h2><div class="kv"><span>型号</span><span>${esc(device.model || '未填写')}</span><span>购买日期</span><span>${esc(device.purchased_on || '未知')}</span><span>保修截止</span><span>${esc(device.warranty_until || '未知')}</span></div><span class="tag">${esc(device.warranty_label)}</span><div class="rule"></div><p class="muted">${esc(device.note || '暂无备注')}</p><small>保修信息由你记录，以厂家实际规则为准。</small></section><section class="card"><h3>删除设备</h3><p class="muted">同时删除计划和历史，无回收站。</p><button class="danger" data-action="delete-device">删除设备</button></section></aside></div></div>`
}

function deviceForm(device) {
  const value = device || {}
  return `<form data-form="${device ? 'editDevice' : 'newDevice'}"><h2>${device ? '编辑设备' : '新增设备'}</h2><p class="muted">名称必填，未知日期可以留空。</p>${field('设备名称 *', 'name', 'text', `required maxlength="80" value="${esc(value.name || '')}"`)}<div class="field"><label for="f-category">分类</label><select id="f-category" name="category">${categoryOptions(value.category || 'other')}</select></div>${field('型号', 'model', 'text', `maxlength="80" value="${esc(value.model || '')}"`)}<div class="grid two">${field('购买日期', 'purchased_on', 'date', `value="${esc(value.purchased_on || '')}"`)}${field('保修截止日', 'warranty_until', 'date', `value="${esc(value.warranty_until || '')}"`)}</div><div class="field"><label for="f-note">备注（不填序列号或其他敏感信息）</label><textarea id="f-note" name="note" maxlength="500">${esc(value.note || '')}</textarea></div><div class="error" id="form-error"></div><div class="actions">${device ? '<button type="button" data-action="close">取消</button>' : '<a href="/app"><button type="button">取消</button></a>'}<button class="primary" type="submit">保存设备</button></div></form>`
}

function newDeviceView() {
  return `<div class="wrap prose"><div class="card">${deviceForm()}</div></div>`
}

function accountView() {
  return `<div class="wrap prose"><div class="eyebrow">ACCOUNT</div><h1>账户与数据</h1><p class="muted">用户名 ${esc(state.me.username)} · 不绑定手机号或邮箱</p><div class="stack section"><section class="card"><h2>账号安全</h2><p>修改密码后需要重新登录，并会得到一组新的恢复码。</p><button data-action="password">修改密码</button></section><section class="card"><h2>带走你的数据</h2><p class="muted">完整 JSON 包含设备、计划和记录，不包含登录凭证。导出前要再输入一次密码。</p><div class="row"><button data-action="export">导出完整数据 JSON</button><button data-action="calendar">导出未来事项 ICS</button></div></section><section class="card"><h2>注销账户</h2><p class="muted">删除当前账户和台账，无回收站。</p><button class="danger" data-action="delete-account">注销账户</button></section><button data-action="logout">退出登录</button></div></div>`
}

function adminShell(path, content) {
  const items = [
    ['/admin', '概览'],
    ['/admin/users', '账号管理'],
    ['/admin/invites', '邀请管理'],
  ]
  if (state.admin?.role === 'owner') {
    items.push(['/admin/settings', '运营配置'], ['/admin/audit', '操作审计'])
  }
  const nav = items.map(([href, label]) => `<a class="${path === href ? 'active' : ''}" href="${href}">${label}</a>`).join('')
  return `<div class="layout"><aside class="sidebar">${nav}</aside><main class="admin-main">${content}</main></div>`
}

async function adminHome() {
  const data = await api('/admin/overview')
  return adminShell('/admin', `<div class="eyebrow">OPERATIONS</div><h1>运营概览</h1><p class="muted">只查看聚合数字，不展示私人台账内容。</p><div class="grid section"><div class="card"><p class="muted">普通用户</p><div class="metric">${data.users} 人</div></div><div class="card"><p class="muted">设备总数</p><div class="metric">${data.devices} 台</div></div><div class="card"><p class="muted">近 7 日新增</p><div class="metric">${data.new_users_7d} 人</div></div></div><div class="grid two"><section class="card"><h2>运行摘要</h2><div class="list-item"><span>最近备份</span><span>${data.backup_at || '尚未接入'}</span></div><div class="list-item"><span>注册入口</span><span class="tag">${data.registration_enabled ? '已开启' : '已关闭'}</span></div><div class="list-item"><span>业务写入</span><span class="tag">${data.writes_enabled ? '已开启' : '已关闭'}</span></div></section><section class="card"><h2>常用操作</h2><p>邀请新用户，或处理普通账户状态。</p><div class="row"><a href="/admin/invites"><button>管理邀请</button></a><a href="/admin/users"><button>账号管理</button></a></div></section></div>`)
}

function userRows(items) {
  if (!items.length) return '<tr><td colspan="5">没有匹配账户。</td></tr>'
  return items.map((user) => `<tr><td>${esc(user.id.slice(0, 8))}</td><td>${esc(user.username)}</td><td><span class="tag">${user.status === 'active' ? '正常' : '停用'}</span></td><td>${new Date(user.created_at).toLocaleDateString('zh-CN')}</td><td><a href="/admin/users/${user.id}">详情</a></td></tr>`).join('')
}

async function adminUsers(query) {
  const data = await api(`/admin/users${query}`)
  return adminShell('/admin/users', `<h1>账号管理</h1><p class="muted">只显示账号元数据，不打开私人设备名称或记录。</p><div class="card section"><form class="table-tools" data-form="filterUsers"><input name="q" placeholder="搜索用户名" aria-label="用户名" value="${esc(new URLSearchParams(query).get('q') || '')}"><select name="status" aria-label="账号状态"><option value="all">全部状态</option><option value="active">正常</option><option value="disabled">停用</option></select><button type="submit">查询</button></form><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户名</th><th>状态</th><th>注册日期</th><th></th></tr></thead><tbody>${userRows(data.items)}</tbody></table></div></div>`)
}

async function adminUser(id) {
  const user = await api(`/admin/users/${id}`)
  state.adminUser = user
  return adminShell('/admin/users', `<p><a href="/admin/users">← 用户列表</a></p><h1>账户 ${esc(user.username)}</h1><div class="grid two section"><div class="card"><h2>账户元数据</h2><div class="kv"><span>状态</span><span>${user.status === 'active' ? '正常' : '停用'}</span><span>注册时间</span><span>${new Date(user.created_at).toLocaleString('zh-CN')}</span><span>设备数量</span><span>${user.device_count} 台</span></div><p class="call">后台不提供私人台账查看入口。这里只有数量。</p></div><div class="card"><h2>账户状态</h2><p class="muted">停用会立即撤销该用户的全部会话。</p><button class="${user.status === 'active' ? 'danger' : 'primary'}" data-action="toggle-user">${user.status === 'active' ? '停用普通账户' : '恢复普通账户'}</button></div></div>`)
}

async function adminInvites() {
  const data = await api('/admin/invites')
  const rows = data.items.length
    ? data.items.map((invite) => `<tr><td>${esc(invite.id.slice(0, 8))}</td><td>${invite.used_count} / ${invite.max_uses}</td><td>${new Date(invite.expires_at).toLocaleDateString('zh-CN')}</td><td>${invite.revoked_at ? '已撤销' : '可使用'}</td><td>${invite.revoked_at ? '—' : `<button class="small" data-action="revoke" data-id="${invite.id}">撤销</button>`}</td></tr>`).join('')
    : '<tr><td colspan="5">还没有邀请。</td></tr>'
  return adminShell('/admin/invites', `<div class="row between"><h1>邀请管理</h1><button class="primary" data-action="create-invite">+ 创建邀请</button></div><p class="muted">明文邀请码只在创建成功时显示一次。</p><div class="card section table-wrap"><table><thead><tr><th>编号</th><th>已用 / 上限</th><th>有效期</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`)
}

async function adminSettings() {
  if (state.admin?.role !== 'owner') return adminShell('/admin/settings', '<div class="empty"><h1>无权限访问</h1><p>运营者不能修改配置。</p></div>')
  const data = await api('/admin/settings')
  state.settings = Object.fromEntries(data.items.map((item) => [item.key, item]))
  const row = (key, title, text) => {
    const item = state.settings[key]
    return `<div class="list-item"><div><h3>${title}</h3><p class="muted">${text}</p></div><button data-action="setting" data-id="${key}">${item.value ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}</button></div>`
  }
  return adminShell('/admin/settings', `<h1>运营配置</h1><p class="muted">只有所有者可以修改。</p><div class="card section">${row('registration_enabled', '允许邀请注册', '关闭后不影响已有账户登录。')}${row('writes_enabled', '允许业务写入', '关闭后仍允许登录、导出、注销和安全操作。')}</div>`)
}

async function adminAudit() {
  if (state.admin?.role !== 'owner') return adminShell('/admin/audit', '<div class="empty"><h1>无权限访问</h1><p>运营者不能查看审计。</p></div>')
  const data = await api('/admin/audit-logs')
  const rows = data.items.length
    ? data.items.map((item) => `<tr><td>${new Date(item.created_at).toLocaleString('zh-CN')}</td><td>${esc(item.actor || '—')}</td><td>${esc(item.action)}</td><td>${esc(item.target_id || '—')}</td><td>${item.result === 'success' ? '成功' : '失败'}</td></tr>`).join('')
    : '<tr><td colspan="5">暂无审计记录。</td></tr>'
  return adminShell('/admin/audit', `<h1>关键操作审计</h1><p class="muted">不记录密码、恢复码和设备备注。</p><div class="card section table-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table></div>`)
}

async function resolve(path) {
  if (path === '/') return homeView()
  if (path === '/demo') return demoView()
  if (path === '/login') return authView('login')
  if (path === '/register') return authView('register')
  if (path === '/recover') return authView('recover')
  if (path === '/about') return proseView(false)
  if (path === '/privacy') return proseView(true)
  if (path === '/admin/login') return authView('admin')

  if (path.startsWith('/admin')) {
    state.admin = await api('/admin/auth/me', { allow401: true })
    if (!state.admin) return { redirect: '/admin/login' }
    if (path === '/admin') return adminHome()
    if (path === '/admin/users') return adminUsers(location.search)
    const userMatch = path.match(/^\/admin\/users\/([^/]+)$/)
    if (userMatch) return adminUser(userMatch[1])
    if (path === '/admin/invites') return adminInvites()
    if (path === '/admin/settings') return adminSettings()
    if (path === '/admin/audit') return adminAudit()
  }

  if (path.startsWith('/app')) {
    state.me = await api('/auth/me', { allow401: true })
    if (!state.me) return { redirect: '/login' }
    if (state.me.role !== 'user') return { redirect: '/admin' }
    if (path === '/app') return dashboardView()
    if (path === '/app/devices/new') return newDeviceView()
    if (path === '/app/account') return accountView()
    const deviceMatch = path.match(/^\/app\/devices\/([^/]+)$/)
    if (deviceMatch) return deviceView(deviceMatch[1])
  }
  return `<div class="wrap empty"><h1>页面不存在</h1><a href="/">返回首页</a></div>`
}

async function render() {
  const seq = ++renderSeq
  let path = location.pathname
  try {
    for (let hop = 0; hop < 3; hop += 1) {
      const result = await resolve(path)
      if (seq !== renderSeq) return
      if (result && result.redirect) {
        path = result.redirect
        history.replaceState({}, '', path)
        continue
      }
      const content = typeof result === 'string' ? result : ''
      $('#app').innerHTML = header(path) + content + footer()
      document.title = '设备台账'
      return
    }
  } catch (error) {
    if (seq !== renderSeq || error instanceof Redirect) return
    $('#app').innerHTML = header(path) + shellError(error.message) + footer()
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries())
}

function planForm(plan) {
  const value = plan || {}
  box(`<form data-form="plan" data-id="${value.id || ''}"><h2>${value.id ? '编辑' : '添加'}维护计划</h2>${field('维护事项 *', 'title', 'text', `required maxlength="80" value="${esc(value.title || '')}"`)}<div class="grid two">${field('周期天数 *', 'interval_days', 'number', `required min="1" max="3650" value="${value.interval_days || 180}"`)}${field('下次到期日 *', 'next_due_on', 'date', `required value="${esc(value.next_due_on || '')}"`)}</div><p class="muted">按自然日计算。修改周期时请同时确认新的到期日。</p><div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">保存</button></div></form>`)
}

function currentPlan(id) {
  return state.device?.plans?.find((plan) => plan.id === id)
}

async function downloadCalendar() {
  const text = await api('/exports/calendar?days=30')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }))
  link.download = 'device-ledger.ics'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  notify('已导出未来事项')
}

document.addEventListener('click', async (event) => {
  const link = event.target.closest('a[href]')
  if (link && link.origin === location.origin && !link.hasAttribute('download')) {
    event.preventDefault()
    if (link.dataset.logout === 'admin') {
      try { await api('/admin/auth/logout', { method: 'POST', body: {} }) } catch { /* 会话已失效 */ }
      state.admin = null
      closeDialog()
      return navigate('/admin/login')
    }
    closeDialog()
    return navigate(link.pathname + link.search)
  }
  const button = event.target.closest('[data-action]')
  if (!button) return
  const action = button.dataset.action
  const id = button.dataset.id
  try {
    if (action === 'close') return closeDialog()
    if (action === 'retry') return render()
    if (action === 'refresh-captcha') {
      const challenge = await api('/admin/auth/captcha')
      state.captchaId = challenge.captcha_id
      button.setAttribute('src', challenge.image)
      const input = document.querySelector('#f-captcha_text')
      if (input) input.value = ''
      return
    }
    if (action === 'calendar') return downloadCalendar()
    if (action === 'edit-device') return box(deviceForm(state.device.device))
    if (action === 'add-plan') return planForm()
    if (action === 'edit-plan') return planForm(currentPlan(id))
    if (action === 'complete') {
      const plan = currentPlan(id)
      return box(`<form data-form="complete" data-id="${id}"><h2>完成维护</h2><p><strong>${esc(plan.title)}</strong> · 每 ${plan.interval_days} 天</p>${field('实际完成日期 *', 'completed_on', 'date', 'required')}${field('备注', 'note')}<p class="muted">下次到期按完成日加周期计算，不补造中间记录。</p><div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">确认登记</button></div></form>`)
    }
    if (action === 'manual-log') {
      return box(`<form data-form="manual"><h2>手工登记</h2>${field('维护事项 *', 'title', 'text', 'required maxlength="80"')}${field('实际完成日期 *', 'completed_on', 'date', 'required')}<div class="field"><label for="f-note">备注</label><textarea id="f-note" name="note" maxlength="500"></textarea></div><div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">确认登记</button></div></form>`)
    }
    if (action === 'pause') {
      const plan = currentPlan(id)
      if (plan.status === 'active') {
        await api(`/plans/${id}`, { method: 'PATCH', body: { ...plan, status: 'paused', version: plan.version } })
        notify('计划已暂停')
        return render()
      }
      return box(`<form data-form="resume" data-id="${id}"><h2>恢复维护计划</h2>${field('确认下次到期日', 'next_due_on', 'date', `required value="${esc(plan.next_due_on)}"`)}<div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">恢复</button></div></form>`)
    }
    if (action === 'delete-plan') {
      return box(`<h2>删除维护计划？</h2><p>历史记录会留下，但不再改这个计划的日期。</p><div class="actions"><button data-action="close">取消</button><button class="danger" data-action="confirm-delete-plan" data-id="${id}">确认删除</button></div>`)
    }
    if (action === 'confirm-delete-plan') {
      const plan = currentPlan(id)
      await api(`/plans/${id}`, { method: 'DELETE', body: { version: plan.version } })
      closeDialog()
      notify('计划已删除')
      return render()
    }
    if (action === 'void') {
      return box(`<h2>撤销这条维护记录？</h2><p>记录会保留撤销标记。如果它来自维护计划，下次日期会退回登记前。</p><div class="actions"><button data-action="close">取消</button><button class="danger" data-action="confirm-void" data-id="${id}">确认撤销</button></div>`)
    }
    if (action === 'confirm-void') {
      await api(`/logs/${id}/void`, { method: 'POST', body: {} })
      closeDialog()
      notify('已撤销')
      return render()
    }
    if (action === 'delete-device') {
      return box(`<h2>删除设备及关联数据？</h2><p>计划和维护历史也会删除，没有回收站。</p><div class="actions"><button data-action="close">取消</button><button class="danger" data-action="confirm-delete-device">确认删除</button></div>`)
    }
    if (action === 'confirm-delete-device') {
      await api(`/devices/${state.device.device.id}`, { method: 'DELETE', body: { version: state.device.device.version } })
      closeDialog()
      notify('设备已删除')
      return navigate('/app')
    }
    if (action === 'export') {
      return box(`<form data-form="export"><h2>验证后导出</h2>${field('当前密码', 'password', 'password', 'required')}<div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">导出 JSON</button></div></form>`)
    }
    if (action === 'password') {
      return box(`<form data-form="password"><h2>修改密码</h2>${field('原密码', 'current_password', 'password', 'required')}${field('新密码', 'new_password', 'password', 'required minlength="8"')}<div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">确认修改</button></div></form>`)
    }
    if (action === 'delete-account') {
      return box(`<form data-form="deleteAccount"><h2>注销账户</h2><p>先验证密码，再输入用户名 ${esc(state.me.username)} 确认。</p>${field('当前密码', 'password', 'password', 'required')}${field('输入用户名确认', 'confirm_username', 'text', 'required')}<div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="danger" type="submit">确认注销</button></div></form>`)
    }
    if (action === 'logout') {
      await api('/auth/logout', { method: 'POST', body: {} })
      state.me = null
      return navigate('/')
    }
    if (action === 'create-invite') {
      const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return box(`<form data-form="invite"><h2>创建邀请</h2>${field('可使用次数', 'max_uses', 'number', 'required min="1" max="20" value="5"')}${field('有效期', 'expires_on', 'date', `required value="${date}"`)}<div class="error" id="form-error"></div><div class="actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">创建</button></div></form>`)
    }
    if (action === 'revoke') {
      await api(`/admin/invites/${id}/revoke`, { method: 'POST', body: {} })
      notify('邀请已撤销')
      return render()
    }
    if (action === 'toggle-user') {
      const user = state.adminUser
      const status = user.status === 'active' ? 'disabled' : 'active'
      state.adminUser = await api(`/admin/users/${user.id}/status`, { method: 'PATCH', body: { status, version: user.version } })
      notify(status === 'active' ? '账户已恢复' : '账户已停用')
      return render()
    }
    if (action === 'setting') {
      const item = state.settings[id]
      await api(`/admin/settings/${id}`, { method: 'PATCH', body: { value: !item.value, version: item.version } })
      notify('配置已更新')
      return render()
    }
  } catch (error) {
    failForm(error.message)
  }
})

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form]')
  if (!form) return
  event.preventDefault()
  const kind = form.dataset.form
  const values = formValues(form)
  try {
    if (kind === 'login') {
      const data = await api('/auth/login', { method: 'POST', body: values })
      state.me = data.user
      return navigate('/app')
    }
    if (kind === 'admin') {
      const data = await api('/admin/auth/login', {
        method: 'POST',
        body: { ...values, captcha_id: state.captchaId },
      })
      state.admin = data.user
      return navigate('/admin')
    }
    if (kind === 'register') {
      const data = await api('/auth/register', {
        method: 'POST',
        body: { ...values, policy_version: POLICY_VERSION },
      })
      state.me = data.user
      box(`<h2>注册成功</h2><p>恢复码只显示这一次，请另行保存。</p><div class="banner">${esc(data.recovery_code)}</div><div class="actions"><button class="primary" data-action="go-app">已保存，进入台账</button></div>`)
      $('#dialog [data-action="go-app"]').onclick = () => { closeDialog(); navigate('/app') }
      return
    }
    if (kind === 'recover') {
      const data = await api('/auth/recover', { method: 'POST', body: values })
      box(`<h2>密码已重置</h2><p>新的恢复码只显示这一次。</p><div class="banner">${esc(data.recovery_code)}</div><div class="actions"><a href="/login"><button class="primary">去登录</button></a></div>`)
      return
    }
    if (kind === 'newDevice' || kind === 'editDevice') {
      if (kind === 'newDevice') {
        const device = await api('/devices', { method: 'POST', body: values })
        closeDialog()
        notify('设备已保存')
        return navigate(`/app/devices/${device.id}`)
      }
      await api(`/devices/${state.device.device.id}`, {
        method: 'PATCH',
        body: { ...values, version: state.device.device.version },
      })
      closeDialog()
      notify('设备已保存')
      return render()
    }
    if (kind === 'plan') {
      const body = { title: values.title, interval_days: Number(values.interval_days), next_due_on: values.next_due_on }
      if (form.dataset.id) {
        const plan = currentPlan(form.dataset.id)
        await api(`/plans/${form.dataset.id}`, { method: 'PATCH', body: { ...body, version: plan.version } })
      } else {
        await api(`/devices/${state.device.device.id}/plans`, { method: 'POST', body })
      }
      closeDialog()
      return render()
    }
    if (kind === 'resume') {
      const plan = currentPlan(form.dataset.id)
      await api(`/plans/${plan.id}`, {
        method: 'PATCH',
        body: { ...plan, status: 'active', next_due_on: values.next_due_on, version: plan.version },
      })
      closeDialog()
      return render()
    }
    if (kind === 'complete') {
      const plan = currentPlan(form.dataset.id)
      const result = await api(`/plans/${plan.id}/completions`, {
        method: 'POST',
        body: { completed_on: values.completed_on, note: values.note, version: plan.version, request_key: requestKey() },
      })
      closeDialog()
      notify(`已登记，下次 ${result.plan.next_due_on}`)
      return render()
    }
    if (kind === 'manual') {
      await api(`/devices/${state.device.device.id}/logs`, {
        method: 'POST',
        body: { ...values, request_key: requestKey() },
      })
      closeDialog()
      notify('已登记')
      return render()
    }
    if (kind === 'export') {
      await api('/auth/reauth', { method: 'POST', body: { password: values.password } })
      const data = await api('/exports/account')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      link.download = 'device-ledger.json'
      link.click()
      closeDialog()
      notify('已导出，文件里没有密码')
      return
    }
    if (kind === 'password') {
      const data = await api('/auth/password', { method: 'PUT', body: values })
      state.me = null
      box(`<h2>密码已修改</h2><p>请重新登录。新的恢复码：</p><div class="banner">${esc(data.recovery_code)}</div><div class="actions"><a href="/login"><button class="primary">去登录</button></a></div>`)
      return
    }
    if (kind === 'deleteAccount') {
      await api('/auth/reauth', { method: 'POST', body: { password: values.password } })
      await api('/me', { method: 'DELETE', body: { confirm_username: values.confirm_username } })
      state.me = null
      closeDialog()
      notify('账户已注销')
      return navigate('/')
    }
    if (kind === 'invite') {
      const data = await api('/admin/invites', {
        method: 'POST',
        body: { max_uses: Number(values.max_uses), expires_on: values.expires_on },
      })
      await render()
      box(`<h2>邀请已创建</h2><p>邀请码只显示这一次。</p><div class="banner">${esc(data.code)}</div><div class="actions"><button class="primary" data-action="close">已保存</button></div>`)
      return
    }
    if (kind === 'filterUsers') {
      const params = new URLSearchParams()
      if (values.q) params.set('q', values.q)
      if (values.status) params.set('status', values.status)
      return navigate(`/admin/users?${params.toString()}`)
    }
  } catch (error) {
    failForm(error.message)
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDialog()
})

window.addEventListener('popstate', () => render())
render()

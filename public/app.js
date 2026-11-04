const TOKEN_KEY = 'sus_token'

const authPanel = document.getElementById('auth-panel')
const userPanel = document.getElementById('user-panel')
const authMsg = document.getElementById('auth-msg')
const userMsg = document.getElementById('user-msg')
const healthEl = document.getElementById('health')

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

function showMsg(el, text, type) {
  el.textContent = text || ''
  el.classList.remove('ok', 'error')
  if (type) el.classList.add(type)
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  let data = null
  try {
    data = await res.json()
  } catch (_) {
    data = { ok: false, message: '响应不是 JSON' }
  }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败 ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

function renderUser(user) {
  document.getElementById('current-name').textContent = user.username
  document.getElementById('current-id').textContent = user.id
  document.getElementById('current-created').textContent = new Date(user.createdAt).toLocaleString()
  authPanel.classList.add('hidden')
  userPanel.classList.remove('hidden')
}

function renderGuest() {
  userPanel.classList.add('hidden')
  authPanel.classList.remove('hidden')
}

async function loadUsers() {
  showMsg(userMsg, '加载中…')
  try {
    const data = await api('/api/users')
    const list = document.getElementById('user-list')
    list.innerHTML = ''
    data.users.forEach((u) => {
      const li = document.createElement('li')
      li.innerHTML = `<span class="who">${escapeHtml(u.username)}</span><span class="when">${new Date(u.createdAt).toLocaleString()}</span>`
      list.appendChild(li)
    })
    showMsg(userMsg, `共 ${data.users.length} 人`, 'ok')
  } catch (e) {
    showMsg(userMsg, e.message, 'error')
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function bootstrapSession() {
  if (!getToken()) {
    renderGuest()
    return
  }
  try {
    const data = await api('/api/me')
    renderUser(data.user)
    await loadUsers()
  } catch (_) {
    setToken('')
    renderGuest()
  }
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    const tab = btn.dataset.tab
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login')
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register')
    showMsg(authMsg, '')
  })
})

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(e.target)
  showMsg(authMsg, '登录中…')
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    })
    setToken(data.token)
    showMsg(authMsg, '登录成功', 'ok')
    renderUser(data.user)
    await loadUsers()
  } catch (err) {
    showMsg(authMsg, err.message, 'error')
  }
})

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(e.target)
  showMsg(authMsg, '注册中…')
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    })
    setToken(data.token)
    showMsg(authMsg, '注册成功', 'ok')
    renderUser(data.user)
    await loadUsers()
  } catch (err) {
    showMsg(authMsg, err.message, 'error')
  }
})

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' })
  } catch (_) {
    /* ignore */
  }
  setToken('')
  showMsg(authMsg, '已退出', 'ok')
  renderGuest()
})

document.getElementById('refresh-users').addEventListener('click', loadUsers)

api('/api/health')
  .then((d) => {
    healthEl.textContent = d.message + ' @ ' + d.time
  })
  .catch(() => {
    healthEl.textContent = '无法连接服务器'
  })

bootstrapSession()

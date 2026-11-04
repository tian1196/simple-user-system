const path = require('path')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const db = require('./db')

const app = express()
const PORT = Number(process.env.PORT) || 3000
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** @type {Map<string, { userId: string, expiresAt: number }>} */
const sessions = new Map()

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '..', 'public')))

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  }
}

function createToken(userId) {
  const token = uuidv4()
  sessions.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

function authOptional(req, _res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token) {
    const session = sessions.get(token)
    if (session && session.expiresAt > Date.now()) {
      const user = db.findUserById(session.userId)
      if (user) req.user = user
    } else if (session) {
      sessions.delete(token)
    }
  }
  next()
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: '请先登录' })
    }
    next()
  })
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'simple-user-system running', time: new Date().toISOString() })
})

app.post('/api/register', (req, res) => {
  try {
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        message: '用户名需 3–20 位，仅字母数字下划线',
      })
    }
    if (password.length < 6 || password.length > 64) {
      return res.status(400).json({ ok: false, message: '密码长度需 6–64 位' })
    }

    const passwordHash = bcrypt.hashSync(password, 10)
    const user = db.createUser({
      id: uuidv4(),
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    })
    const token = createToken(user.id)
    res.status(201).json({ ok: true, token, user: publicUser(user) })
  } catch (e) {
    if (e.code === 'USER_EXISTS') {
      return res.status(409).json({ ok: false, message: e.message })
    }
    console.error(e)
    res.status(500).json({ ok: false, message: '注册失败' })
  }
})

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const user = db.findUserByUsername(username)
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, message: '用户名或密码错误' })
  }
  const token = createToken(user.id)
  res.json({ ok: true, token, user: publicUser(user) })
})

app.get('/api/me', authRequired, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) })
})

app.post('/api/logout', authOptional, (req, res) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token) sessions.delete(token)
  res.json({ ok: true })
})

app.get('/api/users', authRequired, (_req, res) => {
  res.json({ ok: true, users: db.listUsersPublic() })
})

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`简易用户系统已启动: http://0.0.0.0:${PORT}`)
  console.log(`本机访问: http://127.0.0.1:${PORT}`)
})

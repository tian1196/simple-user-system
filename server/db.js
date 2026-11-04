const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json')

function ensureStore() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2), 'utf8')
  }
}

function readStore() {
  ensureStore()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeStore(store) {
  ensureStore()
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function findUserByUsername(username) {
  const store = readStore()
  return store.users.find((u) => u.username === username) || null
}

function findUserById(id) {
  const store = readStore()
  return store.users.find((u) => u.id === id) || null
}

function createUser({ id, username, passwordHash, createdAt }) {
  const store = readStore()
  if (store.users.some((u) => u.username === username)) {
    const err = new Error('用户名已存在')
    err.code = 'USER_EXISTS'
    throw err
  }
  const user = { id, username, passwordHash, createdAt }
  store.users.push(user)
  writeStore(store)
  return user
}

function listUsersPublic() {
  const store = readStore()
  return store.users.map((u) => ({
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
  }))
}

module.exports = {
  findUserByUsername,
  findUserById,
  createUser,
  listUsersPublic,
}

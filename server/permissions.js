/**
 * 后台角色与权限。
 * admin 拥有全部权限，且不能被配置成空权限；其余角色按固定清单授权。
 * 普通用户不进入后台。
 */

const PERMISSIONS = [
  { key: 'overview.read', name: '运营概览', description: '查看用户数、设备数等汇总，不包含私人台账内容。' },
  { key: 'users.read', name: '查看账号', description: '查看普通账号的用户名、状态和设备数量。' },
  { key: 'users.manage', name: '管理账号', description: '停用、恢复普通账号，并重置其登录密码。' },
  { key: 'invites.manage', name: '邀请管理', description: '创建和撤销注册邀请码。' },
  { key: 'accounts.manage', name: '系统账号', description: '创建后台账号、分配角色、重置后台密码。' },
  { key: 'settings.manage', name: '运营配置', description: '开关注册入口和业务写入。' },
  { key: 'audit.read', name: '操作审计', description: '查看关键操作记录。' },
  { key: 'permissions.read', name: '查看权限', description: '查看各角色能做什么。' },
  { key: 'saas.manage', name: '套餐工作区', description: '查看工作区用量，并调整套餐和订阅状态。' },
]

const ALL_PERMISSIONS = PERMISSIONS.map((item) => item.key)

const ROLES = [
  {
    key: 'admin',
    name: '管理员',
    description: '最高权限。可以管理后台账号、分配角色，并使用全部功能。',
    staff: true,
    rank: 0,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'operator',
    name: '运营',
    description: '处理日常账号和邀请，不能改系统账号、配置和审计。',
    staff: true,
    rank: 1,
    permissions: ['overview.read', 'users.read', 'users.manage', 'invites.manage', 'permissions.read'],
  },
  {
    key: 'support',
    name: '客服',
    description: '查看并处理普通账号，包括停用和重置密码，不能发邀请或改配置。',
    staff: true,
    rank: 2,
    permissions: ['overview.read', 'users.read', 'users.manage', 'permissions.read'],
  },
  {
    key: 'auditor',
    name: '审计',
    description: '只读查看运营概览和操作审计，不能修改任何数据。',
    staff: true,
    rank: 3,
    permissions: ['overview.read', 'audit.read', 'permissions.read'],
  },
  {
    key: 'partner',
    name: '第三方',
    description: '外部协作账号，只能看运营汇总，不能打开账号、邀请和审计。',
    staff: true,
    rank: 4,
    permissions: ['overview.read', 'permissions.read'],
  },
  {
    key: 'user',
    name: '普通用户',
    description: '通过邀请注册，只能登录自己的设备台账，不能进入管理后台。',
    staff: false,
    rank: 5,
    permissions: [],
  },
]

const ROLE_BY_KEY = new Map(ROLES.map((role) => [role.key, role]))

function roleOf(role) {
  return ROLE_BY_KEY.get(role) || null
}

function permissionsOf(role) {
  return roleOf(role)?.permissions.slice() || []
}

function hasPermission(role, permission) {
  return Boolean(roleOf(role)?.permissions.includes(permission))
}

function isStaffRole(role) {
  return Boolean(roleOf(role)?.staff)
}

function staffInSql() {
  return ROLES.filter((role) => role.staff).map((role) => `'${role.key}'`).join(', ')
}

function roleOrderSql() {
  const branches = ROLES.map((role) => `WHEN '${role.key}' THEN ${role.rank}`).join(' ')
  return `CASE role ${branches} ELSE 9 END`
}

function catalog() {
  return {
    permissions: PERMISSIONS.map((item) => ({ ...item })),
    roles: ROLES.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      staff: role.staff,
      permissions: role.permissions.slice(),
    })),
  }
}

module.exports = {
  PERMISSIONS,
  ROLES,
  permissionsOf,
  hasPermission,
  isStaffRole,
  staffInSql,
  roleOrderSql,
  catalog,
}

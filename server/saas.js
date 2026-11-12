/**
 * 内置套餐。启动时写入 plans 表，之后可以再添加套餐。
 * 免费版适合试用，专业版沿用原来的每账号 100 台设备。
 */

const STATUSES = ['trialing', 'active', 'past_due', 'canceled']

const PLANS = [
  {
    key: 'free',
    name: '免费版',
    description: '适合个人试用。席位少，设备额度低。',
    seats: 3,
    devices: 20,
  },
  {
    key: 'pro',
    name: '专业版',
    description: '适合日常使用。每账号 100 台设备，可邀请更多成员。',
    seats: 20,
    devices: 100,
  },
  {
    key: 'enterprise',
    name: '企业版',
    description: '适合多人长期使用，席位和设备额度都更高。',
    seats: 200,
    devices: 1000,
  },
]

const PLAN_BY_KEY = new Map(PLANS.map((plan) => [plan.key, plan]))

function planOf(key) {
  return PLAN_BY_KEY.get(key) || null
}

function catalog() {
  return PLANS.map((plan) => ({ ...plan }))
}

function isWritableStatus(status) {
  return status === 'trialing' || status === 'active'
}

module.exports = {
  STATUSES,
  PLANS,
  planOf,
  catalog,
  isWritableStatus,
}

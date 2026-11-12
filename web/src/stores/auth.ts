import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { adminLogin, adminLogout, getAdminProfile } from '@/api/auth'
import type { AdminProfile, LoginPayload } from '@/api/types'
import { ROLE_LABELS, type PermissionKey, type StaffRole } from '@/constants/access'

const PROFILE_KEY = 'ledger.admin.profile'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AdminProfile | null>(readProfile())
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const roleLabel = computed(() => {
    const role = user.value?.role
    if (role && role in ROLE_LABELS) return ROLE_LABELS[role as StaffRole]
    return '后台账号'
  })

  function can(permission: PermissionKey): boolean {
    return Boolean(user.value?.permissions?.includes(permission))
  }
  const displayName = computed(() => user.value?.username || '管理员')

  async function login(payload: LoginPayload): Promise<AdminProfile> {
    loading.value = true
    try {
      const result = await adminLogin(payload)
      user.value = result.user
      initialized.value = true
      persist(result.user)
      return result.user
    } finally {
      loading.value = false
    }
  }

  /** 挂载或刷新页面时恢复 Cookie 会话；失败则视为未登录 */
  async function fetchProfile(): Promise<AdminProfile | null> {
    if (initialized.value) return user.value
    try {
      const profile = await getAdminProfile()
      user.value = profile
      persist(profile)
      return profile
    } catch {
      clearProfile()
      return null
    } finally {
      initialized.value = true
    }
  }

  async function logout(): Promise<void> {
    try {
      await adminLogout()
    } catch {
      // 会话可能已经失效，本地状态仍然需要清理
    } finally {
      reset()
    }
  }

  /** 本地清理，不发起请求（401 全局处理时使用） */
  function reset(): void {
    user.value = null
    initialized.value = true
    clearProfile()
  }

  return {
    user,
    initialized,
    loading,
    isAuthenticated,
    isAdmin,
    roleLabel,
    can,
    displayName,
    login,
    fetchProfile,
    logout,
    reset,
  }
})

function readProfile(): AdminProfile | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(PROFILE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminProfile
  } catch {
    window.localStorage.removeItem(PROFILE_KEY)
    return null
  }
}

function persist(profile: AdminProfile): void {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

function clearProfile(): void {
  window.localStorage.removeItem(PROFILE_KEY)
}

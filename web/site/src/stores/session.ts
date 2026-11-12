import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getProfile, logout as endSession, type UserProfile } from '../api/session'
import { SiteApiError } from '../api/request'

export const useSessionStore = defineStore('site-session', () => {
  const user = ref<UserProfile | null>(null)
  const initialized = ref(false)
  const authenticated = computed(() => user.value?.role === 'user')
  let pending: Promise<void> | undefined
  let revision = 0

  function setUser(profile: UserProfile): void {
    revision += 1
    user.value = profile
    initialized.value = true
  }

  function reset(): void {
    revision += 1
    user.value = null
    initialized.value = true
  }

  async function restore(): Promise<void> {
    if (initialized.value) return
    if (pending) return pending
    const startedAtRevision = revision
    pending = (async () => {
      try {
        const profile = await getProfile()
        // 较早的身份探测不能覆盖后续登录或退出产生的新状态。
        if (revision !== startedAtRevision) return
        user.value = profile
        initialized.value = true
      } catch (error) {
        if (revision !== startedAtRevision) return
        if (error instanceof SiteApiError && error.status === 401) reset()
        else throw error
      } finally { pending = undefined }
    })()
    return pending
  }

  async function logout(): Promise<void> {
    try { await endSession() }
    catch (error) {
      if (!(error instanceof SiteApiError) || error.status !== 401) throw error
    }
    reset()
  }

  return { user, initialized, authenticated, restore, reset, setUser, logout }
})

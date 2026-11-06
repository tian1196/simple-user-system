import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const SIDEBAR_KEY = 'ledger.admin.sidebar-collapsed'
const MOBILE_BREAKPOINT = '(max-width: 900px)'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(readCollapsed())
  const isMobile = ref(false)
  const mobileSidebarOpen = ref(false)

  const sidebarWidth = computed(() => (sidebarCollapsed.value ? 64 : 232))

  function toggleSidebar(): void {
    if (isMobile.value) {
      mobileSidebarOpen.value = !mobileSidebarOpen.value
      return
    }
    sidebarCollapsed.value = !sidebarCollapsed.value
    localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed.value ? '1' : '0')
  }

  function setCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
    localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0')
  }

  function closeMobileSidebar(): void {
    mobileSidebarOpen.value = false
  }

  function syncViewport(): void {
    if (typeof window === 'undefined') return
    isMobile.value = window.matchMedia(MOBILE_BREAKPOINT).matches
    if (!isMobile.value) mobileSidebarOpen.value = false
  }

  return {
    sidebarCollapsed,
    sidebarWidth,
    isMobile,
    mobileSidebarOpen,
    toggleSidebar,
    setCollapsed,
    closeMobileSidebar,
    syncViewport,
  }
})

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_KEY) === '1'
}

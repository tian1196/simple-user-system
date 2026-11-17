import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
export function useUnsavedChanges(dirty: Ref<boolean>, busy: Ref<boolean>) {
  const leaveDialog = ref<HTMLDialogElement | null>(null)
  let resolveLeave: ((value: boolean) => void) | undefined
  function confirmLeave(discard: boolean) {
    leaveDialog.value?.close()
    resolveLeave?.(discard)
    resolveLeave = undefined
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' }
  }
  onBeforeRouteLeave(async to => {
    if (to.name === 'site-login') return true
    if (busy.value) return false
    if (!dirty.value) return true
    await nextTick()
    return new Promise<boolean>(resolve => {
      resolveLeave = resolve
      leaveDialog.value?.showModal()
    })
  })
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnload)
    confirmLeave(false)
  })
  return { leaveDialog, confirmLeave }
}

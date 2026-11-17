import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getReminders, type Reminders } from '../api/reminders'
export const useRemindersStore = defineStore('site-reminders', () => {
  const data = ref<Reminders | null>(null)
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let controller: AbortController | undefined
  function reset() {
    generation += 1
    controller?.abort()
    data.value = null
    loading.value = false
    error.value = ''
  }
  function apply(value: Reminders) {
    generation += 1
    controller?.abort()
    data.value = value
    error.value = ''
    loading.value = false
  }
  async function refresh() {
    controller?.abort()
    const local = new AbortController()
    controller = local
    const run = ++generation
    loading.value = true
    error.value = ''
    try {
      const value = await getReminders(local.signal)
      if (generation === run) data.value = value
    } catch (cause) {
      if (!local.signal.aborted && generation === run) error.value = cause instanceof Error ? cause.message : '待办加载失败'
    } finally {
      if (generation === run) loading.value = false
    }
  }
  return { data, loading, error, refresh, apply, reset }
})

import { ref, watch } from 'vue'
import { listFeedback } from '../api/feedback'
import type { FeedbackList } from '../../../shared/feedback'

export function useFeedbackList(fetchList: typeof listFeedback = listFeedback) {
  const data = ref<FeedbackList | null>(null)
  const filter = ref('all')
  const page = ref(1)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | undefined
  async function load() {
    controller?.abort()
    const local = new AbortController()
    controller = local
    const status = filter.value
    const requestedPage = page.value
    loading.value = true
    error.value = ''
    try {
      const value = await fetchList({ status, page: requestedPage }, local.signal)
      if (local.signal.aborted || status !== filter.value || requestedPage !== page.value) return
      const lastPage = Math.max(1, Math.ceil(value.total / value.page_size))
      if (requestedPage > lastPage) {
        page.value = lastPage
        return
      }
      data.value = value
    } catch (cause) {
      if (!local.signal.aborted) error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      if (controller === local) loading.value = false
    }
  }
  const stop = watch([filter, page], ([status], [previousStatus]) => {
    if (status !== previousStatus && page.value !== 1) { page.value = 1; return }
    void load()
  })
  function dispose() { stop(); controller?.abort() }
  return { data, filter, page, loading, error, load, dispose }
}

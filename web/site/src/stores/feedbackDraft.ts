import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { feedbackKey, type FeedbackAttachment, type FeedbackSubmission, type FeedbackType } from '../../../shared/feedback'
import { removeFeedbackImage } from '../api/feedback'
import { SiteApiError } from '../api/request'
export const useFeedbackDraft = defineStore('site-feedback-draft', () => {
  const owner = ref<string | null>(null)
  const form = reactive({ type: 'issue' as FeedbackType, title: '', content: '', contact: '', consent: false, source: '' })
  const attachments = ref<FeedbackAttachment[]>([])
  // Keep retries tied to this owner's draft even after the form component remounts.
  let attempt = ''
  let requestKey = ''
  function submissionKey(data: Omit<FeedbackSubmission, 'request_key'>): string {
    const current = JSON.stringify(data)
    if (current !== attempt) { attempt = current; requestKey = feedbackKey() }
    return requestKey
  }
  async function removeAttachment(id: string): Promise<void> {
    const requestedOwner = owner.value
    try { await removeFeedbackImage(id) }
    catch (cause) {
      // Temporary screenshots can expire while an in-memory draft is open.
      if (!(cause instanceof SiteApiError) || cause.status !== 404) throw cause
    }
    if (owner.value === requestedOwner) attachments.value = attachments.value.filter(file => file.id !== id)
  }
  function reset() {
    owner.value = null
    attempt = ''; requestKey = ''
    Object.assign(form, { type: 'issue', title: '', content: '', contact: '', consent: false, source: '' })
    attachments.value = []
  }
  function prepare(userId: string, source: string) {
    if (owner.value && owner.value !== userId) reset()
    owner.value = userId
    if (!form.source) form.source = source
  }
  return { owner, form, attachments, reset, prepare, submissionKey, removeAttachment }
})

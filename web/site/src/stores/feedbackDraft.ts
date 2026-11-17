import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { FeedbackAttachment, FeedbackType } from '../../../shared/feedback'
export const useFeedbackDraft = defineStore('site-feedback-draft', () => {
  const owner = ref<string | null>(null)
  const form = reactive({ type: 'issue' as FeedbackType, title: '', content: '', contact: '', consent: false, source: '' })
  const attachments = ref<FeedbackAttachment[]>([])
  function reset() {
    owner.value = null
    Object.assign(form, { type: 'issue', title: '', content: '', contact: '', consent: false, source: '' })
    attachments.value = []
  }
  function prepare(userId: string, source: string) {
    if (owner.value && owner.value !== userId) reset()
    owner.value = userId
    if (!form.source) form.source = source
  }
  return { owner, form, attachments, reset, prepare }
})

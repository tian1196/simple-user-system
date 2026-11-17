import { request } from './request'
import type { FeedbackAttachment, FeedbackDetail, FeedbackList, FeedbackSubmission } from '../../../shared/feedback'
export const submitFeedback = (data: FeedbackSubmission) => request<FeedbackDetail>({ url: '/feedback', method: 'post', data })
export const listFeedback = (params: { status?: string; page?: number }, signal?: AbortSignal) => request<FeedbackList>({ url: '/feedback', params, signal })
export const getFeedback = (id: string, signal?: AbortSignal) => request<FeedbackDetail>({ url: `/feedback/${encodeURIComponent(id)}`, signal })
export const uploadFeedbackImage = (file: File, key: string) => request<FeedbackAttachment>({ url: '/feedback/attachments', method: 'post', timeout: 120_000, data: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Upload-Key': key } })
export const removeFeedbackImage = (id: string) => request<void>({ url: `/feedback/attachments/${encodeURIComponent(id)}`, method: 'delete' })

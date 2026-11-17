import { request } from './request'
import type { AdminFeedback, FeedbackHandling, FeedbackList, FeedbackStatus } from '../../shared/feedback'
export const getFeedbackList = (params: { q?: string; type?: string; status?: string; from?: string; to?: string; page: number; page_size: number }) => request<FeedbackList>({ url: '/admin/feedback', params })
export const getFeedbackDetail = (id: string) => request<AdminFeedback>({ url: `/admin/feedback/${encodeURIComponent(id)}` })
export const updateFeedback = (id: string, data: FeedbackHandling & { version: number }) => request<AdminFeedback>({ url: `/admin/feedback/${encodeURIComponent(id)}`, method: 'patch', data })
export const getFeedbackStats = () => request<Record<'all' | FeedbackStatus, number>>({ url: '/admin/feedback/stats', silent: true })

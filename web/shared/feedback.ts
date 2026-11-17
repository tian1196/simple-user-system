export type FeedbackType = 'issue' | 'suggestion' | 'experience'
export type FeedbackStatus = 'pending' | 'processing' | 'resolved'
export const feedbackTypes: Record<FeedbackType, string> = { issue: '遇到问题', suggestion: '功能建议', experience: '使用感受' }
export const feedbackStatuses: Record<FeedbackStatus, string> = { pending: '待处理', processing: '处理中', resolved: '已处理' }
export interface FeedbackAttachment { id: string; filename: string; mime: string; size: number }
export interface FeedbackSummary { id: string; number: string; type: FeedbackType; title: string; status: FeedbackStatus; created_at: number; updated_at: number; username?: string }
export interface FeedbackDetail extends FeedbackSummary {
  content: string; contact: string; diagnostics: { page_path: string; browser: string } | null
  reply: string; replied_at: number | null; attachments: FeedbackAttachment[]; version: number
}
export interface FeedbackHandling { status: FeedbackStatus; reply: string; internal_note: string }
export interface AdminFeedback extends FeedbackDetail {
  internal_note: string; history: { id: string; actor: string; created_at: number; before: FeedbackHandling; after: FeedbackHandling }[]
}
export interface FeedbackList { items: FeedbackSummary[]; total: number; page: number; page_size: number; counts: Record<'all' | FeedbackStatus, number> }
export interface FeedbackSubmission { type: FeedbackType; title: string; content: string; contact: string; request_key: string; attachment_ids: string[]; diagnostics_consent: boolean; diagnostics?: { page_path: string; browser: string } }
export function feedbackDate(value: number | null): string { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—' }
export function feedbackAttachmentUrl(id: string, admin = false): string { return `${(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')}/${admin ? 'admin/' : ''}feedback/attachments/${encodeURIComponent(id)}` }
export function feedbackKey(): string { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` }

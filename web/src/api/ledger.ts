import { request } from './request'

export interface LedgerEntry {
  id: string
  user_id: string
  username: string | null
  kind: 'expense' | 'income'
  category: string
  category_label: string
  amount_cents: number
  amount: string
  occurred_on: string
  note: string
  created_at: number
  updated_at: number
  version: number
}

export interface LedgerSummary {
  expense_cents: number
  income_cents: number
  balance_cents: number
  expense: string
  income: string
  balance: string
}

export interface AdminLedgerPage {
  items: LedgerEntry[]
  total: number
  page: number
  page_size: number
  month: string | null
  summary: LedgerSummary
}

export function getAdminLedger(query: {
  q?: string
  kind?: '' | 'expense' | 'income'
  month?: string
  page: number
  page_size: number
}): Promise<AdminLedgerPage> {
  const params: Record<string, string | number> = {
    page: query.page,
    page_size: query.page_size,
  }
  const keyword = query.q?.trim()
  if (keyword) params.q = keyword
  if (query.kind) params.kind = query.kind
  if (query.month) params.month = query.month
  return request<AdminLedgerPage>({
    url: '/admin/ledger',
    method: 'get',
    params,
  })
}

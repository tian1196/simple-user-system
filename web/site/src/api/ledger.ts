import { request } from './request'

export interface LedgerCategory {
  key: string
  label: string
}

export interface LedgerEntry {
  id: string
  kind: 'expense' | 'income'
  category: string
  category_label: string
  amount_cents: number
  amount: string
  occurred_on: string
  note: string
  version: number
}

export interface LedgerCategoryStat {
  kind: 'expense' | 'income'
  category: string
  category_label: string
  amount_cents: number
  amount: string
  share: number
}

export interface LedgerDay {
  date: string
  expense_cents: number
  income_cents: number
  expense: string
  income: string
}

export interface LedgerBook {
  month: string | null
  from: string
  to: string
  summary: {
    expense_cents: number
    income_cents: number
    balance_cents: number
    expense: string
    income: string
    balance: string
  }
  categories: LedgerCategoryStat[]
  days: LedgerDay[]
  items: LedgerEntry[]
  catalog: { expense: LedgerCategory[]; income: LedgerCategory[] }
}

export function listLedger(range: { from: string; to: string }): Promise<LedgerBook> {
  return request({ url: '/ledger', params: { from: range.from, to: range.to } })
}

export function createLedgerEntry(payload: {
  kind: 'expense' | 'income'
  category: string
  amount: string
  occurred_on: string
  note: string
}): Promise<LedgerEntry> {
  return request({ url: '/ledger', method: 'post', data: payload })
}

export function updateLedgerEntry(
  id: string,
  payload: {
    kind: 'expense' | 'income'
    category: string
    amount: string
    occurred_on: string
    note: string
    version: number
  },
): Promise<LedgerEntry> {
  return request({ url: `/ledger/${encodeURIComponent(id)}`, method: 'patch', data: payload })
}

export function deleteLedgerEntry(id: string, version: number): Promise<void> {
  return request({ url: `/ledger/${encodeURIComponent(id)}`, method: 'delete', data: { version } })
}

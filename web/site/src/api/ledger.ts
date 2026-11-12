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

export interface LedgerMonth {
  month: string
  summary: {
    expense_cents: number
    income_cents: number
    balance_cents: number
    expense: string
    income: string
    balance: string
  }
  categories: Array<{
    kind: 'expense' | 'income'
    category: string
    category_label: string
    amount_cents: number
    amount: string
  }>
  items: LedgerEntry[]
  catalog: { expense: LedgerCategory[]; income: LedgerCategory[] }
}

export function listLedger(month: string): Promise<LedgerMonth> {
  return request({ url: '/ledger', params: { month } })
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

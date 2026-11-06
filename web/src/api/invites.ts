import { request } from './request'
import type { CreateInvitePayload, CreatedInvite, InviteItem, ListResult } from './types'

export function getInvites(): Promise<ListResult<InviteItem>> {
  return request<ListResult<InviteItem>>({
    url: '/admin/invites',
    method: 'get',
  })
}

export function createInvite(payload: CreateInvitePayload): Promise<CreatedInvite> {
  return request<CreatedInvite>({
    url: '/admin/invites',
    method: 'post',
    data: payload,
  })
}

export function revokeInvite(id: string): Promise<InviteItem> {
  return request<InviteItem>({
    url: `/admin/invites/${encodeURIComponent(id)}/revoke`,
    method: 'post',
  })
}

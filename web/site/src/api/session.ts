import { request } from './request'

export interface UserProfile {
  id: string
  username: string
  role: 'user' | 'operator' | 'owner'
  status: 'active' | 'disabled'
}

export function getProfile(): Promise<UserProfile> {
  return request({ url: '/auth/me', allowGuest: true })
}

export function logout(): Promise<void> {
  return request({ url: '/auth/logout', method: 'post' })
}

export interface LoginResult {
  user: UserProfile
}
export interface RegistrationResult extends LoginResult {
  recovery_code: string
}
export function login(payload: { username: string; password: string }): Promise<LoginResult> {
  return request({ url: '/auth/login', method: 'post', data: payload, allowGuest: true })
}
export function register(payload: {
  username: string
  password: string
  invite_code: string
  policy_version: string
}): Promise<RegistrationResult> {
  return request({ url: '/auth/register', method: 'post', data: payload, allowGuest: true })
}
export function recover(payload: {
  username: string
  recovery_code: string
  new_password: string
}): Promise<{ recovery_code: string }> {
  return request({ url: '/auth/recover', method: 'post', data: payload, allowGuest: true })
}

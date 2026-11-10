import { request } from './request'
import type { AdminProfile, CaptchaChallenge, LoginPayload, LoginResult } from './types'

export function getAdminCaptcha(): Promise<CaptchaChallenge> {
  return request<CaptchaChallenge>({
    url: '/admin/auth/captcha',
    method: 'get',
    silent: true,
    skipAuthHandler: true,
  })
}

export function adminLogin(payload: LoginPayload): Promise<LoginResult> {
  return request<LoginResult>({
    url: '/admin/auth/login',
    method: 'post',
    data: payload,
    silent: true,
    skipAuthHandler: true,
  })
}

export function adminLogout(): Promise<void> {
  return request<void>({
    url: '/admin/auth/logout',
    method: 'post',
    silent: true,
  })
}

export function getAdminProfile(): Promise<AdminProfile> {
  return request<AdminProfile>({
    url: '/admin/auth/me',
    method: 'get',
    silent: true,
    skipAuthHandler: true,
  })
}

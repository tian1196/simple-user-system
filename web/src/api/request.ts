import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

import { emitUnauthorized } from '@/utils/auth-bus'

interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
  }
  request_id?: string
}

const STATUS_MESSAGE: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已过期，请重新登录',
  403: '没有权限执行该操作',
  404: '请求的资源不存在',
  409: '数据已被修改，请刷新后重试',
  422: '请求无法处理',
  429: '操作过于频繁，请稍后再试',
  500: '服务器开小差了，请稍后重试',
  502: '网关异常，请稍后重试',
  503: '服务暂不可用，请稍后重试',
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string

  constructor(message: string, options: { status: number; code: string; requestId?: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
  }
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 60_000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (axios.isCancel(error)) return Promise.reject(error)

    const config = error.config
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const code = body?.error?.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR')
    const message = body?.error?.message || fallbackMessage(status, error)
    const apiError = new ApiError(message, {
      status,
      code,
      requestId: body?.request_id,
    })

    if (status === 401 && !config?.skipAuthHandler) {
      if (!config?.silent) ElMessage.warning('登录状态已失效，请重新登录')
      emitUnauthorized()
    } else if (!config?.silent) {
      ElMessage.error(message)
    }

    return Promise.reject(apiError)
  },
)

function fallbackMessage(status: number, error: AxiosError): string {
  if (status === 0) {
    if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试'
    return '无法连接服务器，请确认后端服务已启动'
  }
  return STATUS_MESSAGE[status] || '请求失败，请稍后重试'
}

/**
 * 统一请求入口。
 * 后端响应为 `{ data, request_id }`，在这里统一解包后返回业务数据。
 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request(config)
  if (response.status === 204) return null as T

  const payload = response.data as unknown
  if (payload && typeof payload === 'object' && 'data' in payload && 'request_id' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

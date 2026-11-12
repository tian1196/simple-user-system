import axios, { type AxiosRequestConfig } from 'axios'

interface Envelope<T> { data: T; request_id: string }
interface ErrorBody { error?: { code?: string; message?: string }; request_id?: string }
interface RequestOptions extends AxiosRequestConfig { allowGuest?: boolean }

export class SiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'SiteApiError'
  }
}

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  withCredentials: true,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
})

let sessionExpired: (() => void) | undefined
export function onSessionExpired(handler: () => void): void { sessionExpired = handler }

/** 与现有后端共用 Cookie 会话及响应格式；与管理员会话处理隔离。 */
export async function request<T>(options: RequestOptions): Promise<T> {
  const { allowGuest, ...config } = options
  try {
    const response = await http.request<Envelope<T>>(config)
    if (response.status === 204) return undefined as T
    if (config.responseType === 'text') return response.data as unknown as T
    return response.data.data
  } catch (error) {
    if (!axios.isAxiosError<ErrorBody>(error)) throw error
    const status = error.response?.status || 0
    let body = error.response?.data
    // 日历接口使用 text；其错误响应仍然是标准 JSON。
    if (typeof body === 'string') {
      try { body = JSON.parse(body) as ErrorBody } catch { body = undefined }
    }
    if (status === 401 && !allowGuest) sessionExpired?.()
    throw new SiteApiError(
      body?.error?.message || (status ? '请求失败，请稍后重试' : '无法连接服务器，请稍后重试'),
      status,
      body?.error?.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR'),
      body?.request_id,
    )
  }
}

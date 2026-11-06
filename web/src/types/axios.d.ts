import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 不弹出全局错误提示，由调用方自行处理 */
    silent?: boolean
    /** 401 时不触发全局退出登录（例如登录接口、启动时的会话探测） */
    skipAuthHandler?: boolean
  }
}

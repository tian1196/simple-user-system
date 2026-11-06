type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

/** 注册全局 401 处理器（由 main.ts 注入，避免请求层直接依赖路由与 store） */
export function onUnauthorized(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler
}

export function emitUnauthorized(): void {
  unauthorizedHandler?.()
}

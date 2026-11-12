import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    root: fileURLToPath(new URL('./site', import.meta.url)),
    base: '/',
    plugins: [vue()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': { target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false },
        '/admin': { target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false },
      },
    },
    preview: { host: '127.0.0.1', port: 4174 },
    build: {
      outDir: fileURLToPath(new URL('./site-dist', import.meta.url)),
      emptyOutDir: true,
    },
  }
})

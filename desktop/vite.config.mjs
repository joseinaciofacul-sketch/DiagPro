import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { normalizeApiBaseUrl } from './src/config/apiBase.mjs'

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const apiOrigin = new URL(normalizeApiBaseUrl(env.VITE_DIAGPRO_API_BASE_URL)).origin
  return {
  base: './',
  plugins: [react(), {
    name: 'diagpro-production-csp',
    transformIndexHtml() {
      if (command !== 'build') return []
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${apiOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`,
      }, injectTo: 'head-prepend' }]
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  }
})

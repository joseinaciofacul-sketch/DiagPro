import { loadEnv } from 'vite'
import { normalizeApiBaseUrl } from '../src/config/apiBase.mjs'

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env }
const value = env.VITE_DIAGPRO_API_BASE_URL
if (!value || new URL(normalizeApiBaseUrl(value)).protocol !== 'https:') {
  throw new Error('Defina VITE_DIAGPRO_API_BASE_URL com a API HTTPS real antes de gerar o instalador.')
}
console.log('Configuração HTTPS de distribuição validada; nenhuma publicação será realizada.')

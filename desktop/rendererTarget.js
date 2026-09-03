const path = require('path')

const DEFAULT_DEV_SERVER_URL = 'http://127.0.0.1:5173'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function rendererTarget({ packaged, appDirectory, devServerUrl = DEFAULT_DEV_SERVER_URL }) {
  if (packaged) {
    return { kind: 'file', value: path.join(appDirectory, 'dist', 'index.html') }
  }

  let parsed
  try {
    parsed = new URL(devServerUrl)
  } catch {
    throw new Error('DIAGPRO_RENDERER_URL inválida.')
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('O servidor de desenvolvimento do renderer deve usar um endereço HTTP local.')
  }
  return { kind: 'url', value: parsed.toString() }
}

module.exports = { DEFAULT_DEV_SERVER_URL, rendererTarget }

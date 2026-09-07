const fs = require('fs')
const path = require('path')

const SAFE_DETAIL_KEYS = new Set([
  'code',
  'exitCode',
  'packaged',
  'reason',
  'targetKind',
  'type',
  'version',
])

function sanitizeDetails(details = {}) {
  const sanitized = {}
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue
    sanitized[key] = typeof value === 'string'
      ? value.replace(/[\r\n]/g, ' ').slice(0, 160)
      : value
  }
  return sanitized
}

function createProductionLogger({ directory, now = () => new Date() }) {
  if (!directory) throw new Error('O diretório de logs é obrigatório.')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, 'diagpro.log')

  function write(level, event, details = {}) {
    const entry = {
      timestamp: now().toISOString(),
      level,
      event: String(event || 'unknown').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80),
      ...sanitizeDetails(details),
    }
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        fs.copyFileSync(filePath, `${filePath}.previous`)
        fs.truncateSync(filePath, 0)
      }
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
    } catch { /* Logging é best-effort e nunca interrompe a operação. */ }
  }

  return {
    filePath,
    info: (event, details) => write('info', event, details),
    error: (event, details) => write('error', event, details),
  }
}

module.exports = { createProductionLogger, sanitizeDetails }

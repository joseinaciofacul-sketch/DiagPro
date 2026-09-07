const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { createProductionLogger, sanitizeDetails } = require('./productionLogger')

test('logger mantém somente metadados operacionais permitidos', () => {
  assert.deepEqual(sanitizeDetails({
    code: 'ADB_NOT_FOUND',
    serial: 'DEVICE-SECRET',
    token: 'JWT-SECRET',
    password: 'PASSWORD-SECRET',
  }), { code: 'ADB_NOT_FOUND' })
})

test('logger grava evento estruturado sem conteúdo sensível', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diagpro-log-'))
  try {
    const logger = createProductionLogger({
      directory,
      now: () => new Date('2026-09-04T12:00:00.000Z'),
    })
    logger.error('api_unavailable', { code: 'NETWORK_ERROR', refreshToken: 'SECRET' })
    const entry = JSON.parse(fs.readFileSync(logger.filePath, 'utf8'))
    assert.deepEqual(entry, {
      timestamp: '2026-09-04T12:00:00.000Z',
      level: 'error',
      event: 'api_unavailable',
      code: 'NETWORK_ERROR',
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

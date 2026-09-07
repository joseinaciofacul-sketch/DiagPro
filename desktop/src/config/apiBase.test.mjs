import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DEVELOPMENT_API_BASE_URL,
  joinApiUrl,
  normalizeApiBaseUrl,
} from './apiBase.mjs'

test('API usa loopback somente como padrão de desenvolvimento', () => {
  assert.equal(normalizeApiBaseUrl(), DEFAULT_DEVELOPMENT_API_BASE_URL)
})

test('API aceita HTTPS e preserva prefixo de implantação', () => {
  const base = normalizeApiBaseUrl('https://backend.example.test/diagpro/')
  assert.equal(base, 'https://backend.example.test/diagpro')
  assert.equal(joinApiUrl(base, '/api/diagnosticos/'), 'https://backend.example.test/diagpro/api/diagnosticos/')
})

test('API rejeita protocolo inseguro para arquivos e credenciais embutidas', () => {
  assert.throws(() => normalizeApiBaseUrl('file:///api'), /HTTP ou HTTPS/)
  assert.throws(() => normalizeApiBaseUrl('https://usuario:senha@example.test'), /credenciais/)
  assert.throws(() => normalizeApiBaseUrl('https://example.test?token=secret'), /consulta/)
})

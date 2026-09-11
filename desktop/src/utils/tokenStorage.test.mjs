import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCESS_KEY, REFRESH_KEY, USERNAME_KEY,
  clearSession, readAccessToken, readRefreshToken, saveTokens,
} from './tokenStorage.mjs'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

test('lembrar-me armazena access e refresh da sessão Google como no login tradicional', () => {
  const storage = memoryStorage()
  saveTokens(storage, 'access', 'refresh')
  assert.equal(readAccessToken(storage), 'access')
  assert.equal(readRefreshToken(storage), 'refresh')
})

test('logout remove access, refresh e nome de usuário', () => {
  const storage = memoryStorage()
  storage.setItem(ACCESS_KEY, 'access')
  storage.setItem(REFRESH_KEY, 'refresh')
  storage.setItem(USERNAME_KEY, 'user')
  clearSession(storage)
  assert.equal(readAccessToken(storage), null)
  assert.equal(readRefreshToken(storage), null)
  assert.equal(storage.getItem(USERNAME_KEY), null)
})

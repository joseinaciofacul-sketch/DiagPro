const assert = require('node:assert/strict')
const path = require('path')
const test = require('node:test')
const { pathToFileURL } = require('url')

const { isTrustedRendererUrl } = require('./electronPolicy')

test('renderer local aceita somente o arquivo empacotado esperado', () => {
  const target = { kind: 'file', value: path.join(__dirname, 'dist', 'index.html') }
  const trusted = `${pathToFileURL(target.value).href}#dashboard`
  assert.equal(isTrustedRendererUrl(trusted, target), true)
  assert.equal(isTrustedRendererUrl(pathToFileURL(path.join(__dirname, 'outro.html')).href, target), false)
  assert.equal(isTrustedRendererUrl('https://example.test', target), false)
})

test('renderer de desenvolvimento fica restrito à origem loopback escolhida', () => {
  const target = { kind: 'url', value: 'http://127.0.0.1:5173/' }
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/scanner', target), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', target), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', target), false)
})

const assert = require('node:assert/strict')
const path = require('path')
const test = require('node:test')

const { rendererTarget } = require('./rendererTarget')

test('desenvolvimento usa somente servidor renderer local', () => {
  const target = rendererTarget({ packaged: false, appDirectory: __dirname })
  assert.equal(target.kind, 'url')
  assert.equal(target.value, 'http://127.0.0.1:5173/')
  assert.throws(
    () => rendererTarget({ packaged: false, appDirectory: __dirname, devServerUrl: 'https://example.com' }),
    /endereço HTTP local/,
  )
})

test('produção carrega o index gerado dentro de dist', () => {
  const target = rendererTarget({ packaged: true, appDirectory: __dirname })
  assert.equal(target.kind, 'file')
  assert.equal(target.value, path.join(__dirname, 'dist', 'index.html'))
})

test('modo local de produção usa o build sem depender do Vite', () => {
  const target = rendererTarget({
    packaged: false,
    forceLocalBuild: true,
    appDirectory: __dirname,
    devServerUrl: 'http://127.0.0.1:5999',
  })
  assert.equal(target.kind, 'file')
  assert.equal(target.value, path.join(__dirname, 'dist', 'index.html'))
})

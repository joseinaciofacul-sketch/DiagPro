const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createAdbClient, locateAdb } = require('./adbClient')
const { ADB_ERROR_CODES, createAdbError } = require('./adbErrors')

function clientWith(handler) {
  return createAdbClient({ execFileImpl: handler, resolveExecutable: () => 'synthetic-adb' })
}

test('cliente ADB executa binário e argumentos separadamente', async () => {
  let captured
  const client = clientWith((executable, args, options, callback) => {
    captured = { executable, args, options }
    callback(null, 'Android Debug Bridge version 1.0.41\n', '')
  })
  const output = await client.run(['version'])
  assert.match(output, /1\.0\.41/)
  assert.equal(captured.executable, 'synthetic-adb')
  assert.deepEqual(captured.args, ['version'])
  assert.equal(captured.options.windowsHide, true)
  assert.equal(Object.hasOwn(captured.options, 'shell'), false)
})

test('ADB inexistente possui erro estruturado', async () => {
  const client = clientWith((_executable, _args, _options, callback) => {
    callback(Object.assign(new Error('not found'), { code: 'ENOENT' }), '', '')
  })
  await assert.rejects(client.run(['version']), (error) => error.code === ADB_ERROR_CODES.ADB_NOT_FOUND)
})

test('timeout possui erro estruturado', async () => {
  const client = clientWith((_executable, _args, _options, callback) => {
    callback(Object.assign(new Error('timed out'), { killed: true }), '', '')
  })
  await assert.rejects(client.run(['devices']), (error) => error.code === ADB_ERROR_CODES.ADB_TIMEOUT)
})

test('serial inválido é rejeitado antes de executar processo', async () => {
  let executed = false
  const client = clientWith(() => { executed = true })
  await assert.rejects(
    client.runDevice('serial; rm -rf', ['shell', 'getprop']),
    (error) => error.code === ADB_ERROR_CODES.INVALID_DEVICE,
  )
  assert.equal(executed, false)
})

test('unauthorized, offline e disconnect são estados distintos', async (t) => {
  const cases = [
    ['error: device unauthorized', ADB_ERROR_CODES.DEVICE_UNAUTHORIZED],
    ['error: device offline', ADB_ERROR_CODES.DEVICE_OFFLINE],
    ["error: device 'TEST-SERIAL' not found", ADB_ERROR_CODES.DEVICE_DISCONNECTED],
  ]
  for (const [stderr, expected] of cases) {
    await t.test(expected, async () => {
      const client = clientWith((_executable, _args, _options, callback) => callback(new Error('failed'), '', stderr))
      await assert.rejects(client.runDevice('TEST-SERIAL', ['shell', 'id']), (error) => error.code === expected)
    })
  }
})

test('comando não suportado é distinguido de falha genérica', async () => {
  const client = clientWith((_executable, _args, _options, callback) => {
    callback(new Error('failed'), '', 'Error: unknown command: query-op')
  })
  await assert.rejects(
    client.runDevice('TEST-SERIAL', ['shell', 'cmd', 'appops', 'query-op']),
    (error) => error.code === ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED,
  )
})

test('cancelamento interrompe comando ADB pendente', async () => {
  const controller = new AbortController()
  const client = clientWith((_executable, _args, options, callback) => {
    options.signal.addEventListener('abort', () => {
      callback(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }), '', '')
    }, { once: true })
  })
  const pending = client.runDevice('TEST-SERIAL', ['shell', 'dumpsys', 'package'], { signal: controller.signal })
  controller.abort(createAdbError(ADB_ERROR_CODES.SCAN_ABORTED))
  await assert.rejects(pending, (error) => error.code === ADB_ERROR_CODES.SCAN_ABORTED)
})

test('produção localiza primeiro o ADB distribuído nos recursos do aplicativo', () => {
  const resourcesPath = path.join('C:', 'Program Files', 'DiagPro', 'resources')
  const bundledAdb = path.join(resourcesPath, 'platform-tools', 'adb.exe')
  const located = locateAdb({}, (candidate) => candidate === bundledAdb, resourcesPath)
  assert.equal(located, bundledAdb)
})

test('caminho explícito do DiagPro prevalece sobre instalações detectadas', () => {
  const configured = path.join('D:', 'Ferramentas', 'adb.exe')
  const located = locateAdb(
    { DIAGPRO_ADB_PATH: configured, ANDROID_HOME: path.join('C:', 'Android') },
    () => true,
    path.join('C:', 'Program Files', 'DiagPro', 'resources'),
  )
  assert.equal(located, configured)
})

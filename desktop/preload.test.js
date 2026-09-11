const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

test('preload carrega no sandbox e delega a criação do scanId ao processo principal', async () => {
  const exposed = {}
  const calls = []
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => { exposed[name] = api },
    },
    ipcRenderer: {
      invoke: async (...args) => {
        calls.push(args)
        return args[0] === 'create-scan-id' ? '00000000-0000-4000-8000-000000000001' : null
      },
      on: () => {},
      removeListener: () => {},
    },
  }
  const sandboxRequire = (moduleName) => {
    if (moduleName === 'electron') return electron
    throw new Error(`module not available in sandbox: ${moduleName}`)
  }
  const source = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8')

  vm.runInNewContext(source, { require: sandboxRequire, TypeError })

  assert.equal(typeof exposed.diagpro?.getDeviceStatus, 'function')
  assert.equal(typeof exposed.diagpro?.createScanId, 'function')
  assert.equal(typeof exposed.diagpro?.startGoogleAuth, 'function')
  assert.equal(typeof exposed.diagpro?.cancelGoogleAuth, 'function')
  assert.equal(await exposed.diagpro.createScanId(), '00000000-0000-4000-8000-000000000001')
  const firstAppsRequest = exposed.diagpro.getInstalledApps({ serial: 'DEVICE-TEST' })
  const duplicateAppsRequest = exposed.diagpro.getInstalledApps({ serial: 'DEVICE-TEST' })
  assert.equal(firstAppsRequest, duplicateAppsRequest)
  await firstAppsRequest
  await exposed.diagpro.getInstalledApps({ serial: 'DEVICE-TEST' })
  await exposed.diagpro.startGoogleAuth({ apiBaseUrl: 'https://api.example.test' })
  await exposed.diagpro.cancelGoogleAuth()
  assert.deepEqual(calls.map(([channel, payload]) => [channel, payload?.serial || null]), [
    ['create-scan-id', null],
    ['get-installed-apps', 'DEVICE-TEST'],
    ['get-installed-apps', 'DEVICE-TEST'],
    ['google-auth-start', null],
    ['google-auth-cancel', null],
  ])
})

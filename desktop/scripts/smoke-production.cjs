// Harness local, excluído do pacote. Não usa credenciais nem inicia scans.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'diagpro-smoke-'))
app.setPath('userData', temporaryProfile)
process.argv.push('--local-build')
require('../main.js')

app.whenReady().then(async () => {
  let phase = 'renderer'
  try {
    let result
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || window.webContents.isLoading()) continue
      result = await window.webContents.executeJavaScript(`({
        protocol: location.protocol,
        login: document.body.innerText.includes('Bem-vindo ao'),
        logo: [...document.images].every(i => i.complete && i.naturalWidth > 0),
        preload: typeof window.diagpro?.getDeviceStatus === 'function',
        nodeExposed: typeof window.require !== 'undefined'
      })`)
      if (result.login) break
    }
    assert.equal(result.protocol, 'file:')
    assert.equal(result.login, true)
    assert.equal(result.logo, true)
    assert.equal(result.preload, true)
    assert.equal(result.nodeExposed, false)
    const window = BrowserWindow.getAllWindows()[0]
    phase = 'ipc'
    const connection = await window.webContents.executeJavaScript('window.diagpro.getDeviceStatus()')
    assert.equal(typeof connection.status, 'string')
    phase = 'devtools'
    window.webContents.openDevTools()
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(window.webContents.isDevToolsOpened(), false)
    console.log('PRODUCTION_SMOKE_PASS: build local, login, logo, preload e isolamento validados.')
    app.exit(0)
  } catch (error) {
    console.error('PRODUCTION_SMOKE_FAIL', phase, error.name)
    app.exit(1)
  }
})

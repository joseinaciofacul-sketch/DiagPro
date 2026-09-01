const test = require('node:test')
const assert = require('node:assert/strict')
const { createScanCoordinator } = require('./scanCoordinator')
const { ADB_ERROR_CODES } = require('./adbErrors')

test('dois scans simultâneos no mesmo dispositivo são bloqueados', () => {
  const coordinator = createScanCoordinator()
  assert.equal(coordinator.beginScan({ scanId: 'scan-one', serial: 'SERIAL-1', controller: new AbortController() }).ok, true)
  assert.deepEqual(
    coordinator.beginScan({ scanId: 'scan-two', serial: 'SERIAL-1', controller: new AbortController() }),
    { ok: false, code: 'DEVICE_BUSY' },
  )
})

test('scan impede operação de remoção concorrente', () => {
  const coordinator = createScanCoordinator()
  coordinator.beginScan({ scanId: 'scan-one', serial: 'SERIAL-1', controller: new AbortController() })
  assert.equal(coordinator.beginOperation('SERIAL-1', 'remediation', 'remediation-one'), false)
  coordinator.finishScan('scan-one')
  assert.equal(coordinator.beginOperation('SERIAL-1', 'remediation', 'remediation-one'), true)
})

test('cancelar scan propaga SCAN_ABORTED pelo AbortSignal', () => {
  const coordinator = createScanCoordinator()
  const controller = new AbortController()
  coordinator.beginScan({ scanId: 'scan-cancel', serial: 'SERIAL-1', controller })
  assert.equal(coordinator.cancelScan('scan-cancel'), true)
  assert.equal(controller.signal.aborted, true)
  assert.equal(controller.signal.reason.code, ADB_ERROR_CODES.SCAN_ABORTED)
})

test('desconexão aborta somente scan do dispositivo ausente', () => {
  const coordinator = createScanCoordinator()
  const first = new AbortController()
  const second = new AbortController()
  coordinator.beginScan({ scanId: 'scan-first', serial: 'SERIAL-1', controller: first })
  coordinator.beginScan({ scanId: 'scan-second', serial: 'SERIAL-2', controller: second })
  const aborted = coordinator.abortDisconnected({ devices: [{ serial: 'SERIAL-2', status: 'device' }] })
  assert.deepEqual(aborted, ['scan-first'])
  assert.equal(first.signal.reason.code, ADB_ERROR_CODES.DEVICE_DISCONNECTED)
  assert.equal(second.signal.aborted, false)
})

test('duas remediações simultâneas no mesmo dispositivo são bloqueadas', () => {
  const coordinator = createScanCoordinator()
  assert.equal(coordinator.beginOperation('SERIAL-1', 'remediation', 'action-one', {
    controller: new AbortController(), packageName: 'com.example.app',
  }), true)
  assert.equal(coordinator.beginOperation('SERIAL-1', 'remediation', 'action-two', {
    controller: new AbortController(), packageName: 'com.example.other',
  }), false)
})

test('cancelamento de remediação propaga motivo sem liberar lock antes do finally', () => {
  const coordinator = createScanCoordinator()
  const controller = new AbortController()
  coordinator.beginOperation('SERIAL-1', 'remediation', 'action-one', { controller })
  assert.equal(coordinator.cancelOperation('action-one'), true)
  assert.equal(controller.signal.reason.code, ADB_ERROR_CODES.OPERATION_CANCELED)
  assert.equal(coordinator.getOperation('SERIAL-1').id, 'action-one')
  coordinator.finishOperation('SERIAL-1', 'action-one')
  assert.equal(coordinator.getOperation('SERIAL-1'), null)
})

test('desconexão aborta remediação ativa além do scan', () => {
  const coordinator = createScanCoordinator()
  const controller = new AbortController()
  coordinator.beginOperation('SERIAL-1', 'remediation', 'action-one', { controller })
  const aborted = coordinator.abortDisconnected({ devices: [] })
  assert.deepEqual(aborted, ['action-one'])
  assert.equal(controller.signal.reason.code, ADB_ERROR_CODES.DEVICE_DISCONNECTED)
})

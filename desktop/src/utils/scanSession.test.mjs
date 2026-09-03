import assert from 'node:assert/strict'
import test from 'node:test'

import {
  reconcileScanSession,
  scanFailureState,
  sessionForConnectedDevice,
  updateMatchingScanSession,
} from './scanSession.mjs'

test('resultado atual só pertence ao mesmo dispositivo conectado', () => {
  const session = { serial: 'DEVICE-A', status: 'completed', result: { scanId: 'scan-a' } }
  assert.equal(sessionForConnectedDevice(session, { status: 'connected', serial: 'DEVICE-A' }), session)
  assert.equal(sessionForConnectedDevice(session, { status: 'connected', serial: 'DEVICE-B' }), null)
  assert.equal(sessionForConnectedDevice(session, { status: 'waiting' }), null)
})

test('disconnect limpa resultado concluído sem reaproveitar snapshot como atual', () => {
  const session = { serial: 'DEVICE-A', status: 'completed', result: { scanId: 'scan-a' } }
  assert.equal(reconcileScanSession(session, { status: 'waiting' }), null)
})

test('troca de aparelho interrompe scan ativo e remove resultado anterior', () => {
  const session = { serial: 'DEVICE-A', scanId: 'scan-a', status: 'running', result: { stale: true } }
  const reconciled = reconcileScanSession(session, { status: 'connected', serial: 'DEVICE-B' })
  assert.equal(reconciled.status, 'device_changed')
  assert.equal(reconciled.result, null)
})

test('cancelamento, desconexão e falha permanecem estados distintos', () => {
  assert.equal(scanFailureState({ code: 'SCAN_ABORTED' }).status, 'canceled')
  assert.equal(scanFailureState({ code: 'DEVICE_DISCONNECTED' }).status, 'device_disconnected')
  assert.equal(scanFailureState({ code: 'ADB_NOT_FOUND' }).status, 'failed')
})

test('evento atrasado não altera sessão de outro scan', () => {
  const current = { scanId: 'new-scan', status: 'running', progress: 10 }
  assert.equal(updateMatchingScanSession(current, 'old-scan', { progress: 100 }), current)
  assert.equal(updateMatchingScanSession(current, 'new-scan', { progress: 20 }).progress, 20)
})

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AppWindow,
  Battery,
  CheckCircle2,
  Clock3,
  HardDrive,
  Info,
  Loader2,
  MemoryStick,
  Package,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Usb,
  X,
} from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import './DevicesPage.css'

const EMPTY_VALUE = 'Não disponível'

function getDiagproApi() {
  if (typeof window === 'undefined') return null
  return window.diagpro || null
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function readableValue(value, fallback = EMPTY_VALUE) {
  return hasValue(value) ? String(value) : fallback
}

function hasNumericValue(value) {
  return hasValue(value) && Number.isFinite(Number(value))
}

function formatGb(value) {
  return hasNumericValue(value) ? `${Number(value)} GB` : null
}

function formatAppType(app) {
  const rawType = typeof app?.type === 'string' ? app.type.trim().toLowerCase() : ''

  if (rawType === 'user' || rawType === 'usuário' || rawType === 'usuario') {
    return { label: 'Usuário', kind: 'user', canUninstall: true }
  }

  if (rawType === 'system' || rawType === 'sistema') {
    return { label: 'Sistema', kind: 'system', canUninstall: false }
  }

  if (app?.isSystem === true) {
    return { label: 'Sistema', kind: 'system', canUninstall: false }
  }

  if (app?.isSystem === false || app?.isUser === true) {
    return { label: 'Usuário', kind: 'user', canUninstall: true }
  }

  return { label: 'Não informado', kind: 'unknown', canUninstall: false }
}

function normaliseApp(app, index) {
  const source = typeof app === 'object' && app !== null ? app : { packageName: app }
  const packageName = readableValue(
    source.packageName ?? source.package ?? source.nomePacote ?? source.id,
    '',
  )
  const name = readableValue(source.name ?? source.label ?? source.nome, packageName || 'Aplicativo sem nome')
  const type = formatAppType(source)
  const analysisStatus = readableValue(
    source.analysisStatus ?? source.status ?? source.riskStatus ?? source.classification,
    'Sem análise disponível',
  )

  return {
    key: packageName || `${name}-${index}`,
    name,
    packageName,
    type,
    analysisStatus,
  }
}

function extractApps(response) {
  if (Array.isArray(response)) return { ok: true, apps: response }

  if (!response || typeof response !== 'object') {
    return { ok: false, message: 'A lista de aplicativos retornou um formato inválido.' }
  }

  if (response.ok === false) {
    return {
      ok: false,
      message: response.message || response.mensagem || 'Não foi possível obter os aplicativos do dispositivo.',
    }
  }

  const apps = response.apps ?? response.installedApps ?? response.dados
  if (!Array.isArray(apps)) {
    return {
      ok: false,
      message: response.message || response.mensagem || 'A API não retornou uma lista de aplicativos.',
    }
  }

  return { ok: true, apps }
}

function resolveScanData(scanResult) {
  if (!scanResult || typeof scanResult !== 'object') return null
  return scanResult.dados ?? scanResult.data ?? scanResult
}

function getDeviceState(status) {
  switch (status) {
    case 'connected':
      return {
        title: 'Dispositivo conectado',
        detail: 'As informações abaixo foram obtidas da conexão ADB atual.',
        tone: 'success',
      }
    case 'unauthorized':
      return {
        title: 'Autorização necessária',
        detail: 'Desbloqueie o aparelho e aceite a solicitação de depuração USB.',
        tone: 'warning',
      }
    case 'offline':
      return {
        title: 'Dispositivo offline',
        detail: 'Reconecte o cabo USB e tente novamente.',
        tone: 'warning',
      }
    case 'multiple':
      return {
        title: 'Múltiplos dispositivos detectados',
        detail: 'Deixe apenas um aparelho conectado para consultar os aplicativos.',
        tone: 'warning',
      }
    case 'error':
      return {
        title: 'Erro de conexão',
        detail: 'Não foi possível consultar o dispositivo neste momento.',
        tone: 'danger',
      }
    default:
      return {
        title: 'Nenhum dispositivo conectado',
        detail: 'Conecte um Android via USB para ver os detalhes e os aplicativos instalados.',
        tone: 'muted',
      }
  }
}

function DeviceField({ label, value }) {
  return (
    <div className="dp-devices-field">
      <span>{label}</span>
      <strong>{readableValue(value)}</strong>
    </div>
  )
}

function DevicesPage({ scanResult = null, onStartDiagnostic, onOpenScanner }) {
  const dispositivo = useDeviceStatus()
  const [apps, setApps] = useState([])
  const [appsState, setAppsState] = useState({ status: 'idle', message: '' })
  const [reloadToken, setReloadToken] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [removalModal, setRemovalModal] = useState(null)
  const [previewingPackage, setPreviewingPackage] = useState('')
  const [removing, setRemoving] = useState(false)

  const isConnected = dispositivo?.status === 'connected' && Boolean(dispositivo?.serial)
  const serial = dispositivo?.serial || ''
  const deviceState = getDeviceState(dispositivo?.status)
  const scanData = useMemo(() => resolveScanData(scanResult), [scanResult])
  const normalisedApps = useMemo(() => apps.map(normaliseApp), [apps])

  useEffect(() => {
    let active = true

    async function loadApps() {
      if (!isConnected) {
        if (active) {
          setApps([])
          setAppsState({ status: 'idle', message: '' })
        }
        return
      }

      const api = getDiagproApi()
      if (!api || typeof api.getInstalledApps !== 'function') {
        if (active) {
          setApps([])
          setAppsState({
            status: 'unavailable',
            message: 'A listagem de aplicativos ainda não está disponível nesta versão do DiagPro.',
          })
        }
        return
      }

      setAppsState({ status: 'loading', message: '' })
      try {
        const response = await api.getInstalledApps({ serial })
        const result = extractApps(response)
        if (!active) return

        if (!result.ok) {
          setApps([])
          setAppsState({ status: 'error', message: result.message })
          return
        }

        setApps(result.apps)
        setAppsState({ status: 'ready', message: '' })
      } catch {
        if (active) {
          setApps([])
          setAppsState({
            status: 'error',
            message: 'Não foi possível acessar os aplicativos do dispositivo. Verifique a conexão ADB.',
          })
        }
      }
    }

    loadApps()

    return () => {
      active = false
    }
  }, [isConnected, reloadToken, serial])

  useEffect(() => {
    if (!isConnected) {
      setRemovalModal(null)
      setPreviewingPackage('')
      setRemoving(false)
    }
  }, [isConnected])

  const refreshApps = useCallback(() => {
    if (!isConnected) return
    setFeedback(null)
    setReloadToken((current) => current + 1)
  }, [isConnected])

  const openRemovalConfirmation = useCallback(async (app) => {
    if (!isConnected || !serial || !app?.packageName) return

    const api = getDiagproApi()
    if (!api || typeof api.uninstallUserApp !== 'function') {
      setFeedback({
        type: 'error',
        message: 'A remoção de aplicativos ainda não está disponível nesta versão do DiagPro.',
      })
      return
    }

    setFeedback(null)

    if (typeof api.getRemovalPreview !== 'function') {
      setRemovalModal({ app, token: null, preview: null, previewUnavailable: true })
      return
    }

    setPreviewingPackage(app.packageName)
    try {
      const preview = await api.getRemovalPreview({ serial, packageName: app.packageName })
      if (preview?.ok !== true) {
        setFeedback({
          type: 'error',
          message: preview?.message || preview?.mensagem || 'Não foi possível validar a remoção deste aplicativo.',
        })
        return
      }

      if (preview.removable === false || preview.canUninstall === false) {
        setFeedback({
          type: 'error',
          message: preview.message || preview.mensagem || 'Este aplicativo não pode ser removido automaticamente.',
        })
        return
      }

      setRemovalModal({
        app,
        token: preview.confirmationToken || preview.token || null,
        preview,
        previewUnavailable: false,
      })
    } catch {
      setFeedback({
        type: 'error',
        message: 'Não foi possível validar a remoção. Tente novamente com o dispositivo conectado.',
      })
    } finally {
      setPreviewingPackage('')
    }
  }, [isConnected, serial])

  const confirmRemoval = useCallback(async () => {
    if (!removalModal || !serial) return

    const api = getDiagproApi()
    if (!api || typeof api.uninstallUserApp !== 'function') return

    setRemoving(true)
    setFeedback(null)
    try {
      const args = {
        serial,
        packageName: removalModal.app.packageName,
      }
      if (removalModal.token) args.confirmationToken = removalModal.token

      const result = await api.uninstallUserApp(args)
      if (result?.ok === true) {
        setFeedback({
          type: 'success',
          message: result.message || result.mensagem || 'Aplicativo removido com sucesso.',
        })
        setRemovalModal(null)
        setReloadToken((current) => current + 1)
      } else {
        setFeedback({
          type: 'error',
          message: result?.message || result?.mensagem || 'Não foi possível remover o aplicativo.',
        })
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'A remoção falhou. Verifique a conexão ADB e tente novamente.',
      })
    } finally {
      setRemoving(false)
    }
  }, [removalModal, serial])

  const storage = scanData?.armazenamento
  const memory = scanData?.memoria
  const storageUsed = formatGb(storage?.usadoGb)
  const storageTotal = formatGb(storage?.totalGb)
  const storageFree = formatGb(storage?.livreGb)
  const memoryAvailable = formatGb(memory?.disponivelGb)
  const memoryTotal = formatGb(memory?.totalGb)
  const hasRecognisedScanData = Boolean(
    storageUsed || storageTotal || storageFree || memoryAvailable || memoryTotal || hasValue(scanData?.totalApps),
  )

  return (
    <div className="dp-devices-page">
      <div className="dp-devices-heading">
        <div>
          <h1>Dispositivos</h1>
          <p>Consulte o aparelho conectado agora e o histórico quando ele estiver disponível no sistema.</p>
        </div>
        {typeof onOpenScanner === 'function' && (
          <button className="dp-primary-btn" onClick={() => onOpenScanner(dispositivo)}>
            <AppWindow size={16} /> Abrir Scanner
          </button>
        )}
      </div>

      <section className="dp-card dp-devices-current-card" aria-labelledby="current-device-title">
        <div className="dp-devices-section-header">
          <div>
            <div className="dp-card-title" id="current-device-title">DISPOSITIVO CONECTADO AGORA</div>
            <div className={`dp-devices-connection-state ${deviceState.tone}`}>
              <span className="dp-devices-state-dot" aria-hidden="true" />
              {deviceState.title}
            </div>
          </div>
          {isConnected && typeof onStartDiagnostic === 'function' && (
            <button className="dp-devices-secondary-btn" onClick={() => onStartDiagnostic(dispositivo)}>
              Novo diagnóstico
            </button>
          )}
        </div>

        {isConnected ? (
          <div className="dp-devices-device-detail">
            <div className="dp-devices-device-icon"><Smartphone size={42} /></div>
            <div className="dp-devices-device-summary">
              <h2>{[dispositivo.fabricante, dispositivo.modelo].filter(Boolean).join(' ') || 'Dispositivo conectado'}</h2>
              <p>{deviceState.detail}</p>
              <div className="dp-devices-device-meta">
                <span><Usb size={14} /> USB / ADB</span>
                <span><Battery size={14} /> Bateria: {hasValue(dispositivo.bateria) ? `${dispositivo.bateria}%` : EMPTY_VALUE}</span>
              </div>
            </div>
            <div className="dp-devices-fields" aria-label="Dados técnicos do dispositivo">
              <DeviceField label="Serial" value={dispositivo.serial} />
              <DeviceField label="Fabricante" value={dispositivo.fabricante} />
              <DeviceField label="Modelo" value={dispositivo.modelo} />
              <DeviceField label="Android" value={dispositivo.versaoAndroid} />
              <DeviceField label="SDK Android" value={dispositivo.sdk} />
              <DeviceField label="Status ADB" value={dispositivo.adbStatus || 'device'} />
            </div>
          </div>
        ) : (
          <div className="dp-devices-empty dp-devices-device-empty">
            <Usb size={30} />
            <div>
              <strong>{deviceState.title}</strong>
              <p>{dispositivo?.mensagem || deviceState.detail}</p>
              {dispositivo?.serial && <small>Serial detectado: {dispositivo.serial}</small>}
            </div>
          </div>
        )}
      </section>

      <div className="dp-devices-columns">
        <section className="dp-card dp-devices-scan-card" aria-labelledby="current-scan-title">
          <div className="dp-devices-section-header">
            <div>
              <div className="dp-card-title" id="current-scan-title">ÚLTIMO RESULTADO RECEBIDO</div>
              <p className="dp-devices-section-description">Exibe somente o resultado de diagnóstico real entregue a esta tela.</p>
            </div>
          </div>

          {!scanData && (
            <div className="dp-devices-empty">
              <Clock3 size={28} />
              <div>
                <strong>Nenhum diagnóstico recebido</strong>
                <p>Execute um diagnóstico no Scanner para ver as métricas atuais aqui.</p>
              </div>
            </div>
          )}

          {scanData && hasRecognisedScanData && (
            <div className="dp-devices-scan-metrics">
              {(storageUsed || storageTotal || storageFree) && (
                <div className="dp-devices-metric">
                  <HardDrive size={21} />
                  <div>
                    <span>Armazenamento</span>
                    <strong>
                      {storageUsed && storageTotal
                        ? `${storageUsed} usados de ${storageTotal}`
                        : storageUsed || storageTotal}
                    </strong>
                    {storageFree && <small>{storageFree} livres</small>}
                  </div>
                </div>
              )}
              {(memoryAvailable || memoryTotal) && (
                <div className="dp-devices-metric">
                  <MemoryStick size={21} />
                  <div>
                    <span>Memória RAM</span>
                    <strong>
                      {memoryAvailable && memoryTotal
                        ? `${memoryAvailable} disponíveis de ${memoryTotal}`
                        : memoryAvailable || memoryTotal}
                    </strong>
                  </div>
                </div>
              )}
              {hasValue(scanData.totalApps) && (
                <div className="dp-devices-metric">
                  <Package size={21} />
                  <div>
                    <span>Aplicativos identificados</span>
                    <strong>{scanData.totalApps}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {scanData && !hasRecognisedScanData && (
            <div className="dp-devices-empty">
              <Info size={28} />
              <div>
                <strong>Resultado sem métricas compatíveis</strong>
                <p>O diagnóstico foi recebido, mas não contém armazenamento, memória ou total de aplicativos para exibição.</p>
              </div>
            </div>
          )}
        </section>

        <section className="dp-card dp-devices-history-card" aria-labelledby="history-title">
          <div className="dp-card-title" id="history-title">HISTÓRICO DE DISPOSITIVOS</div>
          <div className="dp-devices-empty">
            <Clock3 size={28} />
            <div>
              <strong>Nenhum histórico disponível</strong>
              <p>O histórico depende da persistência no backend, que ainda não está disponível nesta tela.</p>
            </div>
          </div>
        </section>
      </div>

      <section className="dp-card dp-devices-apps-card" aria-labelledby="installed-apps-title">
        <div className="dp-devices-section-header">
          <div>
            <div className="dp-card-title" id="installed-apps-title">APLICATIVOS DO DISPOSITIVO</div>
            <p className="dp-devices-section-description">
              {appsState.status === 'ready'
                ? `${normalisedApps.length} aplicativo${normalisedApps.length === 1 ? '' : 's'} retornado${normalisedApps.length === 1 ? '' : 's'} pelo dispositivo.`
                : 'A lista é obtida diretamente do dispositivo conectado.'}
            </p>
          </div>
          <button
            className="dp-devices-icon-action"
            onClick={refreshApps}
            disabled={!isConnected || appsState.status === 'loading'}
            title="Atualizar aplicativos"
            aria-label="Atualizar aplicativos"
          >
            <RefreshCw size={17} className={appsState.status === 'loading' ? 'spin' : ''} />
          </button>
        </div>

        {feedback && (
          <div className={`dp-devices-feedback ${feedback.type}`} role="status">
            {feedback.type === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            <span>{feedback.message}</span>
            <button onClick={() => setFeedback(null)} aria-label="Fechar mensagem"><X size={15} /></button>
          </div>
        )}

        {!isConnected && (
          <div className="dp-devices-empty">
            <Usb size={28} />
            <div>
              <strong>Aguardando dispositivo</strong>
              <p>Conecte e autorize um Android via USB para carregar os aplicativos instalados.</p>
            </div>
          </div>
        )}

        {isConnected && appsState.status === 'loading' && (
          <div className="dp-devices-apps-loading">
            <Loader2 size={22} className="spin" />
            <span>Carregando aplicativos do dispositivo...</span>
          </div>
        )}

        {isConnected && (appsState.status === 'error' || appsState.status === 'unavailable') && (
          <div className="dp-devices-inline-error">
            <ShieldAlert size={20} />
            <span>{appsState.message}</span>
          </div>
        )}

        {isConnected && appsState.status === 'ready' && normalisedApps.length === 0 && (
          <div className="dp-devices-empty">
            <Package size={28} />
            <div>
              <strong>Nenhum aplicativo retornado</strong>
              <p>O dispositivo não retornou aplicativos para esta consulta.</p>
            </div>
          </div>
        )}

        {isConnected && appsState.status === 'ready' && normalisedApps.length > 0 && (
          <div className="dp-devices-app-list" role="list">
            {normalisedApps.map((app) => (
              <article className="dp-devices-app-row" key={app.key} role="listitem">
                <div className="dp-devices-app-icon"><Package size={19} /></div>
                <div className="dp-devices-app-name">
                  <strong>{app.name}</strong>
                  <span>{app.packageName || 'Nome do pacote não informado'}</span>
                </div>
                <div className="dp-devices-app-detail">
                  <span>Tipo</span>
                  <strong className={`dp-devices-app-type ${app.type.kind}`}>{app.type.label}</strong>
                </div>
                <div className="dp-devices-app-detail dp-devices-analysis-state">
                  <span>Análise</span>
                  <strong>{app.analysisStatus}</strong>
                </div>
                {app.type.canUninstall && app.packageName ? (
                  <button
                    className="dp-devices-remove-btn"
                    onClick={() => openRemovalConfirmation(app)}
                    disabled={previewingPackage === app.packageName || removing}
                  >
                    {previewingPackage === app.packageName ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                    {previewingPackage === app.packageName ? 'Validando...' : 'Remover'}
                  </button>
                ) : (
                  <span className="dp-devices-app-no-action">Sem remoção automática</span>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {removalModal && (
        <div
          className="dp-devices-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !removing) setRemovalModal(null)
          }}
        >
          <section className="dp-devices-modal" role="dialog" aria-modal="true" aria-labelledby="remove-app-title">
            <div className="dp-devices-modal-header">
              <div className="dp-devices-modal-icon"><AlertTriangle size={21} /></div>
              <div>
                <h2 id="remove-app-title">Confirmar remoção</h2>
                <p>Esta ação solicitará a desinstalação real pelo ADB.</p>
              </div>
              <button onClick={() => setRemovalModal(null)} disabled={removing} aria-label="Fechar confirmação">
                <X size={19} />
              </button>
            </div>

            <div className="dp-devices-modal-app">
              <strong>{removalModal.app.name}</strong>
              <span>{removalModal.app.packageName}</span>
            </div>

            <div className="dp-devices-modal-details">
              <div><span>Tipo</span><strong>{removalModal.app.type.label}</strong></div>
              {removalModal.preview?.reason && <div><span>Motivo</span><strong>{removalModal.preview.reason}</strong></div>}
              {removalModal.preview?.motivo && !removalModal.preview?.reason && <div><span>Motivo</span><strong>{removalModal.preview.motivo}</strong></div>}
              {removalModal.preview?.impact && <div><span>Impacto</span><strong>{removalModal.preview.impact}</strong></div>}
            </div>

            {removalModal.previewUnavailable && (
              <p className="dp-devices-modal-note">
                A validação prévia não está disponível. A remoção só será solicitada após sua confirmação.
              </p>
            )}

            <p className="dp-devices-modal-warning">
              O aplicativo poderá deixar de funcionar para o usuário atual do dispositivo. Componentes de sistema não são removidos por esta tela.
            </p>

            <div className="dp-devices-modal-actions">
              <button className="dp-devices-secondary-btn" onClick={() => setRemovalModal(null)} disabled={removing}>
                Cancelar
              </button>
              <button className="dp-devices-danger-btn" onClick={confirmRemoval} disabled={removing}>
                {removing ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                {removing ? 'Removendo...' : 'Confirmar remoção'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default DevicesPage

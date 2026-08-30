import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AppWindow,
  Battery,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  HardDrive,
  Info,
  Loader2,
  MemoryStick,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Trash2,
  Usb,
  X,
} from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import { listarDiagnosticos } from '../services/diagnostics.js'
import './DevicesPage.css'

const EMPTY_VALUE = 'Não disponível'
const MODE_LABELS = { quick: 'Rápida', complete: 'Completa', custom: 'Personalizada' }
const REMEDIATION_STATUS = { resolved: 'Resolvido', failed: 'Falha', not_verified: 'Não verificado' }

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
  const name = hasValue(source.name ?? source.label ?? source.nome)
    ? String(source.name ?? source.label ?? source.nome)
    : null
  const type = formatAppType(source)
  const rawAnalysisStatus = source.statusLabel
    ?? source.analysisStatus
    ?? source.status
    ?? source.riskStatus
    ?? source.classification
  const analysisStatus = rawAnalysisStatus === 'not_analyzed'
    ? 'Não analisado'
    : readableValue(rawAnalysisStatus, 'Não analisado')

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

  const payload = response.data ?? response.dados ?? response
  const apps = Array.isArray(payload)
    ? payload
    : payload.items ?? payload.apps ?? payload.installedApps
  if (!Array.isArray(apps)) {
    return {
      ok: false,
      message: response.message || response.mensagem || 'A API não retornou uma lista de aplicativos.',
    }
  }

  return { ok: true, apps }
}

function getAppsErrorMessage(response) {
  const code = response?.code
  if (code === 'DEVICE_UNAUTHORIZED') return 'Autorize a depuração USB no dispositivo para listar os aplicativos.'
  if (code === 'DEVICE_NOT_FOUND') return 'O dispositivo foi desconectado durante a consulta.'
  if (code === 'DEVICE_NOT_READY') return 'O dispositivo não está pronto para listar aplicativos.'
  if (code === 'ADB_NOT_FOUND') return 'O ADB não está disponível. Verifique a instalação e tente novamente.'
  return response?.message || response?.mensagem || 'Não foi possível obter os aplicativos do dispositivo.'
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

function normalizeDiagnosticList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('A API retornou um formato de diagnósticos inválido.')
}

function diagnosticTimestamp(diagnostic) {
  const value = diagnostic?.finalizado_em ? new Date(diagnostic.finalizado_em).getTime() : Number.NaN
  return Number.isNaN(value) ? -Infinity : value
}

function groupHistoricalDevices(diagnostics) {
  const groups = new Map()
  diagnostics.forEach((diagnostic) => {
    const serial = typeof diagnostic?.serial === 'string' ? diagnostic.serial.trim() : ''
    const key = serial ? `serial:${serial}` : `diagnostic:${diagnostic.id}`
    if (!groups.has(key)) groups.set(key, { key, serial: serial || null, diagnostics: [] })
    groups.get(key).diagnostics.push(diagnostic)
  })
  return [...groups.values()].map((group) => {
    const entries = group.diagnostics.slice().sort((a, b) => diagnosticTimestamp(b) - diagnosticTimestamp(a))
    return { ...group, diagnostics: entries, latest: entries[0] }
  }).sort((a, b) => diagnosticTimestamp(b.latest) - diagnosticTimestamp(a.latest))
}

function technicalItems(diagnostic, field) {
  const technicalResult = diagnostic?.resultado_tecnico
  const items = field === 'findings' ? technicalResult?.security?.findings : technicalResult?.remediations
  return Array.isArray(items) ? items : null
}

function formatDiagnosticDate(value) {
  if (!value) return EMPTY_VALUE
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? EMPTY_VALUE : date.toLocaleString('pt-BR')
}

function DevicesPage({ accessToken, scanResult = null, onStartDiagnostic, onOpenScanner, onOpenReport }) {
  const dispositivo = useDeviceStatus()
  const [apps, setApps] = useState([])
  const [appsState, setAppsState] = useState({ status: 'idle', message: '' })
  const [reloadToken, setReloadToken] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [removalModal, setRemovalModal] = useState(null)
  const [detailApp, setDetailApp] = useState(null)
  const [appSearch, setAppSearch] = useState('')
  const [appFilter, setAppFilter] = useState('all')
  const [previewingPackage, setPreviewingPackage] = useState('')
  const [removing, setRemoving] = useState(false)
  const [historicalDiagnostics, setHistoricalDiagnostics] = useState([])
  const [historyState, setHistoryState] = useState({ status: 'loading', message: '' })
  const [selectedHistoricalDevice, setSelectedHistoricalDevice] = useState(null)

  const isConnected = dispositivo?.status === 'connected' && Boolean(dispositivo?.serial)
  const serial = dispositivo?.serial || ''
  const deviceState = getDeviceState(dispositivo?.status)
  const scanData = useMemo(() => resolveScanData(scanResult), [scanResult])
  const normalisedApps = useMemo(() => apps.map(normaliseApp), [apps])
  const filteredApps = useMemo(() => {
    const query = appSearch.trim().toLowerCase()
    return normalisedApps.filter((app) => {
      const matchesPackage = !query || app.packageName.toLowerCase().includes(query)
      const matchesType = appFilter === 'all' || app.type.kind === appFilter
      return matchesPackage && matchesType
    })
  }, [appFilter, appSearch, normalisedApps])
  const userApps = useMemo(() => filteredApps.filter((app) => app.type.kind === 'user'), [filteredApps])
  const systemApps = useMemo(() => filteredApps.filter((app) => app.type.kind === 'system'), [filteredApps])
  const unknownApps = useMemo(() => filteredApps.filter((app) => app.type.kind === 'unknown'), [filteredApps])
  const userTotal = useMemo(() => normalisedApps.filter((app) => app.type.kind === 'user').length, [normalisedApps])
  const systemTotal = useMemo(() => normalisedApps.filter((app) => app.type.kind === 'system').length, [normalisedApps])
  const historicalDevices = useMemo(() => groupHistoricalDevices(historicalDiagnostics), [historicalDiagnostics])

  const loadHistoricalDiagnostics = useCallback(async () => {
    setHistoryState({ status: 'loading', message: '' })
    try {
      const data = normalizeDiagnosticList(await listarDiagnosticos({ accessToken }))
      setHistoricalDiagnostics(data)
      setHistoryState({ status: 'ready', message: '' })
    } catch (error) {
      setHistoricalDiagnostics([])
      setHistoryState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar o histórico.'
          : 'Não foi possível carregar os dispositivos já diagnosticados.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadHistoricalDiagnostics() }, [loadHistoricalDiagnostics])

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
          setAppsState({ status: 'error', message: getAppsErrorMessage(response) })
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
      setDetailApp(null)
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
    if (!isConnected || !serial || !app?.packageName || app.type?.kind !== 'user') {
      setFeedback({ type: 'error', message: 'Somente aplicativos de usuário podem ser removidos.' })
      return
    }

    const api = getDiagproApi()
    if (
      !api
      || typeof api.getRemovalPreview !== 'function'
      || typeof api.uninstallUserApp !== 'function'
    ) {
      setFeedback({
        type: 'error',
        message: 'O fluxo seguro de remoção não está disponível nesta versão do DiagPro.',
      })
      return
    }

    setFeedback(null)

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

      const confirmationToken = preview.confirmationToken
      const previewType = preview.app?.type
      if (
        preview.removable !== true
        || !confirmationToken
        || (previewType && previewType !== 'user')
      ) {
        setFeedback({
          type: 'error',
          message: preview.message || preview.mensagem || 'A validação segura não autorizou a remoção deste aplicativo.',
        })
        return
      }

      setRemovalModal({
        app,
        token: confirmationToken,
        preview,
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
    if (
      !removalModal
      || !serial
      || !removalModal.token
      || removalModal.app?.type?.kind !== 'user'
    ) return

    const api = getDiagproApi()
    if (!api || typeof api.uninstallUserApp !== 'function') return

    setRemoving(true)
    setFeedback(null)
    try {
      const args = {
        serial,
        packageName: removalModal.app.packageName,
        confirmationToken: removalModal.token,
      }

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
  const selectedLatestDiagnostic = selectedHistoricalDevice?.latest || null
  const selectedLatestFindings = technicalItems(selectedLatestDiagnostic, 'findings')
  const selectedLatestRemediations = technicalItems(selectedLatestDiagnostic, 'remediations')

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
          <div className="dp-devices-section-header"><div><div className="dp-card-title" id="history-title">DISPOSITIVOS JÁ DIAGNOSTICADOS</div><p className="dp-devices-section-description">Registros históricos; não representam conexão atual.</p></div><button className="dp-devices-icon-action" type="button" onClick={loadHistoricalDiagnostics} disabled={historyState.status === 'loading'} aria-label="Atualizar histórico"><RefreshCw size={16} className={historyState.status === 'loading' ? 'spin' : ''} /></button></div>
          {historyState.status === 'loading' && <div className="dp-devices-history-state"><Loader2 size={20} className="spin" /> Carregando histórico...</div>}
          {(historyState.status === 'error' || historyState.status === 'auth-error') && <div className="dp-devices-history-state error"><AlertTriangle size={19} /><span>{historyState.message}</span><button type="button" onClick={loadHistoricalDiagnostics}>Tentar novamente</button></div>}
          {historyState.status === 'ready' && historicalDevices.length === 0 && <div className="dp-devices-empty"><Clock3 size={28} /><div><strong>Nenhum dispositivo histórico</strong><p>Nenhum diagnóstico persistido possui identificação de dispositivo para exibição.</p></div></div>}
          {historyState.status === 'ready' && historicalDevices.length > 0 && <div className="dp-devices-history-list">{historicalDevices.map((device) => <button type="button" key={device.key} onClick={() => setSelectedHistoricalDevice(device)}><Smartphone size={18} /><div><strong>{[device.latest?.fabricante, device.latest?.modelo].filter(Boolean).join(' ') || 'Identificação não disponível'}</strong>{device.serial ? <code>{device.serial}</code> : <span>Sem serial registrado</span>}{device.latest?.versao_android && <small>Android {device.latest.versao_android}</small>}{device.latest?.cliente?.nome && <small>Cliente: {device.latest.cliente.nome}</small>}<small>Histórico · {device.diagnostics.length} diagnóstico{device.diagnostics.length === 1 ? '' : 's'} · último em {formatDiagnosticDate(device.latest?.finalizado_em)}</small></div><ChevronRight size={16} /></button>)}</div>}
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
            {dispositivo?.status === 'unauthorized' || dispositivo?.status === 'error'
              ? <AlertTriangle size={28} />
              : <Usb size={28} />}
            <div>
              <strong>{deviceState.title}</strong>
              <p>{dispositivo?.message || dispositivo?.mensagem || deviceState.detail}</p>
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
          <>
            <div className="dp-devices-app-toolbar">
              <label className="dp-devices-app-search">
                <Search size={16} />
                <input
                  value={appSearch}
                  onChange={(event) => setAppSearch(event.target.value)}
                  placeholder="Buscar por packageName"
                  aria-label="Buscar aplicativo por packageName"
                />
              </label>
              <div className="dp-devices-app-filters" aria-label="Filtrar aplicativos por tipo">
                <button className={appFilter === 'all' ? 'active' : ''} onClick={() => setAppFilter('all')}>Todos {normalisedApps.length}</button>
                <button className={appFilter === 'user' ? 'active' : ''} onClick={() => setAppFilter('user')}>Usuário {userTotal}</button>
                <button className={appFilter === 'system' ? 'active' : ''} onClick={() => setAppFilter('system')}>Sistema {systemTotal}</button>
              </div>
            </div>

            {filteredApps.length === 0 ? (
              <div className="dp-devices-empty dp-devices-filter-empty">
                <Search size={28} />
                <div>
                  <strong>Nenhum packageName encontrado</strong>
                  <p>Ajuste a busca ou selecione outro tipo de aplicativo.</p>
                </div>
              </div>
            ) : (
              <div className="dp-devices-app-groups">
                {[
                  { key: 'user', title: 'Aplicativos do usuário', items: userApps },
                  { key: 'system', title: 'Aplicativos do sistema', items: systemApps },
                  { key: 'unknown', title: 'Tipo não informado', items: unknownApps },
                ].filter((group) => group.items.length > 0).map((group) => (
                  <section className="dp-devices-app-group" key={group.key}>
                    <div className="dp-devices-app-group-title">
                      <span>{group.title}</span>
                      <strong>{group.items.length}</strong>
                    </div>
                    <div className="dp-devices-app-list" role="list">
                      {group.items.map((app) => (
                        <article className="dp-devices-app-row" key={app.key} role="listitem">
                          <div className="dp-devices-app-icon"><Package size={19} /></div>
                          <div className="dp-devices-app-name">
                            {app.name && <strong>{app.name}</strong>}
                            <span className={!app.name ? 'package-primary' : ''}>{app.packageName || 'packageName não informado'}</span>
                          </div>
                          <div className="dp-devices-app-detail">
                            <span>Tipo</span>
                            <strong className={`dp-devices-app-type ${app.type.kind}`}>{app.type.label}</strong>
                          </div>
                          <div className="dp-devices-app-detail dp-devices-analysis-state">
                            <span>Análise</span>
                            <strong>{app.analysisStatus}</strong>
                          </div>
                          <div className="dp-devices-app-actions">
                            <button className="dp-devices-detail-btn" onClick={() => setDetailApp(app)}>Detalhes</button>
                            {app.type.kind === 'user' && app.packageName ? (
                              <button
                                className="dp-devices-remove-btn"
                                onClick={() => openRemovalConfirmation(app)}
                                disabled={previewingPackage === app.packageName || removing}
                              >
                                {previewingPackage === app.packageName ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                                {previewingPackage === app.packageName ? 'Validando...' : 'Remover'}
                              </button>
                            ) : (
                              <span className="dp-devices-app-no-action">Protegido</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {selectedHistoricalDevice && selectedLatestDiagnostic && (
        <div className="dp-devices-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedHistoricalDevice(null) }}>
          <section className="dp-devices-history-modal" role="dialog" aria-modal="true" aria-labelledby="historical-device-title">
            <header className="dp-devices-modal-header"><div className="dp-devices-detail-modal-icon"><Smartphone size={20} /></div><div><h2 id="historical-device-title">{[selectedLatestDiagnostic.fabricante, selectedLatestDiagnostic.modelo].filter(Boolean).join(' ') || 'Dispositivo histórico'}</h2><p>Registro de diagnósticos persistidos — não indica conexão atual.</p></div><button type="button" onClick={() => setSelectedHistoricalDevice(null)} aria-label="Fechar"><X size={18} /></button></header>
            <div className="dp-devices-history-modal-content">
              <section><div className="dp-card-title">IDENTIFICAÇÃO CONHECIDA</div><div className="dp-devices-history-fields">{selectedHistoricalDevice.serial && <DeviceField label="Serial" value={selectedHistoricalDevice.serial} />}{selectedLatestDiagnostic.fabricante && <DeviceField label="Fabricante" value={selectedLatestDiagnostic.fabricante} />}{selectedLatestDiagnostic.modelo && <DeviceField label="Modelo" value={selectedLatestDiagnostic.modelo} />}{selectedLatestDiagnostic.versao_android && <DeviceField label="Android" value={selectedLatestDiagnostic.versao_android} />}{selectedLatestDiagnostic.sdk != null && <DeviceField label="SDK" value={selectedLatestDiagnostic.sdk} />}{selectedLatestDiagnostic.security_patch && <DeviceField label="Security patch" value={selectedLatestDiagnostic.security_patch} />}</div></section>
              <section><div className="dp-card-title">ÚLTIMO DIAGNÓSTICO</div><div className="dp-devices-history-summary"><div><span>Diagnóstico</span><strong>#{selectedLatestDiagnostic.id}</strong></div><div><span>Data</span><strong>{formatDiagnosticDate(selectedLatestDiagnostic.finalizado_em)}</strong></div><div><span>Cliente</span><strong>{selectedLatestDiagnostic.cliente?.nome || 'Não associado'}</strong></div><div><span>Modo</span><strong>{MODE_LABELS[selectedLatestDiagnostic.modo] || readableValue(selectedLatestDiagnostic.modo)}</strong></div><div><span>Findings</span><strong>{selectedLatestFindings ? selectedLatestFindings.length : EMPTY_VALUE}</strong></div><div><span>Correções</span><strong>{selectedLatestRemediations ? selectedLatestRemediations.length : EMPTY_VALUE}</strong></div></div></section>
              <section><div className="dp-card-title">HISTÓRICO DE DIAGNÓSTICOS</div><div className="dp-devices-diagnostic-history">{selectedHistoricalDevice.diagnostics.map((diagnostic) => <article key={diagnostic.id}><Clock3 size={15} /><div><strong>Diagnóstico #{diagnostic.id}</strong><span>{formatDiagnosticDate(diagnostic.finalizado_em)} · {MODE_LABELS[diagnostic.modo] || readableValue(diagnostic.modo)}</span>{diagnostic.cliente?.nome && <small>Cliente: {diagnostic.cliente.nome}</small>}</div><button type="button" onClick={() => onOpenReport?.(diagnostic.id)}><FileText size={13} /> Ver relatório</button></article>)}</div></section>
              <section><div className="dp-card-title">FINDINGS DO ÚLTIMO DIAGNÓSTICO</div>{selectedLatestFindings === null ? <p className="dp-devices-history-empty">Dados de findings não disponíveis neste diagnóstico.</p> : selectedLatestFindings.length > 0 ? <div className="dp-devices-technical-list">{selectedLatestFindings.map((finding, index) => <div key={`${finding?.id || 'finding'}-${index}`}><ShieldAlert size={14} /><span><strong>{finding?.title || 'Finding sem título registrado'}</strong>{finding?.packageName && <code>{finding.packageName}</code>}</span>{finding?.severity && <small>{finding.severity}</small>}</div>)}</div> : <p className="dp-devices-history-empty">Nenhum finding registrado no último diagnóstico.</p>}</section>
              <section><div className="dp-card-title">CORREÇÕES DO ÚLTIMO DIAGNÓSTICO</div>{selectedLatestRemediations === null ? <p className="dp-devices-history-empty">Dados de correções não disponíveis neste diagnóstico.</p> : selectedLatestRemediations.length > 0 ? <div className="dp-devices-technical-list">{selectedLatestRemediations.map((remediation, index) => <div key={remediation?.executionId || `${remediation?.findingId || 'remediation'}-${index}`}><CheckCircle2 size={14} /><span><strong>{remediation?.action || 'Ação sem identificação registrada'}</strong>{remediation?.packageName && <code>{remediation.packageName}</code>}</span><small>{REMEDIATION_STATUS[remediation?.status] || readableValue(remediation?.status)}</small></div>)}</div> : <p className="dp-devices-history-empty">Nenhuma correção registrada no último diagnóstico.</p>}</section>
            </div>
            <footer className="dp-devices-history-modal-actions"><button className="dp-devices-secondary-btn" type="button" onClick={() => { setSelectedHistoricalDevice(null); onOpenScanner?.() }}><AppWindow size={14} /> Iniciar novo diagnóstico</button><button className="dp-primary-btn" type="button" onClick={() => onOpenReport?.(selectedLatestDiagnostic.id)}><FileText size={14} /> Ver relatório</button></footer>
          </section>
        </div>
      )}

      {detailApp && (
        <div className="dp-devices-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDetailApp(null)
        }}>
          <section className="dp-devices-modal" role="dialog" aria-modal="true" aria-labelledby="app-detail-title">
            <div className="dp-devices-modal-header">
              <div className="dp-devices-detail-modal-icon"><Package size={21} /></div>
              <div>
                <h2 id="app-detail-title">Detalhes do aplicativo</h2>
                <p>Informações retornadas pela consulta ADB.</p>
              </div>
              <button onClick={() => setDetailApp(null)} aria-label="Fechar detalhes"><X size={19} /></button>
            </div>
            <div className="dp-devices-modal-details dp-devices-basic-details">
              <div><span>Nome</span><strong>{detailApp.name || 'Não informado pelo dispositivo'}</strong></div>
              <div><span>packageName</span><strong>{detailApp.packageName || 'Não informado'}</strong></div>
              <div><span>Tipo</span><strong>{detailApp.type.label}</strong></div>
              <div><span>Análise</span><strong>{detailApp.analysisStatus}</strong></div>
              <div><span>Remoção</span><strong>{detailApp.type.kind === 'user' ? 'Disponível com confirmação' : 'Não permitida'}</strong></div>
            </div>
            <div className="dp-devices-modal-actions">
              <button className="dp-devices-secondary-btn" onClick={() => setDetailApp(null)}>Fechar</button>
            </div>
          </section>
        </div>
      )}

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

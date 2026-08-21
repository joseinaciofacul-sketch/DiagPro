import { useMemo, useState } from 'react'
import { Download, FileText, Info, Plus, ScanLine, X } from 'lucide-react'
import './ReportsPage.css'

const reportFilters = [
  { id: 'todos', label: 'Todos' },
  { id: 'diagnostico', label: 'Diagnósticos' },
  { id: 'seguranca', label: 'Segurança' },
]

function getReportType(report) {
  return String(report?.type ?? report?.tipo ?? report?.category ?? '').toLocaleLowerCase('pt-BR')
}

function getReportTitle(report) {
  return report?.title || report?.titulo || report?.name || report?.nome || 'Relatório sem título'
}

function getReportDate(report) {
  return report?.createdAt || report?.created_at || report?.dataCriacao || report?.date || ''
}

function getReportStatus(report) {
  return report?.status || report?.estado || ''
}

function getScanFields(lastScan) {
  if (!lastScan || typeof lastScan !== 'object') return []

  return [
    { label: 'Aplicativos', value: lastScan.totalApps },
    { label: 'Armazenamento usado', value: lastScan?.armazenamento?.usadoGb != null ? `${lastScan.armazenamento.usadoGb} GB` : null },
    { label: 'Memória disponível', value: lastScan?.memoria?.disponivelGb != null ? `${lastScan.memoria.disponivelGb} GB` : null },
  ].filter((field) => field.value !== null && field.value !== undefined && field.value !== '')
}

function ReportsPage({ reports, lastScan, username, onNavigate, onGenerateReport, onOpenReport }) {
  const [activeFilter, setActiveFilter] = useState('todos')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [reportName, setReportName] = useState('')
  const [reportType, setReportType] = useState('diagnostico')
  const [modalMessage, setModalMessage] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const reportList = Array.isArray(reports) ? reports : []
  const filteredReports = useMemo(() => reportList.filter((report) => {
    if (activeFilter === 'todos') return true
    return getReportType(report).includes(activeFilter)
  }), [activeFilter, reportList])
  const scanFields = getScanFields(lastScan)

  function openModal() {
    setModalMessage('')
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setModalMessage('')
  }

  async function handleGenerate(event) {
    event.preventDefault()

    if (!lastScan) {
      setModalMessage('Ainda não há uma coleta local para compor o relatório. Execute o scanner primeiro.')
      return
    }

    if (typeof onGenerateReport !== 'function') {
      setModalMessage('A geração não está disponível sem o backend Django ou uma integração de relatórios configurada.')
      return
    }

    setIsGenerating(true)
    setModalMessage('')
    try {
      await onGenerateReport({ title: reportName.trim(), type: reportType, scan: lastScan })
      setReportName('')
      closeModal()
    } catch {
      setModalMessage('Não foi possível solicitar o relatório. Verifique a integração do serviço.')
    } finally {
      setIsGenerating(false)
    }
  }

  function handleOpen(report) {
    if (typeof onOpenReport === 'function') {
      onOpenReport(report)
      return
    }
    setModalMessage('A visualização de arquivos depende de um serviço de relatórios conectado.')
    setIsModalOpen(true)
  }

  return (
    <section className="dp-reports-page" aria-labelledby="dp-reports-title">
      <div className="dp-reports-header">
        <div>
          <h1 id="dp-reports-title">Relatórios</h1>
          <p>{username ? `Relatórios associados à operação de ${username}.` : 'Gere e consulte documentos baseados em coletas reais.'}</p>
        </div>
        <button className="dp-reports-primary-action" type="button" onClick={openModal}>
          <Plus size={17} /> Gerar relatório
        </button>
      </div>

      <div className="dp-reports-service-note">
        <Info size={18} />
        <div>
          <strong>Serviço de relatórios indisponível.</strong>
          <span>Sem a API Django, a aplicação não pode armazenar, assinar, exportar ou recuperar relatórios.</span>
        </div>
      </div>

      {lastScan && (
        <div className="dp-reports-scan-card">
          <div className="dp-reports-scan-icon"><ScanLine size={20} /></div>
          <div>
            <strong>Dados da última coleta disponíveis nesta sessão</strong>
            {scanFields.length > 0 && (
              <div className="dp-reports-scan-fields">
                {scanFields.map((field) => <span key={field.label}>{field.label}: <b>{field.value}</b></span>)}
              </div>
            )}
          </div>
          <button className="dp-reports-secondary-action" type="button" onClick={openModal}>Usar na geração</button>
        </div>
      )}

      <div className="dp-reports-filter-row" aria-label="Filtrar relatórios">
        {reportFilters.map((filter) => (
          <button
            className={`dp-reports-filter ${activeFilter === filter.id ? 'dp-reports-filter-active' : ''}`}
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="dp-reports-card">
        <div className="dp-reports-card-heading">
          <div>
            <h2>Documentos disponíveis</h2>
            <p>{filteredReports.length} documento{filteredReports.length === 1 ? '' : 's'} exibido{filteredReports.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        {filteredReports.length > 0 ? (
          <ul className="dp-reports-list">
            {filteredReports.map((report, index) => {
              const title = getReportTitle(report)
              const type = getReportType(report)
              const date = getReportDate(report)
              const status = getReportStatus(report)

              return (
                <li className="dp-reports-item" key={report?.id || report?.uuid || `${title}-${index}`}>
                  <div className="dp-reports-file-icon"><FileText size={20} /></div>
                  <div className="dp-reports-item-main">
                    <strong>{title}</strong>
                    {(type || date || status) && <span>{[type, date, status].filter(Boolean).join(' · ')}</span>}
                  </div>
                  <button className="dp-reports-download-action" type="button" onClick={() => handleOpen(report)}>
                    <Download size={16} /> Abrir
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="dp-reports-empty-state">
            <FileText size={36} aria-hidden="true" />
            <h2>{reportList.length ? 'Nenhum relatório corresponde ao filtro' : 'Nenhum relatório disponível'}</h2>
            <p>
              {reportList.length
                ? 'Escolha outro filtro para visualizar os documentos recebidos.'
                : 'Quando o serviço estiver integrado, os documentos gerados a partir das coletas reais aparecerão aqui.'}
            </p>
            <div className="dp-reports-empty-actions">
              <button className="dp-reports-primary-action" type="button" onClick={openModal}><Plus size={16} /> Gerar relatório</button>
              <button className="dp-reports-secondary-action" type="button" onClick={() => onNavigate?.('Scanner')}><ScanLine size={16} /> Ir para scanner</button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="dp-reports-modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <form className="dp-reports-modal" aria-labelledby="dp-reports-modal-title" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleGenerate}>
            <button className="dp-reports-modal-close" type="button" aria-label="Fechar" onClick={closeModal}><X size={18} /></button>
            <h2 id="dp-reports-modal-title">Gerar relatório</h2>
            <p>O documento será solicitado a uma integração externa; ele não é fabricado nem salvo localmente por esta tela.</p>
            <label className="dp-reports-field">
              <span>Título do relatório</span>
              <input value={reportName} onChange={(event) => setReportName(event.target.value)} placeholder="Opcional" autoFocus />
            </label>
            <label className="dp-reports-field">
              <span>Tipo</span>
              <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
                <option value="diagnostico">Diagnóstico</option>
                <option value="seguranca">Segurança</option>
              </select>
            </label>
            {modalMessage && <p className="dp-reports-form-message" role="alert">{modalMessage}</p>}
            <div className="dp-reports-modal-actions">
              <button className="dp-reports-secondary-action" type="button" onClick={closeModal}>Cancelar</button>
              <button className="dp-reports-primary-action" type="submit" disabled={isGenerating}>{isGenerating ? 'Solicitando...' : 'Solicitar geração'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

export default ReportsPage

import { useMemo, useState } from 'react'
import { Filter, Info, ScanLine, Search, ShieldAlert, X } from 'lucide-react'
import './ThreatsPage.css'

const filters = [
  { id: 'todas', label: 'Todas' },
  { id: 'alto', label: 'Risco alto' },
  { id: 'medio', label: 'Risco médio' },
  { id: 'baixo', label: 'Risco baixo' },
]

function getThreatLevel(threat) {
  const value = String(
    threat?.level ?? threat?.riskLevel ?? threat?.risco ?? threat?.severity ?? '',
  ).toLowerCase()

  if (value.includes('alto') || value.includes('high') || value.includes('critical') || value.includes('crítico')) return 'alto'
  if (value.includes('médio') || value.includes('medio') || value.includes('medium')) return 'medio'
  if (value.includes('baixo') || value.includes('low')) return 'baixo'
  return 'desconhecido'
}

function getThreatName(threat) {
  return threat?.name || threat?.nome || threat?.title || threat?.titulo || 'Ameaça sem identificação'
}

function getThreatSource(threat) {
  return threat?.packageName || threat?.package || threat?.origem || threat?.source || ''
}

function getThreatDate(threat) {
  return threat?.detectedAt || threat?.detected_at || threat?.dataDeteccao || threat?.date || ''
}

function ThreatsPage({ threats, lastScan, onNavigate }) {
  const [activeFilter, setActiveFilter] = useState('todas')
  const [query, setQuery] = useState('')
  const [selectedThreat, setSelectedThreat] = useState(null)

  const collectedThreats = useMemo(() => {
    if (Array.isArray(threats)) return threats
    if (Array.isArray(lastScan?.threats)) return lastScan.threats
    if (Array.isArray(lastScan?.ameacas)) return lastScan.ameacas
    return []
  }, [threats, lastScan])

  const filteredThreats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')

    return collectedThreats.filter((threat) => {
      const levelMatches = activeFilter === 'todas' || getThreatLevel(threat) === activeFilter
      const searchableText = [getThreatName(threat), getThreatSource(threat), threat?.description, threat?.descricao]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt-BR')

      return levelMatches && (!normalizedQuery || searchableText.includes(normalizedQuery))
    })
  }, [activeFilter, collectedThreats, query])

  const selectedThreatName = selectedThreat ? getThreatName(selectedThreat) : ''

  return (
    <section className="dp-threats-page" aria-labelledby="dp-threats-title">
      <div className="dp-threats-header">
        <div>
          <h1 id="dp-threats-title">Ameaças</h1>
          <p>Acompanhe somente ameaças retornadas por uma coleta real do dispositivo.</p>
        </div>
        <button className="dp-threats-primary-action" type="button" onClick={() => onNavigate?.('Scanner')}>
          <ScanLine size={17} /> Abrir scanner
        </button>
      </div>

      <div className="dp-threats-backend-note" role="status">
        <Info size={18} />
        <div>
          <strong>Integração de segurança pendente.</strong>
          <span>Sem o backend Django, não há catálogo, quarentena ou remoção de ameaças disponível.</span>
        </div>
      </div>

      <div className="dp-threats-toolbar">
        <label className="dp-threats-search">
          <Search size={16} />
          <span className="dp-threats-visually-hidden">Buscar ameaças</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou pacote"
          />
        </label>
        <div className="dp-threats-filters" aria-label="Filtrar ameaças por risco">
          <Filter size={16} aria-hidden="true" />
          {filters.map((filter) => (
            <button
              className={`dp-threats-filter ${activeFilter === filter.id ? 'dp-threats-filter-active' : ''}`}
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dp-threats-card">
        <div className="dp-threats-card-heading">
          <div>
            <h2>Resultado da coleta</h2>
            <p>{filteredThreats.length} item{filteredThreats.length === 1 ? '' : 'ns'} exibido{filteredThreats.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        {filteredThreats.length > 0 ? (
          <ul className="dp-threats-list">
            {filteredThreats.map((threat, index) => {
              const level = getThreatLevel(threat)
              const source = getThreatSource(threat)
              const date = getThreatDate(threat)
              const name = getThreatName(threat)

              return (
                <li className="dp-threats-item" key={threat?.id || threat?.hash || `${name}-${index}`}>
                  <div className={`dp-threats-risk-icon dp-threats-risk-${level}`} aria-hidden="true">
                    <ShieldAlert size={19} />
                  </div>
                  <div className="dp-threats-item-main">
                    <strong>{name}</strong>
                    {(source || date) && (
                      <span>{[source, date].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <span className={`dp-threats-level dp-threats-level-${level}`}>
                    {level === 'desconhecido' ? 'Sem classificação' : `Risco ${level}`}
                  </span>
                  <button className="dp-threats-outline-action" type="button" onClick={() => setSelectedThreat(threat)}>
                    Ver ação
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="dp-threats-empty-state">
            <ShieldAlert size={34} aria-hidden="true" />
            <h2>{collectedThreats.length ? 'Nenhuma ameaça corresponde aos filtros' : 'Nenhuma ameaça disponível'}</h2>
            <p>
              {collectedThreats.length
                ? 'Altere os filtros ou a busca para revisar os dados coletados.'
                : 'Execute uma coleta compatível quando o serviço de análise estiver integrado para visualizar resultados reais.'}
            </p>
            {!collectedThreats.length && (
              <button className="dp-threats-link-action" type="button" onClick={() => onNavigate?.('Scanner')}>
                Ir para o scanner
              </button>
            )}
          </div>
        )}
      </div>

      {selectedThreat && (
        <div className="dp-threats-modal-backdrop" role="presentation" onMouseDown={() => setSelectedThreat(null)}>
          <section
            className="dp-threats-modal"
            aria-labelledby="dp-threats-modal-title"
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="dp-threats-modal-close" type="button" aria-label="Fechar" onClick={() => setSelectedThreat(null)}>
              <X size={18} />
            </button>
            <ShieldAlert size={25} className="dp-threats-modal-icon" aria-hidden="true" />
            <h2 id="dp-threats-modal-title">Ação indisponível</h2>
            <p>
              A ameaça <strong>{selectedThreatName}</strong> foi exibida a partir da coleta recebida, mas o tratamento exige a API Django e um mecanismo de segurança integrado.
            </p>
            <button className="dp-threats-primary-action" type="button" onClick={() => setSelectedThreat(null)}>
              Entendi
            </button>
          </section>
        </div>
      )}
    </section>
  )
}

export default ThreatsPage

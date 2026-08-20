import { useState } from 'react'
import { HardDrive, MemoryStick, LayoutGrid, Loader2 } from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import DeviceCard from '../components/DeviceCard.jsx'
import './ScannerPage.css'

function ScannerPage() {
  const dispositivo = useDeviceStatus()
  const [diagnostico, setDiagnostico] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  async function iniciarDiagnostico() {
    if (dispositivo.status !== 'connected') return
    setCarregando(true)
    setErro('')
    setDiagnostico(null)

    try {
      const resultado = await window.diagpro.runDiagnostic(dispositivo.serial)
      if (resultado.sucesso) {
        setDiagnostico(resultado.dados)
      } else {
        setErro(resultado.mensagem || 'Não foi possível coletar o diagnóstico.')
      }
    } catch {
      setErro('Erro ao comunicar com o dispositivo.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="dp-scanner-page">
      <div className="dp-greeting-row">
        <div>
          <h1>Scanner</h1>
          <p>Conecte um dispositivo Android e inicie a coleta de dados reais.</p>
        </div>
      </div>

      <div className="dp-card">
        <div className="dp-card-title">DISPOSITIVO CONECTADO</div>
        <DeviceCard estado={dispositivo} onIniciarDiagnostico={iniciarDiagnostico} />
      </div>

      {carregando && (
        <div className="dp-card dp-scanner-loading">
          <Loader2 size={24} className="spin" />
          <p>Coletando informações do dispositivo...</p>
        </div>
      )}

      {erro && (
        <div className="dp-card dp-scanner-error"><p>{erro}</p></div>
      )}

      {diagnostico && (
        <div className="dp-card">
          <div className="dp-card-title">RESULTADO DA COLETA</div>
          <div className="dp-scanner-results">
            <div className="dp-scanner-result-item">
              <HardDrive size={22} />
              <div>
                <div className="dp-scanner-result-title">Armazenamento</div>
                <div className="dp-scanner-result-value">
                  {diagnostico.armazenamento.usadoGb} GB usados de {diagnostico.armazenamento.totalGb} GB
                </div>
                <div className="dp-scanner-result-sub">{diagnostico.armazenamento.livreGb} GB livres</div>
              </div>
            </div>
            <div className="dp-scanner-result-item">
              <MemoryStick size={22} />
              <div>
                <div className="dp-scanner-result-title">Memória RAM</div>
                <div className="dp-scanner-result-value">
                  {diagnostico.memoria.disponivelGb} GB disponíveis de {diagnostico.memoria.totalGb} GB
                </div>
              </div>
            </div>
            <div className="dp-scanner-result-item">
              <LayoutGrid size={22} />
              <div>
                <div className="dp-scanner-result-title">Aplicativos instalados</div>
                <div className="dp-scanner-result-value">{diagnostico.totalApps} apps</div>
              </div>
            </div>
          </div>
          <p className="dp-scanner-disclaimer">
            Esta etapa coleta apenas dados reais de uso do sistema. A análise de segurança e detecção de ameaças será implementada em uma etapa futura.
          </p>
        </div>
      )}
    </div>
  )
}

export default ScannerPage
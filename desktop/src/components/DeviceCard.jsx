import { Usb, Smartphone, AlertTriangle, WifiOff, Loader2, Play, Battery, Layers } from 'lucide-react'
import './DeviceCard.css'

function DeviceCard({ estado, onIniciarDiagnostico }) {
  const status = estado?.status || 'waiting'

  if (status === 'waiting' || status === 'disconnected') {
    return (
      <div className="dp-device-state">
        <Usb size={32} className="dp-device-state-icon waiting" />
        <p className="dp-device-state-title">Aguardando dispositivo</p>
        <p className="dp-device-state-desc">Conecte um Android via USB com a depuração USB ativada.</p>
      </div>
    )
  }

  if (status === 'unauthorized') {
    return (
      <div className="dp-device-state">
        <AlertTriangle size={32} className="dp-device-state-icon warning" />
        <p className="dp-device-state-title">Autorização necessária</p>
        <p className="dp-device-state-desc">
          Desbloqueie o aparelho e aceite a solicitação de depuração USB que apareceu na tela do celular.
        </p>
        <div className="dp-device-state-pulse">
          <Loader2 size={14} className="spin" /> Aguardando autorização...
        </div>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="dp-device-state">
        <WifiOff size={32} className="dp-device-state-icon warning" />
        <p className="dp-device-state-title">Dispositivo offline</p>
        <p className="dp-device-state-desc">Desconecte e reconecte o cabo USB.</p>
      </div>
    )
  }

  if (status === 'multiple') {
    return (
      <div className="dp-device-state">
        <Layers size={32} className="dp-device-state-icon warning" />
        <p className="dp-device-state-title">Múltiplos dispositivos detectados</p>
        <p className="dp-device-state-desc">Desconecte os aparelhos extras e deixe apenas um conectado.</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="dp-device-state">
        <AlertTriangle size={32} className="dp-device-state-icon error" />
        <p className="dp-device-state-title">Erro na detecção</p>
        <p className="dp-device-state-desc">{estado.mensagem}</p>
      </div>
    )
  }

  if (status !== 'connected') {
    return (
      <div className="dp-device-state">
        <Usb size={32} className="dp-device-state-icon waiting" />
        <p className="dp-device-state-title">Aguardando dispositivo</p>
        <p className="dp-device-state-desc">Conecte um Android via USB com a depuração USB ativada.</p>
      </div>
    )
  }

  return (
    <div className="dp-device-body">
      <div className="dp-device-visual"><Smartphone size={64} /></div>
      <div className="dp-device-info">
        <h2>{estado.fabricante} {estado.modelo}</h2>
        <div className="dp-device-tags">
          <span><Smartphone size={14} /> Android {estado.versaoAndroid}</span>
          <span><Usb size={14} /> USB conectado</span>
        </div>
        <div className="dp-device-tags">
          <span><Battery size={14} /> Bateria: {estado.bateria}%</span>
        </div>
        <button className="dp-primary-btn dp-start-btn" onClick={() => onIniciarDiagnostico && onIniciarDiagnostico()}>
          <Play size={16} /> Iniciar diagnóstico
        </button>
      </div>
      <div className="dp-device-quickinfo">
        <div className="dp-quickinfo-title">INFORMAÇÕES RÁPIDAS</div>
        <div><span>Modelo</span><strong>{estado.modelo}</strong></div>
        <div><span>SDK Android</span><strong>{estado.sdk}</strong></div>
        <div><span>Serial</span><strong>{estado.serial}</strong></div>
      </div>
    </div>
  )
}

export default DeviceCard
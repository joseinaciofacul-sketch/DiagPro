import { Construction } from 'lucide-react'

function PlaceholderPage({ title }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b', textAlign: 'center' }}>
      <Construction size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
      <h2 style={{ color: '#e2e8f0', margin: '0 0 8px' }}>{title}</h2>
      <p style={{ maxWidth: 320, fontSize: 14 }}>Essa página ainda está em construção. Em breve ela vai mostrar informações reais aqui.</p>
    </div>
  )
}

export default PlaceholderPage

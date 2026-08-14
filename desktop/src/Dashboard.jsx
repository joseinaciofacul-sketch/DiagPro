function Dashboard({ username, onLogout }) {
  const menuItems = [
    'Dashboard',
    'Nova Análise',
    'Histórico',
    'Relatórios',
    'Clientes',
    'Licença',
    'Configurações',
    'Ajuda',
  ]

  const cards = [
    { label: 'Aparelhos Analisados', valor: 0 },
    { label: 'Vírus Encontrados', valor: 0 },
    { label: 'Ameaças Removidas', valor: 0 },
    { label: 'Clientes Atendidos', valor: 0 },
    { label: 'Tempo Médio de Análise', valor: '0 min' },
  ]

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <aside style={{ width: 220, background: '#1f2937', color: '#fff', padding: 20, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
  <img src="/logo.png" alt="DiagPro" style={{ width: 28 }} />
  <h2 style={{ fontSize: 18, margin: 0 }}>DiagPro</h2>
</div>
        <nav>
          {menuItems.map((item) => (
            <div key={item} style={{ padding: '10px 0', cursor: 'pointer', opacity: 0.85 }}>
              {item}
            </div>
          ))}
        </nav>
        <button
          onClick={onLogout}
          style={{ marginTop: 40, width: '100%', padding: 10, background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          Sair
        </button>
      </aside>

      <main style={{ flex: 1, padding: 30, background: '#f3f4f6', overflowY: 'auto' }}>
        <h1 style={{ marginBottom: 4 }}>Dashboard</h1>
        <p style={{ color: '#6b7280', marginBottom: 30 }}>Bem-vindo, {username}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {cards.map((card) => (
            <div key={card.label} style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>{card.label}</p>
              <p style={{ fontSize: 28, fontWeight: 'bold' }}>{card.valor}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default Dashboard

import { useState, useEffect } from 'react'
import Login from './Login.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ScannerPage from './pages/ScannerPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import { salvarTokens, limparTokens, renovarSessao } from './utils/auth.js'

function App() {
  const [token, setToken] = useState(null)
  const [username, setUsername] = useState('')
  const [activePage, setActivePage] = useState('Dashboard')
  const [verificandoSessao, setVerificandoSessao] = useState(true)

  useEffect(() => {
    async function restaurarSessao() {
      const accessToken = await renovarSessao()
      if (accessToken) {
        setToken(accessToken)
        setUsername(localStorage.getItem('diagpro_username') || '')
      }
      setVerificandoSessao(false)
    }
    restaurarSessao()
  }, [])

  function handleLoginSuccess(accessToken, refreshToken, user, lembrar) {
    setToken(accessToken)
    setUsername(user)
    if (lembrar) {
      salvarTokens(accessToken, refreshToken)
      localStorage.setItem('diagpro_username', user)
    }
  }

  function handleLogout() {
    setToken(null)
    setUsername('')
    setActivePage('Dashboard')
    limparTokens()
  }

  if (verificandoSessao) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#64748b' }}>
        Carregando...
      </div>
    )
  }

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  function renderPage() {
    if (activePage === 'Dashboard') return <DashboardPage username={username} />
    if (activePage === 'Scanner') return <ScannerPage />
    return <PlaceholderPage title={activePage} />
  }

  return (
    <AppLayout username={username} onLogout={handleLogout} activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </AppLayout>
  )
}

export default App
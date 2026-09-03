import { useState, useEffect } from 'react'
import Login from './Login.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ClientsPage from './pages/ClientsPage.jsx'
import DevicesPage from './pages/DevicesPage.jsx'
import ManagementPage from './pages/ManagementPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import ScannerPage from './pages/ScannerPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import SubscriptionPage from './pages/SubscriptionPage.jsx'
import ThreatsPage from './pages/ThreatsPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import useDeviceStatus from './hooks/useDeviceStatus.js'
import { salvarTokens, limparTokens, renovarSessao } from './utils/auth.js'
import { reconcileScanSession, sessionForConnectedDevice } from './utils/scanSession.mjs'

function App() {
  const [token, setToken] = useState(null)
  const [username, setUsername] = useState('')
  const [activePage, setActivePage] = useState('Dashboard')
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState(null)
  const [verificandoSessao, setVerificandoSessao] = useState(true)
  const [scanSession, setScanSession] = useState(null)
  const [scannerRequest, setScannerRequest] = useState(null)
  const dispositivo = useDeviceStatus()

  useEffect(() => {
    setScanSession((current) => reconcileScanSession(current, dispositivo))
  }, [dispositivo.serial, dispositivo.status])

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
    setSelectedDiagnosticId(null)
    setScanSession(null)
    setScannerRequest(null)
    limparTokens()
  }

  function handleNavigate(page) {
    setSelectedDiagnosticId(null)
    if (page === 'Scanner') setScannerRequest(null)
    setActivePage(page)
  }

  function openScanner(mode = null) {
    setSelectedDiagnosticId(null)
    setScannerRequest({ mode, requestedAt: Date.now() })
    setActivePage('Scanner')
  }

  function openDiagnosticReport(diagnosticId) {
    if (diagnosticId === null || diagnosticId === undefined) return
    setSelectedDiagnosticId(diagnosticId)
    setActivePage('Relatórios')
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
    const currentScanSession = sessionForConnectedDevice(scanSession, dispositivo)
    if (activePage === 'Dashboard') return <DashboardPage username={username} dispositivo={dispositivo} scanSession={currentScanSession} onOpenScanner={openScanner} onNavigate={handleNavigate} />
    if (activePage === 'Scanner') return <ScannerPage accessToken={token} onNavigate={handleNavigate} dispositivo={dispositivo} initialMode={scannerRequest?.mode} scanSession={currentScanSession} onScanSessionChange={setScanSession} />
    if (activePage === 'Dispositivos') return <DevicesPage accessToken={token} dispositivo={dispositivo} scanResult={currentScanSession?.result || null} onOpenScanner={() => openScanner()} onStartDiagnostic={() => openScanner()} onOpenReport={openDiagnosticReport} />
    if (activePage === 'Ameaças') return <ThreatsPage accessToken={token} onNavigate={handleNavigate} onOpenReport={openDiagnosticReport} device={dispositivo} />
    if (activePage === 'Relatórios') return <ReportsPage accessToken={token} diagnosticId={selectedDiagnosticId} />
    if (activePage === 'Clientes') return <ClientsPage accessToken={token} onOpenReport={openDiagnosticReport} />
    if (activePage === 'Visão Gerencial') return <ManagementPage accessToken={token} onOpenReport={openDiagnosticReport} />
    if (activePage === 'Configurações') return <SettingsPage accessToken={token} onLogout={handleLogout} />
    if (activePage === 'Plano e assinatura') return <SubscriptionPage accessToken={token} />
    return <PlaceholderPage title={activePage} />
  }

  return (
    <AppLayout username={username} onLogout={handleLogout} activePage={activePage} onNavigate={handleNavigate}>
      {renderPage()}
    </AppLayout>
  )
}

export default App

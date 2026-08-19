import { useState } from 'react'
import Login from './Login.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'

function App() {
  const [token, setToken] = useState(null)
  const [username, setUsername] = useState('')
  const [activePage, setActivePage] = useState('Dashboard')

  function handleLoginSuccess(accessToken, user) {
    setToken(accessToken)
    setUsername(user)
  }

  function handleLogout() {
    setToken(null)
    setUsername('')
    setActivePage('Dashboard')
  }

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  function renderPage() {
    if (activePage === 'Dashboard') return <DashboardPage username={username} />
    return <PlaceholderPage title={activePage} />
  }

  return (
    <AppLayout username={username} onLogout={handleLogout} activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </AppLayout>
  )
}

export default App
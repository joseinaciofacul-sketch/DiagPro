import { useState } from 'react'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'

function App() {
  const [token, setToken] = useState(null)
  const [username, setUsername] = useState('')

  function handleLoginSuccess(accessToken, user) {
    setToken(accessToken)
    setUsername(user)
  }

  function handleLogout() {
    setToken(null)
    setUsername('')
  }

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  return <Dashboard username={username} onLogout={handleLogout} />
}

export default App

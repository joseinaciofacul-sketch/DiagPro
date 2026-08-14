import { useState } from 'react'

function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    try {
      const resposta = await fetch('http://127.0.0.1:8000/api/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!resposta.ok) {
        throw new Error('Usuário ou senha inválidos')
      }

      const dados = await resposta.json()
      onLoginSuccess(dados.access, username)
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <form onSubmit={handleLogin} style={{ width: 300, textAlign: 'center' }}>
        <img src="/logo.png" alt="DiagPro" style={{ width: 72, marginBottom: 12 }} />
<h1>DiagPro</h1>
        <input
          type="text"
          placeholder="Usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box' }}
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box' }}
        />
        <button type="submit" disabled={carregando} style={{ width: '100%', padding: 10 }}>
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
        {erro && <p style={{ color: 'red' }}>{erro}</p>}
      </form>
    </div>
  )
}

export default Login

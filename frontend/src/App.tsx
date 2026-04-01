import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { api } from './services/api'
import type { AuthUser } from './types'

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getMe()
      .then((data) => {
        if (data.authenticated) {
          setUser(data as AuthUser)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            user ? (
              <div>
                <h1>NCLEX Trainer v5</h1>
                <p>Welcome, {user.email}</p>
                <button onClick={async () => {
                  await api.logout()
                  setUser(null)
                }}>Logout</button>
              </div>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/" />
            ) : (
              <LoginPage onLogin={setUser} />
            )
          }
        />
      </Routes>
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isRegister, setIsRegister] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (isRegister) {
        await api.register(email, password)
      } else {
        await api.login(email, password)
      }
      const me = await api.getMe()
      if (me.authenticated) {
        onLogin(me as AuthUser)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    }
  }

  return (
    <div className="login-page">
      <h1>NCLEX Trainer v5</h1>
      <form onSubmit={handleSubmit}>
        <h2>{isRegister ? 'Register' : 'Login'}</h2>
        {error && <p className="error">{error}</p>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <button type="submit">{isRegister ? 'Register' : 'Login'}</button>
        <p>
          <button type="button" onClick={() => setIsRegister(!isRegister)}>
            {isRegister ? 'Already have an account? Login' : 'Need an account? Register'}
          </button>
        </p>
      </form>
    </div>
  )
}

export default App

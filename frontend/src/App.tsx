import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { api } from './services/api'
import { contentSetup } from './services/content-setup'
import type { SetupProgress } from './services/content-setup'
import type { AuthUser } from './types'
import { OfflineBanner, SyncStatusIndicator } from './components/OfflineBanner'
import { PracticePage } from './pages/PracticePage'
import { NGNCasePage } from './pages/NGNCasePage'
import { ReviewPage } from './pages/ReviewPage'
import { ProgressPage } from './pages/ProgressPage'
import { VoicePage } from './pages/VoicePage'
import { AdminDashboard } from './pages/AdminDashboard'
import { ExamPage } from './pages/ExamPage'

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null)
  const [setupDone, setSetupDone] = useState(false)

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

  // Run content setup after login
  useEffect(() => {
    if (user && !setupDone) {
      if (contentSetup.needsSetup()) {
        contentSetup.runFullSetup((progress) => {
          setSetupProgress(progress)
          if (progress.phase === 'complete') {
            setSetupDone(true)
            setSetupProgress(null)
          }
        })
      } else {
        setSetupDone(true)
      }
    }
  }, [user, setupDone])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="app">
      <OfflineBanner />
      <Routes>
        <Route
          path="/login"
          element={
            user ? <Navigate to="/" /> : <LoginPage onLogin={setUser} />
          }
        />
        <Route
          path="/*"
          element={
            user ? (
              <AuthenticatedApp
                user={user}
                onLogout={() => { api.logout(); setUser(null) }}
                setupProgress={setupProgress}
                setupDone={setupDone}
              />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </div>
  )
}

function AuthenticatedApp({
  user,
  onLogout,
  setupProgress,
  setupDone,
}: {
  user: AuthUser
  onLogout: () => void
  setupProgress: SetupProgress | null
  setupDone: boolean
}) {
  const location = useLocation()
  const isAdmin = user.role === 'ADMIN'

  const navItems = [
    { path: '/', label: 'Practice' },
    { path: '/ngn', label: 'NGN Cases' },
    { path: '/review', label: 'Review' },
    { path: '/progress', label: 'Progress' },
    { path: '/voice', label: 'Voice' },
    { path: '/exam', label: 'Exam' },
    ...(isAdmin ? [{ path: '/admin', label: 'Admin' }] : []),
  ]

  return (
    <>
      <nav className="main-nav">
        <div className="nav-brand">NCLEX Trainer v5</div>
        <div className="nav-links">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-link${location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path)) ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          <SyncStatusIndicator />
          <span className="nav-email">{user.email}</span>
          <button className="nav-logout" onClick={onLogout}>Logout</button>
        </div>
      </nav>

      {/* Setup progress overlay */}
      {setupProgress && !setupDone && (
        <div className="setup-overlay">
          <div className="setup-card">
            <h3>Setting up content...</h3>
            <p>{setupProgress.message}</p>
            <div className="setup-bar">
              <div
                className="setup-bar-fill"
                style={{ width: `${setupProgress.total > 0 ? (setupProgress.loaded / setupProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        <Routes>
          <Route path="/" element={<PracticePage />} />
          <Route path="/ngn" element={<NGNCasePage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/exam" element={<ExamPage />} />
          {isAdmin && <Route path="/admin" element={<AdminDashboard />} />}
        </Routes>
      </main>
    </>
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

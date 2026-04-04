import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'

// Mock all page components to avoid deep rendering
vi.mock('../../pages/PracticePage', () => ({ PracticePage: () => <div>PracticePage</div> }))
vi.mock('../../pages/NGNCasePage', () => ({ NGNCasePage: () => <div>NGNCasePage</div> }))
vi.mock('../../pages/ReviewPage', () => ({ ReviewPage: () => <div>ReviewPage</div> }))
vi.mock('../../pages/ProgressPage', () => ({ ProgressPage: () => <div>ProgressPage</div> }))
vi.mock('../../pages/VoicePage', () => ({ VoicePage: () => <div>VoicePage</div> }))
vi.mock('../../pages/AdminDashboard', () => ({ AdminDashboard: () => <div>AdminDashboard</div> }))
vi.mock('../../pages/ExamPage', () => ({ ExamPage: () => <div>ExamPage</div> }))
vi.mock('../../components/OfflineBanner', () => ({
  OfflineBanner: () => <div>OfflineBanner</div>,
  SyncStatusIndicator: () => <div>SyncIndicator</div>,
}))
vi.mock('../../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockGetMe = vi.fn()
const mockLogin = vi.fn()
const mockRegister = vi.fn()
const mockLogout = vi.fn()

vi.mock('../../services/api', () => ({
  api: {
    getMe: (...args: unknown[]) => mockGetMe(...args),
    login: (...args: unknown[]) => mockLogin(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
  },
}))

vi.mock('../../services/content-setup', () => ({
  contentSetup: {
    needsSetup: () => false,
    runFullSetup: vi.fn(),
  },
}))

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading initially', () => {
    mockGetMe.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><App /></MemoryRouter>)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows login page when not authenticated', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('NCLEX Trainer v5')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })
  })

  it('shows authenticated app when logged in', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '123' })
    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
      expect(screen.getByText('Practice')).toBeInTheDocument()
    })
  })

  it('toggles between login and register', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/need an account/i))
    expect(screen.getByRole('heading', { name: 'Register' })).toBeInTheDocument()
  })
})

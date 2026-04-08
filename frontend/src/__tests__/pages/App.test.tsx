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
vi.mock('../../pages/LibraryPage', () => ({ LibraryPage: () => <div>LibraryPage</div> }))
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
    needsSetup: vi.fn(() => false),
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

  it('login form submits and logs in', async () => {
    mockGetMe
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({ authenticated: true, email: 'user@test.com', role: 'USER', userId: '1' })
    mockLogin.mockResolvedValue({ message: 'ok' })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('user@test.com', 'password123')
    })
  })

  it('register form submits and registers', async () => {
    mockGetMe
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({ authenticated: true, email: 'new@test.com', role: 'USER', userId: '2' })
    mockRegister.mockResolvedValue({ message: 'ok' })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    // Switch to register mode
    fireEvent.click(screen.getByText(/need an account/i))

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('new@test.com', 'password123')
    })
  })

  it('shows error on login failure', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'bad@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  it('shows error for non-Error throw', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    mockLogin.mockRejectedValue('string error')

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'x@x.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: '12345678' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => {
      expect(screen.getByText('An error occurred')).toBeInTheDocument()
    })
  })

  it('logout button calls api.logout and shows login', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '123' })
    mockLogout.mockResolvedValue({ message: 'ok' })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Logout')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Logout'))
    expect(mockLogout).toHaveBeenCalled()
  })

  it('shows setup progress overlay when setup is in progress', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '123' })

    // Make contentSetup.needsSetup return true
    const { contentSetup } = await import('../../services/content-setup')
    vi.mocked(contentSetup.needsSetup).mockReturnValue(true)
    vi.mocked(contentSetup.runFullSetup).mockImplementation((cb: any) => {
      cb({ phase: 'phase1', loaded: 5, total: 10, message: 'Loading modules...' })
    })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Setting up content...')).toBeInTheDocument()
      expect(screen.getByText('Loading modules...')).toBeInTheDocument()
    })

    // Reset for other tests
    vi.mocked(contentSetup.needsSetup).mockReturnValue(false)
  })

  it('shows admin nav for admin users', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'admin@test.com', role: 'ADMIN', userId: '99' })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })
  })

  it('hides admin nav for regular users', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'user@test.com', role: 'USER', userId: '1' })

    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Practice')).toBeInTheDocument()
    })
    expect(screen.queryByText('Admin')).toBeNull()
  })

  it('shows active class on current nav link', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'user@test.com', role: 'USER', userId: '1' })

    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await waitFor(() => {
      const practiceLink = screen.getByText('Practice')
      expect(practiceLink.className).toContain('active')
    })
  })

  it('getMe failure shows login page', async () => {
    mockGetMe.mockRejectedValue(new Error('network'))
    render(<MemoryRouter><App /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('NCLEX Trainer v5')).toBeInTheDocument()
    })
  })
})

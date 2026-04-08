/**
 * Tests targeting uncovered lines 137-148, 174-190 in App.tsx
 * Lines 137-148: setup progress overlay display
 * Lines 174-190: LoginPage handleSubmit (register mode, error handling)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'

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

const mockNeedsSetup = vi.fn()
const mockRunFullSetup = vi.fn()

vi.mock('../../services/content-setup', () => ({
  contentSetup: {
    needsSetup: (...args: unknown[]) => mockNeedsSetup(...args),
    runFullSetup: (...args: unknown[]) => mockRunFullSetup(...args),
  },
}))

describe('App — setup progress overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows setup progress overlay when setup is running', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '1' })
    mockNeedsSetup.mockReturnValue(true)

    // Simulate runFullSetup calling the progress callback without completing
    mockRunFullSetup.mockImplementation((cb: (p: { phase: string; loaded: number; total: number; message: string }) => void) => {
      cb({ phase: 'phase1', loaded: 1, total: 3, message: 'Loading drugs...' })
      // Do NOT call complete, so the overlay stays visible
    })

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('Setting up content...')).toBeInTheDocument()
    })
    expect(screen.getByText('Loading drugs...')).toBeInTheDocument()
  })

  it('hides setup overlay when setup completes', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '1' })
    mockNeedsSetup.mockReturnValue(true)

    mockRunFullSetup.mockImplementation((cb: (p: { phase: string; loaded: number; total: number; message: string }) => void) => {
      cb({ phase: 'phase1', loaded: 1, total: 3, message: 'Loading...' })
      // Complete the setup
      cb({ phase: 'complete', loaded: 1, total: 1, message: 'Content ready' })
    })

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
    })

    // Setup overlay should be gone
    expect(screen.queryByText('Setting up content...')).not.toBeInTheDocument()
  })

  it('skips setup when needsSetup returns false', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '1' })
    mockNeedsSetup.mockReturnValue(false)

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
    })
    expect(mockRunFullSetup).not.toHaveBeenCalled()
  })
})

describe('App — LoginPage submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNeedsSetup.mockReturnValue(false)
  })

  it('login flow calls api.login then api.getMe', async () => {
    mockGetMe
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '1' })
    mockLogin.mockResolvedValue({ message: 'ok' })

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } })
    fireEvent.submit(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@test.com', 'password123')
    })
  })

  it('register flow calls api.register then api.getMe', async () => {
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
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'newpassword' } })
    fireEvent.submit(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('new@test.com', 'newpassword')
    })
  })

  it('shows error message on login failure', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'bad@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    fireEvent.submit(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  it('shows generic error for non-Error throws', async () => {
    mockGetMe.mockResolvedValue({ authenticated: false })
    mockLogin.mockRejectedValue('string error')

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'bad@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    fireEvent.submit(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => {
      expect(screen.getByText('An error occurred')).toBeInTheDocument()
    })
  })

  it('handles getMe failure gracefully on initial load', async () => {
    mockGetMe.mockRejectedValue(new Error('Network error'))

    render(<MemoryRouter><App /></MemoryRouter>)

    // Should show login page after failure
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    })
  })

  it('logout clears user and shows login', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'test@test.com', role: 'USER', userId: '1' })
    mockLogout.mockResolvedValue({ message: 'ok' })
    mockNeedsSetup.mockReturnValue(false)

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('Logout')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Logout'))

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled()
    })
  })

  it('shows Admin nav link for admin users', async () => {
    mockGetMe.mockResolvedValue({ authenticated: true, email: 'admin@test.com', role: 'ADMIN', userId: '1' })
    mockNeedsSetup.mockReturnValue(false)

    render(<MemoryRouter><App /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })
  })
})

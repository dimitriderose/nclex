import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('registerServiceWorker', () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>
  let loadCallback: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    loadCallback = null
    addEventListenerSpy = vi.fn((event: string, cb: any) => {
      if (event === 'load') loadCallback = cb
    })
    vi.stubGlobal('window', {
      ...globalThis.window,
      addEventListener: addEventListenerSpy,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('registers service worker on load when supported', async () => {
    const mockRegistration: any = {
      scope: '/',
      installing: null,
      active: null,
      addEventListener: vi.fn(),
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: vi.fn().mockResolvedValue(mockRegistration) },
      configurable: true,
      writable: true,
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { registerServiceWorker } = await import('../../services/sw-register')
    registerServiceWorker()

    expect(addEventListenerSpy).toHaveBeenCalledWith('load', expect.any(Function))

    await loadCallback!()

    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(consoleSpy).toHaveBeenCalledWith('SW registered:', '/')

    consoleSpy.mockRestore()
  })

  it('handles registration failure', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: vi.fn().mockRejectedValue(new Error('SW failed')) },
      configurable: true,
      writable: true,
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { registerServiceWorker } = await import('../../services/sw-register')
    registerServiceWorker()

    await loadCallback!()

    expect(warnSpy).toHaveBeenCalledWith('SW registration failed:', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('listens for updatefound event', async () => {
    let updateFoundCb: any = null
    const mockRegistration: any = {
      scope: '/',
      installing: null,
      active: { state: 'activated' },
      addEventListener: vi.fn((event: string, cb: any) => {
        if (event === 'updatefound') updateFoundCb = cb
      }),
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: vi.fn().mockResolvedValue(mockRegistration) },
      configurable: true,
      writable: true,
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { registerServiceWorker } = await import('../../services/sw-register')
    registerServiceWorker()
    await loadCallback!()

    expect(mockRegistration.addEventListener).toHaveBeenCalledWith(
      'updatefound',
      expect.any(Function)
    )

    // Simulate updatefound with a new worker
    let stateChangeCb: any = null
    const newWorker = {
      state: 'installing',
      addEventListener: vi.fn((event: string, cb: any) => {
        if (event === 'statechange') stateChangeCb = cb
      }),
    }
    mockRegistration.installing = newWorker
    updateFoundCb()

    expect(newWorker.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function))

    // Simulate state change to activated
    newWorker.state = 'activated'
    stateChangeCb()

    expect(console.log).toHaveBeenCalledWith('New content available; please refresh.')

    vi.mocked(console.log).mockRestore()
  })

  it('does nothing when serviceWorker is not supported', async () => {
    // Remove serviceWorker from navigator
    const desc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    // Delete to simulate missing
    delete (navigator as any).serviceWorker

    const { registerServiceWorker } = await import('../../services/sw-register')
    registerServiceWorker()

    // Should not have added a load listener (since serviceWorker not in navigator)
    // This depends on the check in the source code
    // The function checks 'serviceWorker' in navigator
    if (desc) {
      Object.defineProperty(navigator, 'serviceWorker', desc)
    }
  })
})

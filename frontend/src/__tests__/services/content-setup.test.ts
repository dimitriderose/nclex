import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/localstorage-manager', () => ({
  localStorageManager: {
    isInitialized: vi.fn(),
    isModuleLoaded: vi.fn(),
    setModule: vi.fn(),
    setMeta: vi.fn(),
    getMeta: vi.fn(),
    clearAll: vi.fn(),
  },
  STATIC_MODULES: ['drugs', 'labs', 'formulas'],
}))

vi.mock('../../services/indexeddb-store', () => ({
  indexedDBStore: {
    count: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('../../services/index-bundled-content', () => ({
  indexBundledContent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../data/static-modules', () => ({
  staticData: {
    drugs: { metformin: { class: 'Biguanide' } },
    labs: { sodium: { normal: '136-145' } },
    formulas: { iv_drip_rate: { formula: 'V/T * drop factor' } },
  },
}))

import { contentSetup } from '../../services/content-setup'
import { localStorageManager } from '../../services/localstorage-manager'
import { indexedDBStore } from '../../services/indexeddb-store'

describe('contentSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('needsSetup', () => {
    it('returns true when not initialized', () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(false)
      expect(contentSetup.needsSetup()).toBe(true)
    })

    it('returns false when initialized', () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(true)
      expect(contentSetup.needsSetup()).toBe(false)
    })
  })

  describe('runPhase1', () => {
    it('loads all unloaded modules', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      await contentSetup.runPhase1()
      expect(localStorageManager.setModule).toHaveBeenCalledTimes(3)
      expect(localStorageManager.setMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 1,
          phase1Complete: true,
          phase2Complete: false,
        })
      )
    })

    it('skips already loaded modules', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(true)
      await contentSetup.runPhase1()
      expect(localStorageManager.setModule).not.toHaveBeenCalled()
    })

    it('calls onProgress callback during loading', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      const onProgress = vi.fn()
      await contentSetup.runPhase1(onProgress)
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'phase1', currentModule: 'drugs' })
      )
      expect(onProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'phase1', message: 'Static modules loaded' })
      )
    })

    it('does not call setModule for modules already loaded', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockImplementation(
        (mod) => mod !== 'drugs'
      )
      await contentSetup.runPhase1()
      expect(localStorageManager.setModule).toHaveBeenCalledTimes(1)
      expect(localStorageManager.setModule).toHaveBeenCalledWith('drugs', expect.any(Object))
    })

    it('works without onProgress callback', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      await expect(contentSetup.runPhase1()).resolves.toBeUndefined()
    })
  })

  describe('runPhase2', () => {
    it('initializes IndexedDB and marks phase2 complete', async () => {
      vi.mocked(indexedDBStore.count).mockResolvedValue(5)
      vi.mocked(localStorageManager.getMeta).mockReturnValue({
        version: 1,
        initializedAt: '2024-01-01',
        modulesLoaded: ['drugs'],
        phase1Complete: true,
        phase2Complete: false,
      })

      await contentSetup.runPhase2()

      expect(indexedDBStore.count).toHaveBeenCalled()
      expect(localStorageManager.setMeta).toHaveBeenCalledWith(
        expect.objectContaining({ phase2Complete: true })
      )
    })

    it('calls onProgress callback when chapters already cached', async () => {
      vi.mocked(indexedDBStore.count).mockResolvedValue(3)
      vi.mocked(localStorageManager.getMeta).mockReturnValue({
        version: 1,
        initializedAt: '2024-01-01',
        modulesLoaded: ['drugs'],
        phase1Complete: true,
        phase2Complete: false,
      })
      const onProgress = vi.fn()
      await contentSetup.runPhase2(onProgress)
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'phase2',
          message: 'Textbooks ready (3 chapters)',
        })
      )
    })

    it('does not update meta when getMeta returns null', async () => {
      // First count call returns 0 (not cached), second returns 0 (after indexing)
      vi.mocked(indexedDBStore.count).mockResolvedValue(0)
      vi.mocked(localStorageManager.getMeta).mockReturnValue(null)
      await contentSetup.runPhase2()
      // setMeta is not called because getMeta returns null
      // (the setMeta from runPhase1 is separate)
      expect(localStorageManager.setMeta).not.toHaveBeenCalled()
    })
  })

  describe('runFullSetup', () => {
    it('runs phase1 and phase2 when setup is needed', async () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(false)
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      vi.mocked(indexedDBStore.count).mockResolvedValue(0)
      vi.mocked(localStorageManager.getMeta).mockReturnValue({
        version: 1,
        initializedAt: '2024-01-01',
        modulesLoaded: [],
        phase1Complete: true,
        phase2Complete: false,
      })

      const onProgress = vi.fn()
      await contentSetup.runFullSetup(onProgress)

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'checking' })
      )
      expect(localStorageManager.setModule).toHaveBeenCalled()
      expect(indexedDBStore.count).toHaveBeenCalled()
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'complete', message: 'Content ready' })
      )
    })

    it('skips phases when setup is not needed', async () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(true)
      const onProgress = vi.fn()
      await contentSetup.runFullSetup(onProgress)

      expect(localStorageManager.setModule).not.toHaveBeenCalled()
      expect(indexedDBStore.count).not.toHaveBeenCalled()
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'complete' })
      )
    })
  })

  describe('getStatus', () => {
    it('returns status from meta', () => {
      vi.mocked(localStorageManager.getMeta).mockReturnValue({
        version: 1,
        initializedAt: '2024-01-01',
        modulesLoaded: ['drugs', 'labs'],
        phase1Complete: true,
        phase2Complete: true,
      })
      const status = contentSetup.getStatus()
      expect(status).toEqual({
        phase1: true,
        phase2: true,
        modulesLoaded: 2,
        modulesTotal: 3,
        textbookReady: true,
      })
    })

    it('returns defaults when meta is null', () => {
      vi.mocked(localStorageManager.getMeta).mockReturnValue(null)
      const status = contentSetup.getStatus()
      expect(status).toEqual({
        phase1: false,
        phase2: false,
        modulesLoaded: 0,
        modulesTotal: 3,
        textbookReady: false,
      })
    })
  })

  describe('reset', () => {
    it('clears all storage', async () => {
      vi.mocked(indexedDBStore.clear).mockResolvedValue()
      await contentSetup.reset()
      expect(localStorageManager.clearAll).toHaveBeenCalled()
      expect(indexedDBStore.clear).toHaveBeenCalled()
    })
  })
})

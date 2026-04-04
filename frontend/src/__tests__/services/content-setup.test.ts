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
  STATIC_MODULES: ['drugs', 'labs', 'formulas', 'strategies', 'delegation', 'communication', 'diagnostics', 'health_equity', 'development', 'infection_control', 'drug_suffixes', 'herbals', 'iv_fluids', 'vaccines'],
}))

vi.mock('../../services/indexeddb-store', () => ({
  indexedDBStore: {
    count: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('../../data/static-modules', () => ({
  staticData: {
    drugs: { metformin: { class: 'Biguanide' } },
    labs: { sodium: { normal: '136-145' } },
    formulas: { iv_drip_rate: {} },
    strategies: { abc: {} },
    delegation: { rn_scope: {} },
    communication: { therapeutic: {} },
    diagnostics: { cardiac_cath: {} },
    health_equity: { principles: [] },
    development: { erikson: {} },
    infection_control: { standard: {} },
    drug_suffixes: { '-olol': {} },
    herbals: { st_johns_wort: {} },
    iv_fluids: { isotonic: {} },
    vaccines: { live_vaccines: {} },
  },
}))

import { contentSetup } from '../../services/content-setup'
import { localStorageManager, STATIC_MODULES } from '../../services/localstorage-manager'
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
    it('loads all unloaded modules and calls setModule', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      const progressCalls: unknown[] = []
      await contentSetup.runPhase1((p) => progressCalls.push(p))

      // Should call setModule for each module
      expect(localStorageManager.setModule).toHaveBeenCalledTimes(STATIC_MODULES.length)
      // Should call setMeta once
      expect(localStorageManager.setMeta).toHaveBeenCalledTimes(1)
      const metaArg = vi.mocked(localStorageManager.setMeta).mock.calls[0][0]
      expect(metaArg.phase1Complete).toBe(true)
      expect(metaArg.phase2Complete).toBe(false)
      // Progress should have been called for each unloaded module + final
      expect(progressCalls.length).toBeGreaterThan(0)
    })

    it('skips already-loaded modules', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(true)
      await contentSetup.runPhase1()
      expect(localStorageManager.setModule).not.toHaveBeenCalled()
    })

    it('works without progress callback', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      await expect(contentSetup.runPhase1()).resolves.toBeUndefined()
    })

    it('reports progress with phase, module name, and counts', async () => {
      vi.mocked(localStorageManager.isModuleLoaded).mockReturnValue(false)
      const progressCalls: Array<{ phase: string; currentModule?: string; loaded: number; total: number; message: string }> = []
      await contentSetup.runPhase1((p) => progressCalls.push(p))

      // First call should be for 'drugs' module
      expect(progressCalls[0].phase).toBe('phase1')
      expect(progressCalls[0].currentModule).toBe('drugs')
      expect(progressCalls[0].loaded).toBe(0)
      expect(progressCalls[0].total).toBe(STATIC_MODULES.length)

      // Last call is the summary
      const last = progressCalls[progressCalls.length - 1]
      expect(last.message).toBe('Static modules loaded')
      expect(last.loaded).toBe(STATIC_MODULES.length)
    })
  })

  describe('runPhase2', () => {
    it('initializes indexedDB and marks phase2 complete', async () => {
      vi.mocked(indexedDBStore.count).mockResolvedValue(5)
      vi.mocked(localStorageManager.getMeta).mockReturnValue({
        version: 1,
        initializedAt: '2024-01-01',
        modulesLoaded: [],
        phase1Complete: true,
        phase2Complete: false,
      })

      const progressCalls: unknown[] = []
      await contentSetup.runPhase2((p) => progressCalls.push(p))

      expect(indexedDBStore.count).toHaveBeenCalled()
      expect(localStorageManager.setMeta).toHaveBeenCalledWith(
        expect.objectContaining({ phase2Complete: true })
      )
      expect(progressCalls.length).toBe(2)
    })

    it('handles null meta gracefully', async () => {
      vi.mocked(indexedDBStore.count).mockResolvedValue(0)
      vi.mocked(localStorageManager.getMeta).mockReturnValue(null)

      await expect(contentSetup.runPhase2()).resolves.toBeUndefined()
      // setMeta should NOT be called when meta is null
      expect(localStorageManager.setMeta).not.toHaveBeenCalled()
    })

    it('works without progress callback', async () => {
      vi.mocked(indexedDBStore.count).mockResolvedValue(0)
      vi.mocked(localStorageManager.getMeta).mockReturnValue(null)
      await expect(contentSetup.runPhase2()).resolves.toBeUndefined()
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

      const progressCalls: Array<{ phase: string }> = []
      await contentSetup.runFullSetup((p) => progressCalls.push(p))

      // Should start with 'checking' and end with 'complete'
      expect(progressCalls[0].phase).toBe('checking')
      expect(progressCalls[progressCalls.length - 1].phase).toBe('complete')
      expect(localStorageManager.setModule).toHaveBeenCalled()
      expect(indexedDBStore.count).toHaveBeenCalled()
    })

    it('skips phases when setup is not needed', async () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(true)

      const progressCalls: Array<{ phase: string }> = []
      await contentSetup.runFullSetup((p) => progressCalls.push(p))

      expect(progressCalls[0].phase).toBe('checking')
      expect(progressCalls[progressCalls.length - 1].phase).toBe('complete')
      expect(localStorageManager.setModule).not.toHaveBeenCalled()
      expect(indexedDBStore.count).not.toHaveBeenCalled()
    })

    it('works without progress callback', async () => {
      vi.mocked(localStorageManager.isInitialized).mockReturnValue(true)
      await expect(contentSetup.runFullSetup()).resolves.toBeUndefined()
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
      expect(status.phase1).toBe(true)
      expect(status.phase2).toBe(true)
      expect(status.modulesLoaded).toBe(2)
      expect(status.modulesTotal).toBe(STATIC_MODULES.length)
      expect(status.textbookReady).toBe(true)
    })

    it('returns defaults when no meta', () => {
      vi.mocked(localStorageManager.getMeta).mockReturnValue(null)

      const status = contentSetup.getStatus()
      expect(status.phase1).toBe(false)
      expect(status.phase2).toBe(false)
      expect(status.modulesLoaded).toBe(0)
      expect(status.textbookReady).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears localStorage and indexedDB', async () => {
      vi.mocked(indexedDBStore.clear).mockResolvedValue()
      await contentSetup.reset()
      expect(localStorageManager.clearAll).toHaveBeenCalled()
      expect(indexedDBStore.clear).toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { localStorageManager, STATIC_MODULES } from '../../services/localstorage-manager'
import type { DBMeta } from '../../services/localstorage-manager'

const META_KEY = 'db:meta'
const STORAGE_PREFIX = 'nclex:'

describe('localStorageManager', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ── Meta management ──────────────────────────────────────────

  describe('getMeta', () => {
    it('returns null when no meta stored', () => {
      expect(localStorageManager.getMeta()).toBeNull()
    })

    it('returns parsed meta from localStorage', () => {
      const meta: DBMeta = {
        version: 1,
        initializedAt: '2026-01-01T00:00:00Z',
        modulesLoaded: ['drugs'],
        phase1Complete: true,
        phase2Complete: false,
      }
      localStorage.setItem(META_KEY, JSON.stringify(meta))
      expect(localStorageManager.getMeta()).toEqual(meta)
    })

    it('returns null when localStorage contains invalid JSON', () => {
      localStorage.setItem(META_KEY, '{broken')
      expect(localStorageManager.getMeta()).toBeNull()
    })
  })

  describe('setMeta', () => {
    it('stores meta in localStorage', () => {
      const meta: DBMeta = {
        version: 1,
        initializedAt: '2026-01-01T00:00:00Z',
        modulesLoaded: [],
        phase1Complete: false,
        phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      expect(JSON.parse(localStorage.getItem(META_KEY)!)).toEqual(meta)
    })
  })

  describe('isInitialized', () => {
    it('returns false when no meta exists', () => {
      expect(localStorageManager.isInitialized()).toBe(false)
    })

    it('returns false when phase1Complete is false', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [],
        phase1Complete: false, phase2Complete: false,
      }
      localStorage.setItem(META_KEY, JSON.stringify(meta))
      expect(localStorageManager.isInitialized()).toBe(false)
    })

    it('returns true when phase1Complete is true', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [],
        phase1Complete: true, phase2Complete: false,
      }
      localStorage.setItem(META_KEY, JSON.stringify(meta))
      expect(localStorageManager.isInitialized()).toBe(true)
    })
  })

  // ── Content CRUD ─────────────────────────────────────────────

  describe('get', () => {
    it('returns null when key does not exist', () => {
      expect(localStorageManager.get('nonexistent')).toBeNull()
    })

    it('returns parsed data for existing key', () => {
      localStorage.setItem(`${STORAGE_PREFIX}mykey`, JSON.stringify({ foo: 'bar' }))
      expect(localStorageManager.get('mykey')).toEqual({ foo: 'bar' })
    })

    it('returns null when stored value is invalid JSON', () => {
      localStorage.setItem(`${STORAGE_PREFIX}bad`, 'not-json')
      expect(localStorageManager.get('bad')).toBeNull()
    })
  })

  describe('set', () => {
    it('stores data with prefixed key', () => {
      localStorageManager.set('mykey', { hello: 'world' })
      expect(JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}mykey`)!)).toEqual({ hello: 'world' })
    })

    it('handles quota exceeded error gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })

      localStorageManager.set('key', { data: 'value' })
      expect(warnSpy).toHaveBeenCalledWith(
        'localStorage write failed (quota?):',
        expect.any(DOMException)
      )

      setItemSpy.mockRestore()
      warnSpy.mockRestore()
    })
  })

  describe('remove', () => {
    it('removes item from localStorage', () => {
      localStorage.setItem(`${STORAGE_PREFIX}mykey`, '{}')
      localStorageManager.remove('mykey')
      expect(localStorage.getItem(`${STORAGE_PREFIX}mykey`)).toBeNull()
    })
  })

  describe('has', () => {
    it('returns false when key does not exist', () => {
      expect(localStorageManager.has('nope')).toBe(false)
    })

    it('returns true when key exists', () => {
      localStorage.setItem(`${STORAGE_PREFIX}exists`, '{}')
      expect(localStorageManager.has('exists')).toBe(true)
    })
  })

  // ── Module management ────────────────────────────────────────

  describe('getModule', () => {
    it('returns null when module is not stored', () => {
      expect(localStorageManager.getModule('drugs')).toBeNull()
    })

    it('returns module data when stored', () => {
      localStorage.setItem(`${STORAGE_PREFIX}drugs`, JSON.stringify({ name: 'drugs' }))
      expect(localStorageManager.getModule('drugs')).toEqual({ name: 'drugs' })
    })
  })

  describe('setModule', () => {
    it('stores module data and updates meta modulesLoaded', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)

      localStorageManager.setModule('drugs', { items: [] })
      expect(localStorageManager.getModule('drugs')).toEqual({ items: [] })

      const updatedMeta = localStorageManager.getMeta()!
      expect(updatedMeta.modulesLoaded).toContain('drugs')
    })

    it('does not duplicate module in modulesLoaded if already present', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: ['drugs'],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)

      localStorageManager.setModule('drugs', { items: [] })
      const updatedMeta = localStorageManager.getMeta()!
      expect(updatedMeta.modulesLoaded.filter((m) => m === 'drugs')).toHaveLength(1)
    })

    it('handles case where meta does not exist', () => {
      localStorageManager.setModule('labs', { items: [] })
      expect(localStorageManager.getModule('labs')).toEqual({ items: [] })
    })
  })

  describe('isModuleLoaded', () => {
    it('returns false when no meta exists', () => {
      expect(localStorageManager.isModuleLoaded('drugs')).toBe(false)
    })

    it('returns false when module is not in modulesLoaded', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      expect(localStorageManager.isModuleLoaded('drugs')).toBe(false)
    })

    it('returns true when module is in modulesLoaded', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: ['drugs'],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      expect(localStorageManager.isModuleLoaded('drugs')).toBe(true)
    })
  })

  describe('getLoadedModules', () => {
    it('returns empty array when no meta', () => {
      expect(localStorageManager.getLoadedModules()).toEqual([])
    })

    it('returns modulesLoaded from meta', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: ['drugs', 'labs'],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      expect(localStorageManager.getLoadedModules()).toEqual(['drugs', 'labs'])
    })
  })

  describe('getMissingModules', () => {
    it('returns all STATIC_MODULES when none loaded', () => {
      expect(localStorageManager.getMissingModules()).toEqual([...STATIC_MODULES])
    })

    it('returns only modules not in modulesLoaded', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [...STATIC_MODULES].slice(0, -1),
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      const missing = localStorageManager.getMissingModules()
      expect(missing).toHaveLength(1)
      expect(missing[0]).toBe(STATIC_MODULES[STATIC_MODULES.length - 1])
    })

    it('returns empty array when all modules loaded', () => {
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [...STATIC_MODULES],
        phase1Complete: true, phase2Complete: true,
      }
      localStorageManager.setMeta(meta)
      expect(localStorageManager.getMissingModules()).toEqual([])
    })
  })

  // ── Search ───────────────────────────────────────────────────

  describe('search', () => {
    it('returns empty array when no matching entries', () => {
      expect(localStorageManager.search('nothing')).toEqual([])
    })

    it('matches by key name', () => {
      localStorageManager.set('pharma-drugs', { name: 'Pharmacology' })
      const results = localStorageManager.search('pharma')
      expect(results).toHaveLength(1)
      expect(results[0].key).toBe('pharma-drugs')
    })

    it('matches by value content (deep search)', () => {
      localStorageManager.set('topic1', { description: 'Aspirin is important' })
      const results = localStorageManager.search('aspirin')
      expect(results).toHaveLength(1)
      expect(results[0].key).toBe('topic1')
    })

    it('is case insensitive', () => {
      localStorageManager.set('mymod', { name: 'Test' })
      expect(localStorageManager.search('MYMOD')).toHaveLength(1)
    })

    it('does not match non-prefixed keys', () => {
      localStorage.setItem('other-key', JSON.stringify({ data: 'test search term' }))
      expect(localStorageManager.search('search term')).toEqual([])
    })
  })

  // ── getAllKeys ────────────────────────────────────────────────

  describe('getAllKeys', () => {
    it('returns empty array when no prefixed keys', () => {
      localStorage.setItem('unrelated', 'value')
      expect(localStorageManager.getAllKeys()).toEqual([])
    })

    it('returns keys with prefix stripped', () => {
      localStorageManager.set('a', {})
      localStorageManager.set('b', {})
      const keys = localStorageManager.getAllKeys()
      expect(keys).toContain('a')
      expect(keys).toContain('b')
      expect(keys).toHaveLength(2)
    })
  })

  // ── Utilities ────────────────────────────────────────────────

  describe('getStorageUsage', () => {
    it('returns usage metrics', () => {
      localStorageManager.set('test', { data: 'hello' })
      const usage = localStorageManager.getStorageUsage()
      expect(usage.used).toBeGreaterThan(0)
      expect(usage.total).toBe(5 * 1024 * 1024)
      expect(usage.percentage).toBeGreaterThan(0)
      expect(usage.percentage).toBeLessThan(100)
    })

    it('returns zero usage for empty storage', () => {
      const usage = localStorageManager.getStorageUsage()
      expect(usage.used).toBe(0)
      expect(usage.percentage).toBe(0)
    })
  })

  describe('clearAll', () => {
    it('removes all prefixed keys and meta key', () => {
      localStorageManager.set('a', {})
      localStorageManager.set('b', {})
      const meta: DBMeta = {
        version: 1, initializedAt: '', modulesLoaded: [],
        phase1Complete: false, phase2Complete: false,
      }
      localStorageManager.setMeta(meta)
      localStorage.setItem('unrelated', 'keep')

      localStorageManager.clearAll()

      expect(localStorage.getItem(`${STORAGE_PREFIX}a`)).toBeNull()
      expect(localStorage.getItem(`${STORAGE_PREFIX}b`)).toBeNull()
      expect(localStorage.getItem(META_KEY)).toBeNull()
      expect(localStorage.getItem('unrelated')).toBe('keep')
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncQueue } from '../../services/sync-queue'
import { api } from '../../services/api'

// Mock the api module
vi.mock('../../services/api', () => ({
  api: {
    updateStats: vi.fn().mockResolvedValue({}),
    createFlag: vi.fn().mockResolvedValue({}),
    updateFlag: vi.fn().mockResolvedValue({}),
    deleteFlag: vi.fn().mockResolvedValue(undefined),
    appendHistory: vi.fn().mockResolvedValue({}),
  },
}))

const QUEUE_KEY = 'nclex:sync_queue'

describe('syncQueue', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  // ── getQueue ────────────────────────────────────────────────

  describe('getQueue', () => {
    it('returns empty array when nothing stored', () => {
      expect(syncQueue.getQueue()).toEqual([])
    })

    it('returns parsed queue from localStorage', () => {
      const items = [{ id: '1', type: 'stats_update', payload: {}, createdAt: '2026-01-01', retries: 0 }]
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
      expect(syncQueue.getQueue()).toEqual(items)
    })

    it('returns empty array when localStorage contains invalid JSON', () => {
      localStorage.setItem(QUEUE_KEY, 'not-json{{{')
      expect(syncQueue.getQueue()).toEqual([])
    })
  })

  // ── enqueue ─────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds item with correct shape', () => {
      syncQueue.enqueue('stats_update', { streak: 5 })
      const queue = syncQueue.getQueue()
      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({
        type: 'stats_update',
        payload: { streak: 5 },
        retries: 0,
      })
      expect(queue[0].id).toBeDefined()
      expect(queue[0].createdAt).toBeDefined()
    })

    it('appends to existing queue', () => {
      syncQueue.enqueue('stats_update', { a: 1 })
      syncQueue.enqueue('flag_create', { b: 2 })
      expect(syncQueue.getQueue()).toHaveLength(2)
    })
  })

  // ── flush ───────────────────────────────────────────────────

  describe('flush', () => {
    it('returns zero counts for empty queue', async () => {
      const result = await syncQueue.flush()
      expect(result).toEqual({ success: 0, failed: 0 })
    })

    it('processes all items successfully', async () => {
      syncQueue.enqueue('stats_update', { streak: 5 })
      syncQueue.enqueue('history_append', { topic: 'test' })

      const result = await syncQueue.flush()
      expect(result).toEqual({ success: 2, failed: 0 })
      expect(syncQueue.getQueue()).toEqual([])
      expect(api.updateStats).toHaveBeenCalledWith({ streak: 5 })
      expect(api.appendHistory).toHaveBeenCalledWith({ topic: 'test' })
    })

    it('retries failed items with retries < MAX_RETRIES', async () => {
      vi.mocked(api.updateStats).mockRejectedValueOnce(new Error('network error'))
      syncQueue.enqueue('stats_update', { streak: 5 })

      const result = await syncQueue.flush()
      expect(result).toEqual({ success: 0, failed: 1 })

      const remaining = syncQueue.getQueue()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].retries).toBe(1)
    })

    it('drops items that have reached MAX_RETRIES (3)', async () => {
      // Manually set up an item with retries already at 2 (next failure = 3 = drop)
      const items = [{
        id: 'x',
        type: 'stats_update' as const,
        payload: {},
        createdAt: '2026-01-01',
        retries: 2,
      }]
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
      vi.mocked(api.updateStats).mockRejectedValueOnce(new Error('fail'))

      const result = await syncQueue.flush()
      expect(result).toEqual({ success: 0, failed: 1 })
      // Item is dropped because retries (3) >= MAX_RETRIES (3)
      expect(syncQueue.getQueue()).toHaveLength(0)
    })
  })

  // ── processItem ─────────────────────────────────────────────

  describe('processItem', () => {
    it('routes stats_update to api.updateStats', async () => {
      await syncQueue.processItem({ id: '1', type: 'stats_update', payload: { streak: 1 }, createdAt: '', retries: 0 })
      expect(api.updateStats).toHaveBeenCalledWith({ streak: 1 })
    })

    it('routes flag_create to api.createFlag', async () => {
      const payload = { topic: 'test', question: {}, category: 'REVIEW' }
      await syncQueue.processItem({ id: '2', type: 'flag_create', payload, createdAt: '', retries: 0 })
      expect(api.createFlag).toHaveBeenCalledWith(payload)
    })

    it('routes flag_update to api.updateFlag with extracted id', async () => {
      await syncQueue.processItem({ id: '3', type: 'flag_update', payload: { id: 'flag-1', category: 'HARD' }, createdAt: '', retries: 0 })
      expect(api.updateFlag).toHaveBeenCalledWith('flag-1', { category: 'HARD' })
    })

    it('routes flag_delete to api.deleteFlag', async () => {
      await syncQueue.processItem({ id: '4', type: 'flag_delete', payload: { id: 'flag-1' }, createdAt: '', retries: 0 })
      expect(api.deleteFlag).toHaveBeenCalledWith('flag-1')
    })

    it('routes history_append to api.appendHistory', async () => {
      await syncQueue.processItem({ id: '5', type: 'history_append', payload: { topic: 'test' }, createdAt: '', retries: 0 })
      expect(api.appendHistory).toHaveBeenCalledWith({ topic: 'test' })
    })

    it('logs warning for unknown type', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await syncQueue.processItem({ id: '6', type: 'unknown_type' as never, payload: {}, createdAt: '', retries: 0 })
      expect(warnSpy).toHaveBeenCalledWith('Unknown sync queue item type:', 'unknown_type')
      warnSpy.mockRestore()
    })
  })

  // ── clearQueue ──────────────────────────────────────────────

  describe('clearQueue', () => {
    it('removes queue from localStorage', () => {
      syncQueue.enqueue('stats_update', {})
      expect(syncQueue.getQueue()).toHaveLength(1)
      syncQueue.clearQueue()
      expect(syncQueue.getQueue()).toEqual([])
      expect(localStorage.getItem(QUEUE_KEY)).toBeNull()
    })
  })

  // ── getQueueLength ──────────────────────────────────────────

  describe('getQueueLength', () => {
    it('returns 0 for empty queue', () => {
      expect(syncQueue.getQueueLength()).toBe(0)
    })

    it('returns correct count', () => {
      syncQueue.enqueue('stats_update', {})
      syncQueue.enqueue('flag_create', {})
      expect(syncQueue.getQueueLength()).toBe(2)
    })
  })
})

import { api } from './api'
import { readerLog } from '../reader/readerLogger'
import type {
  BookmarkDTO,
  BookmarkSyncItem,
  HighlightDTO,
  HighlightSyncItem,
} from '../types'

// ──────────────────────────────────────────────
// Queue entry shape
// ──────────────────────────────────────────────

interface SyncQueueEntry {
  clientId: string
  action: 'upsert' | 'delete'
  contentKey: string
  data: Record<string, unknown>
  timestamp: string
  retries: number
}

// ──────────────────────────────────────────────
// Storage keys
// ──────────────────────────────────────────────

const BOOKMARK_QUEUE_KEY = 'nclex:bookmark_queue'
const HIGHLIGHT_QUEUE_KEY = 'nclex:highlight_queue'
const LAST_SYNC_KEY = 'nclex:last_annotation_sync'

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

function readQueue(key: string): SyncQueueEntry[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    return JSON.parse(raw) as SyncQueueEntry[]
  } catch (err) {
    readerLog.warn('sync.queue_read_failed', { key })
    return []
  }
}

function writeQueue(key: string, entries: SyncQueueEntry[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(entries))
    return true
  } catch (err) {
    readerLog.warn('sync.queue_write_failed', { key })
    return false
  }
}

function getLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch (err) {
    readerLog.warn('sync.last_sync_read_failed', { key: LAST_SYNC_KEY })
    return null
  }
}

function setLastSync(ts: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, ts)
  } catch (err) {
    readerLog.warn('sync.last_sync_write_failed', { key: LAST_SYNC_KEY })
  }
}

/**
 * Coalesce a new entry into the queue: if the same clientId already exists,
 * replace it; otherwise append.
 */
function coalesce(queue: SyncQueueEntry[], entry: SyncQueueEntry): SyncQueueEntry[] {
  const idx = queue.findIndex((e) => e.clientId === entry.clientId)
  if (idx >= 0) {
    const next = [...queue]
    next[idx] = entry
    return next
  }
  return [...queue, entry]
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

let activeSyncPromise: Promise<{ bookmarks: BookmarkDTO[]; highlights: HighlightDTO[] } | null> | null = null

export const annotationSync = {
  /**
   * Enqueue a bookmark change (upsert or delete).
   * Coalesces with any existing entry for the same clientId.
   */
  enqueueBookmark(
    action: 'upsert' | 'delete',
    bookmark: { clientId: string; contentKey: string; [key: string]: unknown },
  ): void {
    try {
      const entry: SyncQueueEntry = {
        clientId: bookmark.clientId,
        action,
        contentKey: bookmark.contentKey as string,
        data: bookmark as Record<string, unknown>,
        timestamp: new Date().toISOString(),
        retries: 0,
      }
      const queue = readQueue(BOOKMARK_QUEUE_KEY)
      const success = writeQueue(BOOKMARK_QUEUE_KEY, coalesce(queue, entry))
      if (!success) {
        readerLog.error('sync.enqueue_bookmark_failed', new Error('localStorage quota exceeded'), { clientId: bookmark.clientId })
      }
    } catch (err) {
      readerLog.error('sync.enqueue_bookmark_failed', err)
    }
  },

  /**
   * Enqueue a highlight change (upsert or delete).
   */
  enqueueHighlight(
    action: 'upsert' | 'delete',
    highlight: { id: string; contentKey: string; [key: string]: unknown },
  ): void {
    try {
      const entry: SyncQueueEntry = {
        clientId: highlight.id,
        action,
        contentKey: highlight.contentKey as string,
        data: highlight as Record<string, unknown>,
        timestamp: new Date().toISOString(),
        retries: 0,
      }
      const queue = readQueue(HIGHLIGHT_QUEUE_KEY)
      const success = writeQueue(HIGHLIGHT_QUEUE_KEY, coalesce(queue, entry))
      if (!success) {
        readerLog.error('sync.enqueue_highlight_failed', new Error('localStorage quota exceeded'), { id: highlight.id })
      }
    } catch (err) {
      readerLog.error('sync.enqueue_highlight_failed', err)
    }
  },

  /**
   * Push all queued changes to the server.
   * Successfully synced entries are removed from the queue.
   * Failed entries have their retry count incremented (dropped after 5 retries).
   */
  async pushChanges(): Promise<void> {
    const BATCH_SIZE = 500
    const bQueue = readQueue(BOOKMARK_QUEUE_KEY)
    const hQueue = readQueue(HIGHLIGHT_QUEUE_KEY)
    readerLog.info('sync.push_start', { bookmarkQueueSize: bQueue.length, highlightQueueSize: hQueue.length })

    // Push bookmarks
    try {
      if (bQueue.length > 0) {
        const items: BookmarkSyncItem[] = bQueue.map((e) => ({
          clientId: e.clientId,
          contentKey: e.contentKey,
          page: (e.data.page as number) ?? 0,
          label: (e.data.label as string) ?? '',
          action: e.action,
        }))
        try {
          // Chunk into batches of BATCH_SIZE to stay within server limits
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE)
            const result = await api.syncBookmarks(batch)
            if (result.serverTime) {
              setLastSync(result.serverTime)
            }
          }
          // Success — clear queue
          writeQueue(BOOKMARK_QUEUE_KEY, [])
          readerLog.info('sync.push_bookmarks_complete', { count: items.length })
        } catch (err) {
          readerLog.error('sync.push_bookmarks_failed', err)
          // Increment retries, drop entries that exceed max
          const updated = bQueue
            .map((e) => ({ ...e, retries: e.retries + 1 }))
            .filter((e) => e.retries <= 5)
          const dropped = bQueue.length - updated.length
          if (dropped > 0) {
            readerLog.warn('sync.entries_dropped', { type: 'bookmarks', dropped })
          }
          writeQueue(BOOKMARK_QUEUE_KEY, updated)
        }
      }
    } catch (err) {
      readerLog.error('sync.push_bookmarks_queue_failed', err)
    }

    // Push highlights
    try {
      if (hQueue.length > 0) {
        const items: HighlightSyncItem[] = hQueue.map((e) => ({
          clientId: e.clientId,
          contentKey: e.contentKey,
          color: (e.data.color as string) ?? 'yellow',
          text: (e.data.text as string) ?? '',
          note: (e.data.note as string) ?? '',
          startXpath: (e.data.startXpath as string) ?? '',
          startOffset: (e.data.startOffset as number) ?? 0,
          endXpath: (e.data.endXpath as string) ?? '',
          endOffset: (e.data.endOffset as number) ?? 0,
          action: e.action,
        }))
        try {
          // Chunk into batches of BATCH_SIZE to stay within server limits
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE)
            const result = await api.syncHighlights(batch)
            if (result.serverTime) {
              setLastSync(result.serverTime)
            }
          }
          writeQueue(HIGHLIGHT_QUEUE_KEY, [])
          readerLog.info('sync.push_highlights_complete', { count: items.length })
        } catch (err) {
          readerLog.error('sync.push_highlights_failed', err)
          const updated = hQueue
            .map((e) => ({ ...e, retries: e.retries + 1 }))
            .filter((e) => e.retries <= 5)
          const dropped = hQueue.length - updated.length
          if (dropped > 0) {
            readerLog.warn('sync.entries_dropped', { type: 'highlights', dropped })
          }
          writeQueue(HIGHLIGHT_QUEUE_KEY, updated)
        }
      }
    } catch (err) {
      readerLog.error('sync.push_highlights_queue_failed', err)
    }
  },

  /**
   * Pull changes from the server since last sync.
   * Returns the server data for the caller to merge into local state.
   */
  async pullChanges(
    _contentKey?: string,
  ): Promise<{ bookmarks: BookmarkDTO[]; highlights: HighlightDTO[] } | null> {
    try {
      const since = getLastSync()
      readerLog.info('sync.pull_start', { since, contentKey: _contentKey })
      if (since) {
        const result = await api.getAnnotationChanges(since)
        if (result.serverTime) {
          setLastSync(result.serverTime)
        }
        readerLog.info('sync.pull_complete', { bookmarks: result.bookmarks.length, highlights: result.highlights.length })
        return { bookmarks: result.bookmarks, highlights: result.highlights }
      } else {
        // First sync — pull everything (optionally scoped by contentKey)
        const beforeFetch = new Date().toISOString()
        const [bookmarks, highlights] = await Promise.all([
          api.getBookmarks(_contentKey),
          api.getHighlights(_contentKey),
        ])
        setLastSync(beforeFetch)
        readerLog.info('sync.pull_complete', { bookmarks: bookmarks.length, highlights: highlights.length })
        return { bookmarks, highlights }
      }
    } catch (err) {
      readerLog.error('sync.pull_failed', err)
      return null
    }
  },

  /**
   * Full sync: push local changes first, then pull server changes.
   * Uses a lock to prevent concurrent syncs from racing.
   */
  async fullSync(
    contentKey?: string,
  ): Promise<{ bookmarks: BookmarkDTO[]; highlights: HighlightDTO[] } | null> {
    if (activeSyncPromise) {
      readerLog.info('sync.deduplicated')
      return activeSyncPromise
    }
    activeSyncPromise = this._doFullSync(contentKey)
    try {
      return await activeSyncPromise
    } finally {
      activeSyncPromise = null
    }
  },

  async _doFullSync(
    contentKey?: string,
  ): Promise<{ bookmarks: BookmarkDTO[]; highlights: HighlightDTO[] } | null> {
    readerLog.info('sync.full_start', { contentKey })
    try {
      await this.pushChanges()
      const result = await this.pullChanges(contentKey)
      readerLog.info('sync.full_complete', { contentKey })
      return result
    } catch (err) {
      readerLog.error('sync.full_failed', err)
      return null
    }
  },
}

import { useState, useCallback, useEffect, useRef } from 'react'
import { annotationSync } from '../services/annotation-sync'
import { readerLog } from '../reader/readerLogger'
import type { BookmarkDTO } from '../types'

export interface Bookmark {
  clientId: string
  page: number // 1-indexed
  label: string
  createdAt: string
  updatedAt: string
}

function loadFromStorage(contentKey: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(`reader-bookmarks-${contentKey}`)
    if (!raw) return []
    return JSON.parse(raw) as Bookmark[]
  } catch (err) {
    readerLog.warn('bookmarks.load_failed', { contentKey, error: String(err) })
    return []
  }
}

function saveToStorage(contentKey: string, bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(
      `reader-bookmarks-${contentKey}`,
      JSON.stringify(bookmarks),
    )
  } catch (err) {
    readerLog.warn('bookmarks.save_failed', { contentKey, error: String(err) })
  }
}

function generateClientId(): string {
  return `bk-${crypto.randomUUID()}`
}

/**
 * Merge server bookmarks into local state.
 * - Server items with newer updatedAt win over local items with same clientId.
 * - New server items are added.
 * - Server items marked deleted are removed locally.
 */
function mergeBookmarks(local: Bookmark[], serverItems: BookmarkDTO[]): Bookmark[] {
  const merged = new Map<string, Bookmark>()

  // Index local by clientId
  for (const bm of local) {
    merged.set(bm.clientId, bm)
  }

  for (const srv of serverItems) {
    if (srv.deletedAt) {
      // Remove locally if server says deleted
      merged.delete(srv.clientId)
      continue
    }

    const existing = merged.get(srv.clientId)
    if (!existing || new Date(srv.updatedAt) >= new Date(existing.updatedAt)) {
      // Server is newer or item is new — use server version
      merged.set(srv.clientId, {
        clientId: srv.clientId,
        page: srv.page,
        label: srv.label ?? '',
        createdAt: srv.createdAt,
        updatedAt: srv.updatedAt,
      })
    }
  }

  return Array.from(merged.values())
}

export function useBookmarks(contentKey: string) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const bookmarksRef = useRef<Bookmark[]>([])

  bookmarksRef.current = bookmarks

  const persist = useCallback(
    (next: Bookmark[]) => {
      setBookmarks(next)
      bookmarksRef.current = next
      saveToStorage(contentKey, next)
    },
    [contentKey],
  )

  // Load from localStorage on mount, then sync with server in background
  useEffect(() => {
    const loaded = loadFromStorage(contentKey)
    setBookmarks(loaded)
    bookmarksRef.current = loaded

    // Background server sync
    if (navigator.onLine) {
      annotationSync.fullSync(contentKey).then((result) => {
        if (result && result.bookmarks.length > 0) {
          const current = loadFromStorage(contentKey) // re-read in case of concurrent writes
          const merged = mergeBookmarks(current, result.bookmarks)
          readerLog.info('bookmarks.merged', { localCount: current.length, serverCount: result.bookmarks.length, mergedCount: merged.length })
          setBookmarks(merged)
          bookmarksRef.current = merged
          saveToStorage(contentKey, merged)
        }
      }).catch(err => readerLog.warn('bookmarks.sync_failed', { error: String(err) }))
    }
  }, [contentKey])

  // Listen for online event to trigger sync
  useEffect(() => {
    const handleOnline = () => {
      annotationSync.fullSync(contentKey).then((result) => {
        if (result && result.bookmarks.length > 0) {
          const current = loadFromStorage(contentKey)
          const merged = mergeBookmarks(current, result.bookmarks)
          readerLog.info('bookmarks.merged', { localCount: current.length, serverCount: result.bookmarks.length, mergedCount: merged.length })
          setBookmarks(merged)
          bookmarksRef.current = merged
          saveToStorage(contentKey, merged)
        }
      }).catch(err => readerLog.warn('bookmarks.sync_failed', { error: String(err) }))
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [contentKey])

  const toggleBookmark = useCallback(
    (page: number, textSnippet?: string) => {
      const existing = bookmarksRef.current.find((b) => b.page === page)
      if (existing) {
        // Remove bookmark
        const next = bookmarksRef.current.filter((b) => b.page !== page)
        persist(next)
        readerLog.info('bookmark.deleted', { page })
        annotationSync.enqueueBookmark('delete', {
          clientId: existing.clientId,
          contentKey,
          page: existing.page,
          label: existing.label,
          updatedAt: new Date().toISOString(),
        })
      } else {
        // Add bookmark
        const now = new Date().toISOString()
        const label = textSnippet
          ? textSnippet.substring(0, 80)
          : `Page ${page}`
        const bm: Bookmark = {
          clientId: generateClientId(),
          page,
          label,
          createdAt: now,
          updatedAt: now,
        }
        persist([...bookmarksRef.current, bm])
        readerLog.info('bookmark.created', { clientId: bm.clientId, page })
        annotationSync.enqueueBookmark('upsert', {
          clientId: bm.clientId,
          contentKey,
          page: bm.page,
          label: bm.label,
          updatedAt: bm.updatedAt,
        })
      }
    },
    [persist, contentKey],
  )

  const isBookmarked = useCallback(
    (page: number): boolean => {
      return bookmarks.some((b) => b.page === page)
    },
    [bookmarks],
  )

  const removeBookmark = useCallback(
    (page: number) => {
      const existing = bookmarksRef.current.find((b) => b.page === page)
      persist(bookmarksRef.current.filter((b) => b.page !== page))
      readerLog.info('bookmark.deleted', { page })
      if (existing) {
        annotationSync.enqueueBookmark('delete', {
          clientId: existing.clientId,
          contentKey,
          page: existing.page,
          label: existing.label,
          updatedAt: new Date().toISOString(),
        })
      }
    },
    [persist, contentKey],
  )

  return {
    bookmarks,
    toggleBookmark,
    isBookmarked,
    removeBookmark,
  }
}

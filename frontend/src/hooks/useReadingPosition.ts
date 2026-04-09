import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import { readerLog } from '../reader/readerLogger'

const POSITION_SAVE_DEBOUNCE_MS = 1500

export interface UseReadingPositionOptions {
  contentKey: string
  currentPage: number
  totalPages: number
  flipTo: (page: number) => void
}

export function useReadingPosition({
  contentKey,
  currentPage,
  totalPages,
  flipTo,
}: UseReadingPositionOptions) {
  const [positionRestored, setPositionRestored] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Restore reading position from API ---
  useEffect(() => {
    if (totalPages <= 0 || positionRestored) return

    let cancelled = false
    api
      .getReadingPosition(contentKey)
      .then((pos) => {
        if (cancelled || !pos) return
        const saved = pos.position as { page?: number }
        if (typeof saved?.page === 'number' && saved.page >= 0) {
          flipTo(saved.page)
          readerLog.info('reading_position.restored', {
            contentKey,
            page: saved.page,
          })
        }
      })
      .catch((err) => {
        readerLog.error('reading_position.restore_failed', err, { contentKey })
      })
      .finally(() => {
        if (!cancelled) setPositionRestored(true)
      })

    return () => {
      cancelled = true
    }
  }, [contentKey, totalPages, positionRestored, flipTo])

  // --- Auto-save position with debounce ---
  useEffect(() => {
    if (!positionRestored || totalPages <= 0) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      api
        .setReadingPosition(contentKey, { page: currentPage, totalPages })
        .then(() => {
          readerLog.debug('reading_position.saved', {
            contentKey,
            page: currentPage,
            totalPages,
          })
        })
        .catch((err) => {
          readerLog.error('reading_position.save_failed', err, {
            contentKey,
            page: currentPage,
          })
        })
    }, POSITION_SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [currentPage, totalPages, contentKey, positionRestored])
}

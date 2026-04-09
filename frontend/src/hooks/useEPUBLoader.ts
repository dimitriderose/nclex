import { useCallback, useEffect, useState } from 'react'
import { parseEpub } from '../reader/epubParser'
import { readerLog } from '../reader/readerLogger'

const WORDS_PER_MINUTE = 238

function estimateReadingTime(text: string): string {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.ceil(wordCount / WORDS_PER_MINUTE)
  if (minutes < 1) return '~1 min read'
  return `~${minutes} min read`
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

export interface UseEPUBLoaderResult {
  html: string
  loading: boolean
  error: string | null
  readingTime: string | undefined
  handleRetry: () => void
}

export function useEPUBLoader(epubUrl: string, contentKey: string): UseEPUBLoaderResult {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readingTime, setReadingTime] = useState<string | undefined>(undefined)
  const [retryCount, setRetryCount] = useState(0)

  const loadEpub = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(epubUrl, { signal })
        if (!response.ok) {
          readerLog.error('book.fetch_failed', new Error('HTTP ' + response.status), { epubUrl })
          throw new Error(`Failed to fetch EPUB (${response.status})`)
        }
        const contentLength = parseInt(response.headers.get('content-length') || '0')
        if (contentLength > 200 * 1024 * 1024) {
          readerLog.error('book.too_large', new Error('File too large'), { contentLength })
          throw new Error('This book is too large to open (max 200 MB)')
        }
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 200 * 1024 * 1024) {
          readerLog.error('book.too_large', new Error('File too large'), { size: buffer.byteLength })
          throw new Error('This book is too large to open (max 200 MB)')
        }
        const result = await parseEpub(buffer)
        if (signal.aborted) return

        setHtml(result.html)
        readerLog.info('book.opened', { contentKey, title: result.title })
        setReadingTime(estimateReadingTime(stripHtmlTags(result.html)))
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message =
          err instanceof Error ? err.message : 'Unknown error loading book'
        readerLog.error('book.load_failed', err, { epubUrl, contentKey })
        setError(message)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [epubUrl, contentKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadEpub(controller.signal)
    return () => controller.abort()
  }, [loadEpub, retryCount])

  const handleRetry = useCallback(() => {
    setRetryCount((c) => {
      readerLog.info('book.retry', { retryCount: c + 1 })
      return c + 1
    })
  }, [])

  return { html, loading, error, readingTime, handleRetry }
}

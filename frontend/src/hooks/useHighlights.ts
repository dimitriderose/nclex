import { useState, useCallback, useRef, useEffect } from 'react'
import { annotationSync } from '../services/annotation-sync'
import { readerLog } from '../reader/readerLogger'
import type { HighlightDTO } from '../types'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface Highlight {
  id: string
  color: 'yellow' | 'green' | 'blue' | 'pink'
  text: string
  note: string
  startXpath: string
  startOffset: number
  endXpath: string
  endOffset: number
  createdAt: string
  updatedAt: string
}

type HighlightColor = Highlight['color']

// ──────────────────────────────────────────────
// XPath utilities (ported from highlight-manager.js)
// ──────────────────────────────────────────────

function getXPath(node: Node, root: Node): string {
  if (node === root) return ''
  const parts: string[] = []
  let current: Node | null = node
  while (current && current !== root) {
    let index = 1
    let sibling = current.previousSibling
    while (sibling) {
      if (
        sibling.nodeType === current.nodeType &&
        sibling.nodeName === current.nodeName
      ) {
        index++
      }
      sibling = sibling.previousSibling
    }
    parts.unshift(current.nodeName.toLowerCase() + '[' + index + ']')
    current = current.parentNode
  }
  return '/' + parts.join('/')
}

export function resolveXPath(xpath: string, root: Node): Node | null {
  if (!xpath || xpath === '') return root
  const parts = xpath.split('/').filter(Boolean)
  let current: Node = root
  for (const part of parts) {
    const match = part.match(/^(.+)\[(\d+)\]$/)
    if (!match) return null
    const nodeName = match[1].toUpperCase()
    const targetIndex = parseInt(match[2])
    let index = 0
    let found: Node | null = null
    for (let i = 0; i < current.childNodes.length; i++) {
      const child = current.childNodes[i]
      if (
        child.nodeName === nodeName ||
        (child.nodeType === 3 && nodeName === '#TEXT')
      ) {
        index++
        if (index === targetIndex) {
          found = child
          break
        }
      }
    }
    if (!found) return null
    current = found
  }
  return current
}

// ──────────────────────────────────────────────
// Range serialization
// ──────────────────────────────────────────────

function serializeRange(
  range: Range,
  root: HTMLElement,
): {
  startXpath: string
  startOffset: number
  endXpath: string
  endOffset: number
  text: string
} {
  return {
    startXpath: getXPath(range.startContainer, root),
    startOffset: range.startOffset,
    endXpath: getXPath(range.endContainer, root),
    endOffset: range.endOffset,
    text: range.toString(),
  }
}

function deserializeRange(
  highlight: Highlight,
  root: HTMLElement,
): Range | null {
  const startNode = resolveXPath(highlight.startXpath, root)
  const endNode = resolveXPath(highlight.endXpath, root)
  if (!startNode || !endNode) return null

  try {
    const range = document.createRange()
    range.setStart(startNode, highlight.startOffset)
    range.setEnd(endNode, highlight.endOffset)
    return range
  } catch (err) {
    readerLog.warn('highlights.deserialize_failed', { id: highlight.id, error: String(err) })
    return null
  }
}

// ──────────────────────────────────────────────
// DOM mark application (ported from highlight-manager.js)
// ──────────────────────────────────────────────

function applyHighlightMarks(
  range: Range,
  color: HighlightColor,
  highlightId: string,
): void {
  if (!range) return

  const textNodes: Node[] = []
  const ancestor =
    range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentNode!
      : range.commonAncestorContainer

  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null)

  let inRange = false
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node === range.startContainer) inRange = true
    if (inRange) textNodes.push(node)
    if (node === range.endContainer) break
  }

  // Single text node case
  if (textNodes.length === 0 && range.startContainer.nodeType === 3) {
    textNodes.push(range.startContainer)
  }

  for (const textNode of textNodes) {
    const mark = document.createElement('mark')
    mark.className = 'user-highlight'
    mark.dataset.highlightId = highlightId
    mark.dataset.highlightColor = color

    let start = 0
    let end = textNode.textContent?.length ?? 0

    if (textNode === range.startContainer) start = range.startOffset
    if (textNode === range.endContainer) end = range.endOffset

    if (start > 0) {
      ;(textNode as Text).splitText(start)
      const newTextNode = textNode.nextSibling as Text
      if (end - start < (newTextNode.textContent?.length ?? 0)) {
        newTextNode.splitText(end - start)
      }
      newTextNode.parentNode!.insertBefore(mark, newTextNode)
      mark.appendChild(newTextNode)
    } else if (end < (textNode.textContent?.length ?? 0)) {
      ;(textNode as Text).splitText(end)
      textNode.parentNode!.insertBefore(mark, textNode)
      mark.appendChild(textNode)
    } else {
      textNode.parentNode!.insertBefore(mark, textNode)
      mark.appendChild(textNode)
    }
  }
}

function removeHighlightMarks(highlightId: string, root: HTMLElement): void {
  const marks = root.querySelectorAll(
    `mark.user-highlight[data-highlight-id="${CSS.escape(highlightId)}"]`,
  )
  marks.forEach((mark) => {
    const parent = mark.parentNode!
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark)
    }
    parent.removeChild(mark)
    parent.normalize()
  })
}

// ──────────────────────────────────────────────
// localStorage helpers
// ──────────────────────────────────────────────

function loadFromStorage(contentKey: string): Highlight[] {
  try {
    const raw = localStorage.getItem(`reader-highlights-${contentKey}`)
    if (!raw) return []
    return JSON.parse(raw) as Highlight[]
  } catch (err) {
    readerLog.warn('highlights.load_failed', { contentKey, error: String(err) })
    return []
  }
}

function saveToStorage(contentKey: string, highlights: Highlight[]): void {
  try {
    localStorage.setItem(
      `reader-highlights-${contentKey}`,
      JSON.stringify(highlights),
    )
  } catch (err) {
    readerLog.warn('highlights.save_failed', { contentKey, error: String(err) })
  }
}

// ──────────────────────────────────────────────
// Merge helper
// ──────────────────────────────────────────────

/**
 * Merge server highlights into local state.
 * - Server items with newer updatedAt win over local items with same id/clientId.
 * - New server items are added.
 * - Server items marked deleted are removed locally.
 */
function mergeHighlights(local: Highlight[], serverItems: HighlightDTO[]): Highlight[] {
  const merged = new Map<string, Highlight>()

  // Index local by id (which serves as clientId)
  for (const hl of local) {
    merged.set(hl.id, hl)
  }

  for (const srv of serverItems) {
    if (srv.deletedAt) {
      merged.delete(srv.clientId)
      continue
    }

    const existing = merged.get(srv.clientId)
    if (!existing || new Date(srv.updatedAt) >= new Date(existing.updatedAt)) {
      merged.set(srv.clientId, {
        id: srv.clientId,
        color: srv.color as Highlight['color'],
        text: srv.text,
        note: srv.note ?? '',
        startXpath: srv.startXpath,
        startOffset: srv.startOffset,
        endXpath: srv.endXpath,
        endOffset: srv.endOffset,
        createdAt: srv.createdAt,
        updatedAt: srv.updatedAt,
      })
    }
  }

  return Array.from(merged.values())
}

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export function useHighlights(contentKey: string) {
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const highlightsRef = useRef<Highlight[]>([])

  // Keep ref in sync for DOM callbacks that may close over stale state
  highlightsRef.current = highlights

  const persist = useCallback(
    (next: Highlight[]) => {
      setHighlights(next)
      highlightsRef.current = next
      saveToStorage(contentKey, next)
    },
    [contentKey],
  )

  // Load from storage on mount / key change, then background sync
  useEffect(() => {
    const loaded = loadFromStorage(contentKey)
    setHighlights(loaded)
    highlightsRef.current = loaded

    if (navigator.onLine) {
      annotationSync.fullSync(contentKey).then((result) => {
        if (result && result.highlights.length > 0) {
          const current = loadFromStorage(contentKey)
          const merged = mergeHighlights(current, result.highlights)
          readerLog.info('highlights.merged', { localCount: current.length, serverCount: result.highlights.length, mergedCount: merged.length })
          setHighlights(merged)
          highlightsRef.current = merged
          saveToStorage(contentKey, merged)
        }
      }).catch(err => readerLog.warn('highlights.sync_failed', { error: String(err) }))
    }
  }, [contentKey])

  // Listen for online event to trigger sync
  useEffect(() => {
    const handleOnline = () => {
      annotationSync.fullSync(contentKey).then((result) => {
        if (result && result.highlights.length > 0) {
          const current = loadFromStorage(contentKey)
          const merged = mergeHighlights(current, result.highlights)
          readerLog.info('highlights.merged', { localCount: current.length, serverCount: result.highlights.length, mergedCount: merged.length })
          setHighlights(merged)
          highlightsRef.current = merged
          saveToStorage(contentKey, merged)
        }
      }).catch(err => readerLog.warn('highlights.sync_failed', { error: String(err) }))
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [contentKey])

  const addHighlight = useCallback(
    (range: Range, color: HighlightColor, root: HTMLElement) => {
      const serialized = serializeRange(range, root)
      const now = new Date().toISOString()
      const hl: Highlight = {
        id: `hl-${crypto.randomUUID()}`,
        color,
        text: serialized.text,
        note: '',
        startXpath: serialized.startXpath,
        startOffset: serialized.startOffset,
        endXpath: serialized.endXpath,
        endOffset: serialized.endOffset,
        createdAt: now,
        updatedAt: now,
      }

      applyHighlightMarks(range, color, hl.id)
      persist([...highlightsRef.current, hl])
      readerLog.info('highlight.created', { id: hl.id, color, textLength: serialized.text.length })

      annotationSync.enqueueHighlight('upsert', {
        id: hl.id,
        contentKey,
        color: hl.color,
        text: hl.text,
        note: hl.note,
        startXpath: hl.startXpath,
        startOffset: hl.startOffset,
        endXpath: hl.endXpath,
        endOffset: hl.endOffset,
        updatedAt: hl.updatedAt,
      })

      return hl
    },
    [persist, contentKey],
  )

  const removeHighlight = useCallback(
    (id: string, root?: HTMLElement) => {
      if (root) {
        removeHighlightMarks(id, root)
      }
      const existing = highlightsRef.current.find((h) => h.id === id)
      persist(highlightsRef.current.filter((h) => h.id !== id))
      readerLog.info('highlight.deleted', { id })

      if (existing) {
        annotationSync.enqueueHighlight('delete', {
          id: existing.id,
          contentKey,
          color: existing.color,
          text: existing.text,
          note: existing.note,
          startXpath: existing.startXpath,
          startOffset: existing.startOffset,
          endXpath: existing.endXpath,
          endOffset: existing.endOffset,
          updatedAt: new Date().toISOString(),
        })
      }
    },
    [persist, contentKey],
  )

  const updateNote = useCallback(
    (id: string, note: string) => {
      const now = new Date().toISOString()
      const updated = highlightsRef.current.map((h) =>
        h.id === id ? { ...h, note, updatedAt: now } : h,
      )
      persist(updated)
      readerLog.info('highlight.note_updated', { id })

      const hl = updated.find((h) => h.id === id)
      if (hl) {
        annotationSync.enqueueHighlight('upsert', {
          id: hl.id,
          contentKey,
          color: hl.color,
          text: hl.text,
          note: hl.note,
          startXpath: hl.startXpath,
          startOffset: hl.startOffset,
          endXpath: hl.endXpath,
          endOffset: hl.endOffset,
          updatedAt: hl.updatedAt,
        })
      }
    },
    [persist, contentKey],
  )

  const renderHighlights = useCallback((root: HTMLElement) => {
    // Clear existing marks first
    const existing = root.querySelectorAll('mark.user-highlight')
    existing.forEach((mark) => {
      const parent = mark.parentNode!
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark)
      }
      parent.removeChild(mark)
    })
    root.normalize()

    // First: resolve all ranges against clean DOM
    const resolved = highlightsRef.current
      .map(hl => ({ hl, range: deserializeRange(hl, root) }))
      .filter((r): r is { hl: Highlight; range: Range } => r.range !== null)

    const failed = highlightsRef.current.length - resolved.length
    const total = highlightsRef.current.length
    if (failed > 0) {
      readerLog.warn('highlights.render_stale', { failed, total })
    }

    // Then: apply marks (DOM mutations happen here but all ranges are already resolved)
    for (const { hl, range } of resolved) {
      applyHighlightMarks(range, hl.color, hl.id)
    }
  }, [])

  const clearMarks = useCallback((root: HTMLElement) => {
    const marks = root.querySelectorAll('mark.user-highlight')
    marks.forEach((mark) => {
      const parent = mark.parentNode!
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark)
      }
      parent.removeChild(mark)
    })
    root.normalize()
  }, [])

  return {
    highlights,
    addHighlight,
    removeHighlight,
    updateNote,
    renderHighlights,
    clearMarks,
  }
}

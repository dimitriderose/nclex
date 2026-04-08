/**
 * epubParser.ts — EPUB parser for the NCLEX study app.
 *
 * Ported from reader-app/src/js/reader.js (lines 55-246).
 * Takes an ArrayBuffer (EPUB file), extracts chapters via JSZip,
 * converts embedded images to base64 data URIs, sanitizes the HTML
 * with DOMPurify, and returns { title, html }.
 */

import JSZip from 'jszip'
import DOMPurify from 'dompurify'
import { readerLog } from './readerLogger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedEpub {
  title: string
  html: string
}

interface ManifestItem {
  href: string
  mediaType: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a relative path (e.g. "../images/foo.png") against a base directory.
 */
function resolveRelativePath(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel.substring(1)
  const parts = base.split('/').filter(Boolean)
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/**
 * Convert an ArrayBuffer to a base64 string.
 *
 * Uses a chunked approach to avoid call-stack overflow on large buffers
 * (the naive per-byte String.fromCharCode blows up around ~500 KB).
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000 // 32 KB chunks
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** HTML-entity-encode a string for safe use in an HTML attribute. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Map common image extensions to MIME types. */
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

// ---------------------------------------------------------------------------
// DOMPurify configuration
// ---------------------------------------------------------------------------

/**
 * Allow <img> with data: URIs (needed for embedded images) while stripping
 * scripts, iframes, event handlers, and javascript: URIs.
 */
const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'base'],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: ['img'],
  ADD_ATTR: ['src', 'alt', 'class', 'href', 'id', 'data-epub-src'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|data|mailto):|[^:]*$)/i,
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Strip data: URIs from non-IMG tags (prevent data-URI abuse)
  if (node.tagName !== 'IMG') {
    const src = node.getAttribute('src') || node.getAttribute('href') || ''
    if (src.startsWith('data:')) {
      node.removeAttribute('src')
      node.removeAttribute('href')
    }
  }

  // Force all links to open in a new tab with noopener to prevent phishing
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse an EPUB file from an ArrayBuffer and return sanitized HTML.
 *
 * @throws {Error} With descriptive messages for:
 *   - Corrupt / non-ZIP files
 *   - Adobe DRM-protected EPUBs
 *   - Missing container.xml or OPF
 *   - EPUBs with no extractable chapters
 */
export async function parseEpub(arrayBuffer: ArrayBuffer): Promise<ParsedEpub> {
  const t0 = performance.now()
  readerLog.info('epub.parse.start', { bytes: arrayBuffer.byteLength })

  // ---- Unzip ----
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(arrayBuffer)
  } catch (err) {
    readerLog.error('epub.parse.zip_failed', err)
    throw new Error(
      'This file does not appear to be a valid EPUB. It may be corrupt or in an unsupported format.',
    )
  }

  // ---- DRM detection (Adobe only — LCP not needed for CC-BY books) ----
  if (zip.file('META-INF/rights.xml')) {
    readerLog.warn('epub.parse.drm_detected', { type: 'Adobe' })
    throw new Error(
      'This EPUB is protected by Adobe DRM and cannot be opened. ' +
        'Please use a DRM-free version of this book.',
    )
  }

  // ---- Parse container.xml -> find OPF path ----
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) {
    readerLog.warn('epub.parse.missing_container')
    throw new Error('Invalid EPUB: missing META-INF/container.xml')
  }
  const containerXml = await containerFile.async('text')
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
  const rootfile = containerDoc.querySelector('rootfile')
  const opfPath = rootfile?.getAttribute('full-path')
  if (!opfPath) {
    readerLog.warn('epub.parse.missing_rootfile')
    throw new Error('Invalid EPUB: no rootfile found in container.xml')
  }

  // OPF directory — chapter hrefs are relative to this
  const opfDir = opfPath.includes('/')
    ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
    : ''

  // ---- Parse OPF -> manifest + spine + metadata ----
  const opfFile = zip.file(opfPath)
  if (!opfFile) {
    readerLog.warn('epub.parse.missing_opf', { opfPath })
    throw new Error(`Invalid EPUB: missing OPF file at ${opfPath}`)
  }
  const opfXml = await opfFile.async('text')
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')

  // Title
  const titleEl =
    opfDoc.querySelector('metadata title') ??
    opfDoc.querySelector('dc\\:title, title')
  const title = titleEl?.textContent?.trim() ?? 'Untitled'

  // Manifest: id -> { href, mediaType }
  const manifest: Record<string, ManifestItem> = {}
  opfDoc.querySelectorAll('manifest item').forEach((item) => {
    const id = item.getAttribute('id')
    if (id) {
      manifest[id] = {
        href: item.getAttribute('href') ?? '',
        mediaType: item.getAttribute('media-type') ?? '',
      }
    }
  })

  // Spine: ordered list of idref
  const spine: string[] = []
  opfDoc.querySelectorAll('spine itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref')
    if (idref) spine.push(idref)
  })

  readerLog.info('epub.parse.metadata', {
    title,
    manifestItems: Object.keys(manifest).length,
    spineItems: spine.length,
  })

  // ---- Read and process chapters ----
  const chapters: Array<{ href: string; html: string }> = []

  for (const idref of spine) {
    const item = manifest[idref]
    if (!item) continue
    const { mediaType } = item
    if (!mediaType.includes('html') && !mediaType.includes('xml')) continue

    const chapterPath = opfDir + item.href
    const chapterFile = zip.file(chapterPath)
    if (!chapterFile) continue

    const chapterHtml = await chapterFile.async('text')
    const doc = new DOMParser().parseFromString(chapterHtml, 'application/xhtml+xml')
    const body = doc.querySelector('body')
    if (!body || !body.innerHTML.trim()) continue

    // Convert images: replace relative src with base64 data URIs
    const images = body.querySelectorAll('img')
    for (const img of images) {
      const src = img.getAttribute('src')
      if (!src || src.startsWith('data:')) continue

      const chapterDir = chapterPath.includes('/')
        ? chapterPath.substring(0, chapterPath.lastIndexOf('/') + 1)
        : opfDir
      const imgPath = resolveRelativePath(chapterDir, src)

      try {
        const imgFile = zip.file(imgPath)
        if (!imgFile) {
          readerLog.warn('epub.parse.image_missing', { imgPath, chapter: item.href })
          continue
        }
        const imgData = await imgFile.async('uint8array')
        const ext = src.split('.').pop()?.toLowerCase() ?? ''
        const mime = IMAGE_MIME[ext] ?? 'image/png'
        const b64 = arrayBufferToBase64(imgData.buffer.slice(imgData.byteOffset, imgData.byteOffset + imgData.byteLength))
        img.setAttribute('src', `data:${mime};base64,${b64}`)
      } catch (err) {
        // Skip individual image failures — don't crash the whole book
        readerLog.warn('epub.parse.image_failed', {
          imgPath,
          chapter: item.href,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    chapters.push({ href: item.href, html: body.innerHTML })
  }

  if (chapters.length === 0) {
    readerLog.warn('epub.parse.no_content', { spineItems: spine.length })
    throw new Error(
      'Could not extract any readable content from this EPUB. ' +
        'The file may be empty or use an unsupported format.',
    )
  }

  // ---- Assemble and sanitize ----
  const rawHtml = chapters
    .map(
      (ch) =>
        `<div class="epub-chapter" data-epub-src="${escapeAttr(ch.href)}">${ch.html}</div>`,
    )
    .join('\n')

  const sanitizedHtml = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG)

  if (sanitizedHtml.length !== rawHtml.length) {
    readerLog.warn('epub.parse.content_sanitized', { removedBytes: rawHtml.length - sanitizedHtml.length, title })
  }

  readerLog.info('epub.parse.complete', {
    title,
    chapters: chapters.length,
    rawLength: rawHtml.length,
    sanitizedLength: sanitizedHtml.length,
    durationMs: Math.round(performance.now() - t0),
  })

  return { title, html: sanitizedHtml }
}

/**
 * Bundled content indexer — downloads bundled-content.json,
 * verifies SHA-256 integrity, and writes all chapters to IndexedDB.
 * Runs once on first device setup (Phase 2).
 */

import { indexedDBStore } from './indexeddb-store';

const BUNDLED_CONTENT_SHA256 = import.meta.env.VITE_BUNDLED_CONTENT_SHA256 as string;

interface BookData {
  title: string;
  source: string;
  source_url: string;
  ncbi_url: string;
  chapters: { title: string; text: string }[];
  chapter_count: number;
  total_chars: number;
}

interface BundledContent {
  openrn: Record<string, BookData>;
  openstax: { ngn: Record<string, BookData> };
}

export async function indexBundledContent(
  onProgress: (msg: string) => void
): Promise<void> {
  onProgress('Downloading textbook content...');

  const res = await fetch('/bundled-content.json');
  if (!res.ok) throw new Error(`Failed to fetch bundled-content.json: ${res.status}`);

  const buffer = await res.arrayBuffer();

  // Verify integrity before writing to IndexedDB
  if (BUNDLED_CONTENT_SHA256) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (hashHex !== BUNDLED_CONTENT_SHA256) {
      throw new Error(
        `bundled-content.json integrity check failed. Expected: ${BUNDLED_CONTENT_SHA256} Got: ${hashHex}`
      );
    }
  }

  const bundled: BundledContent = JSON.parse(new TextDecoder().decode(buffer));
  const entries: { key: string; data: Record<string, unknown> }[] = [];
  const ts = new Date().toISOString();

  // OpenRN books
  for (const [bookKey, book] of Object.entries(bundled.openrn ?? {})) {
    for (let i = 0; i < book.chapters.length; i++) {
      const ch = book.chapters[i];
      entries.push({
        key: `openrn:${bookKey}:ch${i}`,
        data: {
          title: ch.title,
          content: ch.text,
          chapter: i,
          bookTitle: book.title,
          source: book.source,
          source_url: book.source_url,
          ncbi_url: book.ncbi_url,
          indexedAt: ts,
        },
      });
    }
  }

  // OpenStax NGN books
  for (const [bookKey, book] of Object.entries(bundled.openstax?.ngn ?? {})) {
    for (let i = 0; i < book.chapters.length; i++) {
      const ch = book.chapters[i];
      entries.push({
        key: `openstax:${bookKey}:ch${i}`,
        data: {
          title: ch.title,
          content: ch.text,
          chapter: i,
          bookTitle: book.title,
          source: book.source,
          source_url: book.source_url,
          indexedAt: ts,
        },
      });
    }
  }

  onProgress(`Writing ${entries.length} chapters to your library...`);
  await indexedDBStore.bulkPut(entries);
  onProgress('Textbooks ready.');
}

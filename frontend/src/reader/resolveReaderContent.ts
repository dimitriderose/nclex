/**
 * Content Reader — resolves content from IndexedDB (offline) or
 * fetches full textbook pages from Pressbooks/NCBI on demand (online).
 */

import { indexedDBStore } from '../services/indexeddb-store';

export interface ReaderContent {
  title: string;
  pages: string[];
  source: string;
  url?: string;
  error?: string;
}

const ALLOWED_READER_DOMAINS = [
  'wtcs.pressbooks.pub',
  'www.ncbi.nlm.nih.gov',
  'dailymed.nlm.nih.gov',
  'medlineplus.gov',
  'nursing.umaryland.edu',
  'nclex.com',
  'ncsbn.org',
];

const OPENRN_READER_URLS: Record<string, string> = {
  pharmacology: 'https://wtcs.pressbooks.pub/pharmacology/',
  fundamentals: 'https://wtcs.pressbooks.pub/nursingfundamentals/',
  skills: 'https://wtcs.pressbooks.pub/nursingskills/',
  mentalhealth: 'https://wtcs.pressbooks.pub/nursingmhcc/',
  management: 'https://wtcs.pressbooks.pub/nursingmpc/',
  advancedskills: 'https://wtcs.pressbooks.pub/nursingadvancedskills/',
};

// Exported for potential direct use by components
export const OPENRN_NCBI_URLS: Record<string, string> = {
  pharmacology: 'https://www.ncbi.nlm.nih.gov/books/NBK595000/',
  fundamentals: 'https://www.ncbi.nlm.nih.gov/books/NBK610836/',
  skills: 'https://www.ncbi.nlm.nih.gov/books/NBK596735/',
  mentalhealth: 'https://www.ncbi.nlm.nih.gov/books/NBK617002/',
  management: 'https://www.ncbi.nlm.nih.gov/books/NBK598384/',
  advancedskills: 'https://www.ncbi.nlm.nih.gov/books/n/openrnas/',
};

function isSafeReaderUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return ALLOWED_READER_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith('.' + d)
    );
  } catch {
    return false;
  }
}

function paginate(text: string, wordsPerPage = 400): string[] {
  const words = text.split(/\s+/);
  const pages: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerPage) {
    pages.push(words.slice(i, i + wordsPerPage).join(' '));
  }
  return pages.length > 0 ? pages : [''];
}

function getNcbiFallback(url: string): string | null {
  try {
    const pressbooks = new URL(url).pathname.split('/').filter(Boolean)[0];
    const keyMap: Record<string, string> = {
      pharmacology: 'NBK595000',
      nursingfundamentals: 'NBK610836',
      nursingskills: 'NBK596735',
      nursingmhcc: 'NBK617002',
      nursingmpc: 'NBK598384',
    };
    const nbk = keyMap[pressbooks];
    return nbk ? `https://www.ncbi.nlm.nih.gov/books/${nbk}/` : null;
  } catch {
    return null;
  }
}

async function fetchAndParse(url: string): Promise<ReaderContent> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    return { title: '', pages: [], source: '', error: `Failed to load (${res.status})` };
  }
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('nav, aside, footer, script, style, .sidebar, .ads').forEach(
    (el) => el.remove()
  );

  const title =
    doc.querySelector('h1')?.textContent?.trim() ?? doc.title ?? 'OpenRN Textbook';
  const text = doc.body?.innerText ?? doc.body?.textContent ?? '';
  const cleaned = text.replace(/\s+/g, ' ').trim();

  return {
    title,
    pages: paginate(cleaned),
    source: new URL(url).hostname,
    url,
  };
}

export async function resolveReaderContent(
  contentKey?: string,
  externalUrl?: string
): Promise<ReaderContent> {
  // 1. Try IndexedDB first (instant, offline)
  if (contentKey) {
    const data = await indexedDBStore.get(contentKey);
    if (data) {
      const text = (data.content as string) || '';
      return {
        title: (data.title as string) || contentKey,
        pages: paginate(text),
        source: (data.source as string) || 'IndexedDB',
      };
    }

    // IndexedDB miss for OpenRN key -> try live fetch
    if (contentKey.startsWith('openrn:')) {
      const bookKey = contentKey.split(':')[1];
      externalUrl = OPENRN_READER_URLS[bookKey];
    }
  }

  // 2. Live fetch from Pressbooks/NCBI (requires internet)
  if (externalUrl) {
    if (!isSafeReaderUrl(externalUrl)) {
      return {
        title: '',
        pages: [],
        source: '',
        error: `Domain not in approved reader list: ${new URL(externalUrl).hostname}`,
      };
    }
    try {
      const result = await fetchAndParse(externalUrl);
      if (result.error) {
        const ncbi = getNcbiFallback(externalUrl);
        if (ncbi) return fetchAndParse(ncbi);
      }
      return result;
    } catch {
      return {
        title: '',
        pages: [],
        source: '',
        error: 'Could not load textbook. Check your internet connection.',
      };
    }
  }

  return { title: '', pages: [], source: '', error: 'No content source provided' };
}

/**
 * API service for PostgreSQL content_cache
 * Layer 3 of ContentDB - FDA labels, MedlinePlus, RxNorm
 */

import type { ContentCache } from '../types';

const BASE_URL = '/api';

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(body.message || `Request failed: ${response.status}`);
  }

  return response;
}

export const contentApi = {
  async getCachedContent(key: string): Promise<ContentCache> {
    const res = await authedFetch(`/content/${encodeURIComponent(key)}`);
    return res.json();
  },

  async setCachedContent(data: {
    contentKey: string;
    source: string;
    data: Record<string, unknown>;
    ttlDays?: number;
  }): Promise<ContentCache> {
    const res = await authedFetch('/content', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async searchContent(query: string): Promise<ContentCache[]> {
    const res = await authedFetch(`/content/search?q=${encodeURIComponent(query)}`);
    return res.json();
  },

  async bulkGetContent(keys: string[]): Promise<ContentCache[]> {
    const res = await authedFetch('/content/bulk', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
    return res.json();
  },

  async deleteExpiredContent(): Promise<{ deleted: number }> {
    const res = await authedFetch('/content/expired', { method: 'DELETE' });
    return res.json();
  },
};

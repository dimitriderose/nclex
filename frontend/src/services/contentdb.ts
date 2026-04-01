/**
 * ContentDB - Three-layer content routing system
 * Layer 1: localStorage (static modules - instant)
 * Layer 2: IndexedDB (textbooks - user-triggered download)
 * Layer 3: PostgreSQL via API (FDA labels, MedlinePlus, RxNorm - transparent cache)
 */

import { indexedDBStore } from './indexeddb-store';
import { localStorageManager } from './localstorage-manager';
import { contentApi } from './content-api';
import type { ContentResult, ContentLayer } from '../types/content';

const LAYER_ROUTES: Record<string, ContentLayer> = {
  // Layer 1: localStorage static modules
  drugs: 'localStorage',
  labs: 'localStorage',
  formulas: 'localStorage',
  strategies: 'localStorage',
  delegation: 'localStorage',
  communication: 'localStorage',
  diagnostics: 'localStorage',
  health_equity: 'localStorage',
  development: 'localStorage',
  infection_control: 'localStorage',
  drug_suffixes: 'localStorage',
  herbals: 'localStorage',
  iv_fluids: 'localStorage',
  vaccines: 'localStorage',

  // Layer 2: IndexedDB textbooks
  openrn: 'indexedDB',
  openstax: 'indexedDB',
  textbook: 'indexedDB',

  // Layer 3: PostgreSQL API
  fda: 'api',
  medlineplus: 'api',
  rxnorm: 'api',
  drug_label: 'api',
};

function resolveLayer(contentKey: string): ContentLayer {
  // Check exact match first
  if (LAYER_ROUTES[contentKey]) return LAYER_ROUTES[contentKey];

  // Check prefix match (e.g., 'drugs:metformin' -> 'drugs' -> localStorage)
  const prefix = contentKey.split(':')[0];
  if (LAYER_ROUTES[prefix]) return LAYER_ROUTES[prefix];

  // Default to API layer for unknown keys
  return 'api';
}

export const contentDB = {
  /**
   * Get content by key, routing to the appropriate storage layer
   */
  async get(contentKey: string): Promise<ContentResult | null> {
    const layer = resolveLayer(contentKey);

    switch (layer) {
      case 'localStorage': {
        const data = localStorageManager.get(contentKey);
        if (data) return { source: 'localStorage', key: contentKey, data, cached: true };
        return null;
      }
      case 'indexedDB': {
        const data = await indexedDBStore.get(contentKey);
        if (data) return { source: 'indexedDB', key: contentKey, data, cached: true };
        return null;
      }
      case 'api': {
        try {
          const data = await contentApi.getCachedContent(contentKey);
          return { source: 'api', key: contentKey, data, cached: true };
        } catch {
          return null;
        }
      }
      default:
        return null;
    }
  },

  /**
   * Set content, routing to the appropriate storage layer
   */
  async set(contentKey: string, data: Record<string, unknown>, source?: string): Promise<void> {
    const layer = resolveLayer(contentKey);

    switch (layer) {
      case 'localStorage':
        localStorageManager.set(contentKey, data);
        break;
      case 'indexedDB':
        await indexedDBStore.put(contentKey, data);
        break;
      case 'api':
        await contentApi.setCachedContent({
          contentKey,
          source: source || 'manual',
          data,
          ttlDays: 30,
        });
        break;
    }
  },

  /**
   * Search across all layers for content matching a query
   */
  async search(query: string, layers?: ContentLayer[]): Promise<ContentResult[]> {
    const results: ContentResult[] = [];
    const searchLayers = layers || ['localStorage', 'indexedDB', 'api'];

    if (searchLayers.includes('localStorage')) {
      const localResults = localStorageManager.search(query);
      results.push(
        ...localResults.map((r) => ({
          source: 'localStorage' as const,
          key: r.key,
          data: r.data,
          cached: true,
        }))
      );
    }

    if (searchLayers.includes('indexedDB')) {
      const idbResults = await indexedDBStore.search(query);
      results.push(
        ...idbResults.map((r) => ({
          source: 'indexedDB' as const,
          key: r.key,
          data: r.data,
          cached: true,
        }))
      );
    }

    if (searchLayers.includes('api')) {
      try {
        const apiResults = await contentApi.searchContent(query);
        results.push(
          ...apiResults.map((r) => ({
            source: 'api' as const,
            key: r.contentKey,
            data: r.data as Record<string, unknown>,
            cached: true,
          }))
        );
      } catch {
        // API unavailable, skip
      }
    }

    return results;
  },

  /**
   * Check which layer a key routes to
   */
  getLayer(contentKey: string): ContentLayer {
    return resolveLayer(contentKey);
  },

  /**
   * Get all keys for a specific layer
   */
  async getKeys(layer: ContentLayer): Promise<string[]> {
    switch (layer) {
      case 'localStorage':
        return localStorageManager.getAllKeys();
      case 'indexedDB':
        return indexedDBStore.getAllKeys();
      case 'api':
        return []; // API doesn't support listing all keys client-side
      default:
        return [];
    }
  },
};

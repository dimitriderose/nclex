/**
 * localStorage manager for static content modules
 * Layer 1 of ContentDB - instant access, bundled statics
 */

const STORAGE_PREFIX = 'nclex:';
const META_KEY = 'db:meta';

export interface DBMeta {
  version: number;
  initializedAt: string;
  modulesLoaded: string[];
  phase1Complete: boolean;
  phase2Complete: boolean;
}

// All static module definitions
export const STATIC_MODULES = [
  'drugs',
  'labs',
  'formulas',
  'strategies',
  'delegation',
  'communication',
  'diagnostics',
  'health_equity',
  'development',
  'infection_control',
  'drug_suffixes',
  'herbals',
  'iv_fluids',
  'vaccines',
] as const;

export type StaticModule = (typeof STATIC_MODULES)[number];

export const localStorageManager = {
  // ---- Meta management (skip gate) ----

  getMeta(): DBMeta | null {
    try {
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setMeta(meta: DBMeta): void {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  },

  isInitialized(): boolean {
    return this.getMeta()?.phase1Complete === true;
  },

  // ---- Content CRUD ----

  get(key: string): Record<string, unknown> | null {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set(key: string, data: Record<string, unknown>): void {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage write failed (quota?):', e);
    }
  },

  remove(key: string): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  },

  has(key: string): boolean {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`) !== null;
  },

  // ---- Module management ----

  getModule(module: StaticModule): Record<string, unknown> | null {
    return this.get(module);
  },

  setModule(module: StaticModule, data: Record<string, unknown>): void {
    this.set(module, data);
    const meta = this.getMeta();
    if (meta && !meta.modulesLoaded.includes(module)) {
      meta.modulesLoaded.push(module);
      this.setMeta(meta);
    }
  },

  isModuleLoaded(module: StaticModule): boolean {
    const meta = this.getMeta();
    return meta?.modulesLoaded.includes(module) ?? false;
  },

  getLoadedModules(): string[] {
    return this.getMeta()?.modulesLoaded ?? [];
  },

  getMissingModules(): StaticModule[] {
    const loaded = this.getLoadedModules();
    return STATIC_MODULES.filter((m) => !loaded.includes(m)) as StaticModule[];
  },

  // ---- Search ----

  search(query: string): { key: string; data: Record<string, unknown> }[] {
    const results: { key: string; data: Record<string, unknown> }[] = [];
    const q = query.toLowerCase();

    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (!fullKey || !fullKey.startsWith(STORAGE_PREFIX)) continue;

      const key = fullKey.slice(STORAGE_PREFIX.length);
      if (key.toLowerCase().includes(q)) {
        const data = this.get(key);
        if (data) results.push({ key, data });
        continue;
      }

      // Deep search in JSON values
      try {
        const raw = localStorage.getItem(fullKey) || '';
        if (raw.toLowerCase().includes(q)) {
          const data = this.get(key);
          if (data) results.push({ key, data });
        }
      } catch {
        // skip unparseable entries
      }
    }

    return results;
  },

  getAllKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (fullKey && fullKey.startsWith(STORAGE_PREFIX)) {
        keys.push(fullKey.slice(STORAGE_PREFIX.length));
      }
    }
    return keys;
  },

  // ---- Utilities ----

  getStorageUsage(): { used: number; total: number; percentage: number } {
    let used = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        used += key.length + (localStorage.getItem(key)?.length || 0);
      }
    }
    // localStorage limit is typically ~5MB (5 * 1024 * 1024 chars)
    const total = 5 * 1024 * 1024;
    return { used, total, percentage: (used / total) * 100 };
  },

  clearAll(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(META_KEY);
  },
};

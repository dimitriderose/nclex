/**
 * IndexedDB wrapper for textbook storage (OpenRN, OpenStax chapters)
 * Layer 2 of ContentDB
 */

const DB_NAME = 'nclex-textbooks';
const DB_VERSION = 1;
const STORE_NAME = 'chapters';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('source', 'source', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = callback(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export interface TextbookEntry {
  key: string;
  source: string; // 'openrn' | 'openstax'
  title: string;
  chapter: number;
  section?: string;
  content: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

export const indexedDBStore = {
  async get(key: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await withStore<TextbookEntry | undefined>('readonly', (store) =>
        store.get(key)
      );
      return result?.data || null;
    } catch {
      return null;
    }
  },

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const entry: TextbookEntry = {
      key,
      source: key.split(':')[0] || 'unknown',
      title: (data.title as string) || key,
      chapter: (data.chapter as number) || 0,
      section: data.section as string | undefined,
      content: (data.content as string) || '',
      data,
      updatedAt: new Date().toISOString(),
    };
    await withStore('readwrite', (store) => store.put(entry));
  },

  async delete(key: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(key));
  },

  async getAllKeys(): Promise<string[]> {
    return withStore<string[]>('readonly', (store) => store.getAllKeys() as IDBRequest<string[]>);
  },

  async getBySource(source: string): Promise<TextbookEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('source');
      const request = index.getAll(source);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async search(query: string): Promise<{ key: string; data: Record<string, unknown> }[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result as TextbookEntry[];
        const q = query.toLowerCase();
        const matches = all.filter(
          (entry) =>
            entry.title.toLowerCase().includes(q) ||
            entry.content.toLowerCase().includes(q) ||
            entry.key.toLowerCase().includes(q)
        );
        resolve(matches.map((m) => ({ key: m.key, data: m.data })));
      };
      request.onerror = () => reject(request.error);
    });
  },

  async count(): Promise<number> {
    return withStore<number>('readonly', (store) => store.count());
  },

  async clear(): Promise<void> {
    await withStore('readwrite', (store) => store.clear());
  },

  async bulkPut(entries: { key: string; data: Record<string, unknown> }[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const { key, data } of entries) {
        const entry: TextbookEntry = {
          key,
          source: key.split(':')[0] || 'unknown',
          title: (data.title as string) || key,
          chapter: (data.chapter as number) || 0,
          section: data.section as string | undefined,
          content: (data.content as string) || '',
          data,
          updatedAt: new Date().toISOString(),
        };
        store.put(entry);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

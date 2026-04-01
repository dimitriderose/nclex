/**
 * Sync queue for offline operations
 * Queues stats/flags operations when offline, flushes on reconnect
 */

import type { SyncQueueItem } from '../types/content';
import { api } from './api';

const QUEUE_KEY = 'nclex:sync_queue';
const MAX_RETRIES = 3;

export const syncQueue = {
  getQueue(): SyncQueueItem[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveQueue(queue: SyncQueueItem[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  },

  /**
   * Add an operation to the sync queue
   */
  enqueue(type: SyncQueueItem['type'], payload: Record<string, unknown>): void {
    const queue = this.getQueue();
    const item: SyncQueueItem = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    queue.push(item);
    this.saveQueue(queue);
  },

  /**
   * Flush the queue - process all pending operations
   * Returns number of successful operations
   */
  async flush(): Promise<{ success: number; failed: number }> {
    const queue = this.getQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    let success = 0;
    let failed = 0;
    const remaining: SyncQueueItem[] = [];

    for (const item of queue) {
      try {
        await this.processItem(item);
        success++;
      } catch (e) {
        console.warn(`Sync failed for ${item.type}:`, e);
        item.retries++;
        if (item.retries < MAX_RETRIES) {
          remaining.push(item);
        }
        failed++;
      }
    }

    this.saveQueue(remaining);
    return { success, failed };
  },

  /**
   * Process a single queue item
   */
  async processItem(item: SyncQueueItem): Promise<void> {
    switch (item.type) {
      case 'stats_update':
        await api.updateStats(item.payload);
        break;
      case 'flag_create':
        await api.createFlag(item.payload as Parameters<typeof api.createFlag>[0]);
        break;
      case 'flag_update': {
        const { id, ...data } = item.payload as { id: string } & Record<string, unknown>;
        await api.updateFlag(id, data);
        break;
      }
      case 'flag_delete':
        await api.deleteFlag(item.payload.id as string);
        break;
      case 'history_append':
        await api.appendHistory(item.payload);
        break;
      default:
        console.warn('Unknown sync queue item type:', item.type);
    }
  },

  getQueueLength(): number {
    return this.getQueue().length;
  },

  clearQueue(): void {
    localStorage.removeItem(QUEUE_KEY);
  },
};

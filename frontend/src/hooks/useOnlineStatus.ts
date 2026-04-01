import { useState, useEffect, useCallback } from 'react';
import { syncQueue } from '../services/sync-queue';
import { offlineBank } from '../services/offline-bank';
import type { OfflineState } from '../types/content';

export function useOnlineStatus(): OfflineState & {
  triggerSync: () => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueLength, setQueueLength] = useState(syncQueue.getQueueLength());
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [offlineBankSize, setOfflineBankSize] = useState(offlineBank.getBankSize());

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-flush sync queue on reconnect
      syncQueue.flush().then((result) => {
        setQueueLength(syncQueue.getQueueLength());
        if (result.success > 0) {
          setLastSyncAt(new Date().toISOString());
        }
      });
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodically check queue length
  useEffect(() => {
    const interval = setInterval(() => {
      setQueueLength(syncQueue.getQueueLength());
      setOfflineBankSize(offlineBank.getBankSize());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = useCallback(async () => {
    const result = await syncQueue.flush();
    setQueueLength(syncQueue.getQueueLength());
    if (result.success > 0) {
      setLastSyncAt(new Date().toISOString());
    }
  }, []);

  return { isOnline, queueLength, lastSyncAt, offlineBankSize, triggerSync };
}

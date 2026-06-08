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

  // Offline-bank population trigger (Phase 3 / PRD §5.9): "session end" isn't a single
  // browser event, so we treat the tab going hidden (user switches away/minimizes — the
  // most reliable cross-browser proxy for "wrapping up a session", unlike 'beforeunload'
  // which is unreliable for async work) and the connection actually going offline as the
  // two practical "session end" signals. Both are while-online checks (regeneration needs
  // network); `maybeRegenerateBank` itself no-ops when the bank isn't stale, so this is
  // safe to fire opportunistically without throttling here.
  useEffect(() => {
    const maybeRegenerate = () => {
      if (!navigator.onLine) return;
      offlineBank.maybeRegenerateBank()
        .then((didRegenerate) => {
          if (didRegenerate) {
            setOfflineBankSize(offlineBank.getBankSize());
          }
        })
        .catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        maybeRegenerate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', maybeRegenerate);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', maybeRegenerate);
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

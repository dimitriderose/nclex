import { useOnlineStatus } from '../hooks/useOnlineStatus';
import './OfflineBanner.css';

export function OfflineBanner() {
  const { isOnline, queueLength, lastSyncAt, offlineBankSize, triggerSync } = useOnlineStatus();

  if (isOnline && queueLength === 0) return null;

  return (
    <div className={`offline-banner ${isOnline ? 'syncing' : 'offline'}`}>
      <div className="banner-content">
        {!isOnline && (
          <>
            <span className="banner-icon">\u26A0\uFE0F</span>
            <span className="banner-text">
              You're offline. Questions from your offline bank ({offlineBankSize} available) will be used.
            </span>
          </>
        )}

        {isOnline && queueLength > 0 && (
          <>
            <span className="banner-icon">\uD83D\uDD04</span>
            <span className="banner-text">
              {queueLength} pending sync {queueLength === 1 ? 'item' : 'items'}
            </span>
            <button className="sync-btn" onClick={triggerSync}>Sync Now</button>
          </>
        )}
      </div>

      {lastSyncAt && (
        <div className="sync-status">
          Last synced: {new Date(lastSyncAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export function SyncStatusIndicator() {
  const { isOnline, queueLength } = useOnlineStatus();

  return (
    <div className={`sync-indicator ${isOnline ? 'online' : 'offline'}`}>
      <span className="sync-dot" />
      <span className="sync-label">
        {isOnline ? 'Online' : 'Offline'}
        {queueLength > 0 && ` (${queueLength} pending)`}
      </span>
    </div>
  );
}

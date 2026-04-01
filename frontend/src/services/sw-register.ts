/**
 * Service worker registration
 */

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        console.log('SW registered:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                // New version available
                if (registration.active) {
                  console.log('New content available; please refresh.');
                }
              }
            });
          }
        });
      } catch (error) {
        console.warn('SW registration failed:', error);
      }
    });
  }
}

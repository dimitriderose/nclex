/**
 * Content setup flow - three-phase initialization
 * Phase 1: Instant (bundled statics into localStorage)
 * Phase 2: User-triggered (textbook download into IndexedDB)
 * Phase 3: Transparent (server cache for FDA/MedlinePlus/RxNorm)
 */

import { localStorageManager, STATIC_MODULES } from './localstorage-manager';
import type { DBMeta, StaticModule } from './localstorage-manager';
import { indexedDBStore } from './indexeddb-store';
import { staticData } from '../data/static-modules';

export type SetupPhase = 'checking' | 'phase1' | 'phase2' | 'complete';

export interface SetupProgress {
  phase: SetupPhase;
  currentModule?: string;
  loaded: number;
  total: number;
  message: string;
}

type ProgressCallback = (progress: SetupProgress) => void;

export const contentSetup = {
  /**
   * Check if setup is needed (skip gate)
   */
  needsSetup(): boolean {
    return !localStorageManager.isInitialized();
  },

  /**
   * Run Phase 1: Load bundled static modules into localStorage
   * This is instant - all data is bundled with the app
   */
  async runPhase1(onProgress?: ProgressCallback): Promise<void> {
    const total = STATIC_MODULES.length;
    let loaded = 0;

    for (const module of STATIC_MODULES) {
      if (!localStorageManager.isModuleLoaded(module)) {
        onProgress?.({
          phase: 'phase1',
          currentModule: module,
          loaded,
          total,
          message: `Loading ${module}...`,
        });

        const data = staticData[module as StaticModule];
        if (data) {
          localStorageManager.setModule(module as StaticModule, data);
        }
      }
      loaded++;
    }

    // Update meta
    const meta: DBMeta = {
      version: 1,
      initializedAt: new Date().toISOString(),
      modulesLoaded: [...STATIC_MODULES],
      phase1Complete: true,
      phase2Complete: false,
    };
    localStorageManager.setMeta(meta);

    onProgress?.({
      phase: 'phase1',
      loaded: total,
      total,
      message: 'Static modules loaded',
    });
  },

  /**
   * Run Phase 2: Download textbook content into IndexedDB
   * This is user-triggered and may take time
   */
  async runPhase2(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.({
      phase: 'phase2',
      loaded: 0,
      total: 1,
      message: 'Preparing textbook storage...',
    });

    // IndexedDB is initialized on first access (via openDB)
    const count = await indexedDBStore.count();

    onProgress?.({
      phase: 'phase2',
      loaded: 1,
      total: 1,
      message: `Textbook storage ready (${count} chapters cached)`,
    });

    // Mark phase 2 complete
    const meta = localStorageManager.getMeta();
    if (meta) {
      meta.phase2Complete = true;
      localStorageManager.setMeta(meta);
    }
  },

  /**
   * Full setup flow
   */
  async runFullSetup(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.({
      phase: 'checking',
      loaded: 0,
      total: 0,
      message: 'Checking content status...',
    });

    if (this.needsSetup()) {
      await this.runPhase1(onProgress);
      await this.runPhase2(onProgress);
    }

    onProgress?.({
      phase: 'complete',
      loaded: 1,
      total: 1,
      message: 'Content ready',
    });
  },

  /**
   * Get current setup status
   */
  getStatus(): {
    phase1: boolean;
    phase2: boolean;
    modulesLoaded: number;
    modulesTotal: number;
    textbookReady: boolean;
  } {
    const meta = localStorageManager.getMeta();
    return {
      phase1: meta?.phase1Complete ?? false,
      phase2: meta?.phase2Complete ?? false,
      modulesLoaded: meta?.modulesLoaded.length ?? 0,
      modulesTotal: STATIC_MODULES.length,
      textbookReady: meta?.phase2Complete ?? false,
    };
  },

  /**
   * Reset all content (useful for debugging/fresh start)
   */
  async reset(): Promise<void> {
    localStorageManager.clearAll();
    await indexedDBStore.clear();
  },
};

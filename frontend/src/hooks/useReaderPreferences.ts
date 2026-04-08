import { useState, useCallback, useMemo } from 'react';
import { readerLog } from '../reader/readerLogger';

export type LineHeightPreset = 'compact' | 'default' | 'relaxed';
export type MarginPreset = 'narrow' | 'default' | 'wide';
export type ReaderTheme = '' | 'sepia' | 'dark' | 'night';

export const LINE_HEIGHT_PRESETS: Record<LineHeightPreset, { serif: number; sans: number }> = {
  compact: { serif: 1.55, sans: 1.48 },
  default: { serif: 1.72, sans: 1.65 },
  relaxed: { serif: 1.95, sans: 1.85 },
};

export const MARGIN_PRESETS: Record<MarginPreset, { desktop: number; mobile: number }> = {
  narrow: { desktop: 28, mobile: 12 },
  default: { desktop: 56, mobile: 20 },
  wide: { desktop: 80, mobile: 28 },
};

const LS_KEYS = {
  fontSize: 'reader-fs',
  font: 'reader-font',
  lineHeight: 'reader-lh',
  margin: 'reader-margin',
  theme: 'reader-theme',
} as const;

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 36;
const FONT_SIZE_STEP = 2;
const LINE_HEIGHT_CYCLE: LineHeightPreset[] = ['compact', 'default', 'relaxed'];
const MARGIN_CYCLE: MarginPreset[] = ['narrow', 'default', 'wide'];

function readLS<T>(key: string, fallback: T, validate?: (val: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (validate) {
      const result = validate(raw);
      return result !== null ? result : fallback;
    }
    return raw as unknown as T;
  } catch {
    readerLog.warn('preferences.read_failed', { key });
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    readerLog.warn('preferences.write_failed', { key });
  }
}

export interface UseReaderPreferencesReturn {
  // State
  fontSize: number;
  isSerif: boolean;
  lineHeightPreset: LineHeightPreset;
  marginPreset: MarginPreset;
  theme: ReaderTheme;

  // Methods
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  toggleFont: () => void;
  cycleLineHeight: () => void;
  cycleMargin: () => void;
  setTheme: (theme: ReaderTheme) => void;

  // Computed
  lineHeight: number;
  margins: { desktop: number; mobile: number };
  fontFamily: string;
}

export function useReaderPreferences(): UseReaderPreferencesReturn {
  const [fontSize, setFontSize] = useState<number>(() =>
    readLS(LS_KEYS.fontSize, 20, (raw) => {
      const n = parseInt(raw, 10);
      return !isNaN(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX ? n : null;
    })
  );

  const [isSerif, setIsSerif] = useState<boolean>(() =>
    readLS(LS_KEYS.font, true, (raw) => {
      if (raw === 'serif') return true;
      if (raw === 'sans') return false;
      return null;
    })
  );

  const [lineHeightPreset, setLineHeightPreset] = useState<LineHeightPreset>(() =>
    readLS(LS_KEYS.lineHeight, 'default' as LineHeightPreset, (raw) =>
      LINE_HEIGHT_CYCLE.includes(raw as LineHeightPreset) ? (raw as LineHeightPreset) : null
    )
  );

  const [marginPreset, setMarginPreset] = useState<MarginPreset>(() =>
    readLS(LS_KEYS.margin, 'default' as MarginPreset, (raw) =>
      MARGIN_CYCLE.includes(raw as MarginPreset) ? (raw as MarginPreset) : null
    )
  );

  const [theme, setThemeState] = useState<ReaderTheme>(() =>
    readLS(LS_KEYS.theme, '' as ReaderTheme, (raw) => {
      const valid: ReaderTheme[] = ['', 'sepia', 'dark', 'night'];
      return valid.includes(raw as ReaderTheme) ? (raw as ReaderTheme) : null;
    })
  );

  const increaseFontSize = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.min(prev + FONT_SIZE_STEP, FONT_SIZE_MAX);
      writeLS(LS_KEYS.fontSize, String(next));
      return next;
    });
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.max(prev - FONT_SIZE_STEP, FONT_SIZE_MIN);
      writeLS(LS_KEYS.fontSize, String(next));
      return next;
    });
  }, []);

  const toggleFont = useCallback(() => {
    setIsSerif((prev) => {
      const next = !prev;
      writeLS(LS_KEYS.font, next ? 'serif' : 'sans');
      return next;
    });
  }, []);

  const cycleLineHeight = useCallback(() => {
    setLineHeightPreset((prev) => {
      const idx = LINE_HEIGHT_CYCLE.indexOf(prev);
      const next = LINE_HEIGHT_CYCLE[(idx + 1) % LINE_HEIGHT_CYCLE.length];
      writeLS(LS_KEYS.lineHeight, next);
      return next;
    });
  }, []);

  const cycleMargin = useCallback(() => {
    setMarginPreset((prev) => {
      const idx = MARGIN_CYCLE.indexOf(prev);
      const next = MARGIN_CYCLE[(idx + 1) % MARGIN_CYCLE.length];
      writeLS(LS_KEYS.margin, next);
      return next;
    });
  }, []);

  const setTheme = useCallback((newTheme: ReaderTheme) => {
    setThemeState(newTheme);
    writeLS(LS_KEYS.theme, newTheme);
  }, []);

  const lineHeight = useMemo(() => {
    const preset = LINE_HEIGHT_PRESETS[lineHeightPreset];
    return isSerif ? preset.serif : preset.sans;
  }, [lineHeightPreset, isSerif]);

  const margins = useMemo(() => MARGIN_PRESETS[marginPreset], [marginPreset]);

  const fontFamily = useMemo(() => {
    return isSerif
      ? "var(--font-reading)"
      : "'Inter', -apple-system, sans-serif";
  }, [isSerif]);

  return {
    fontSize,
    isSerif,
    lineHeightPreset,
    marginPreset,
    theme,
    increaseFontSize,
    decreaseFontSize,
    toggleFont,
    cycleLineHeight,
    cycleMargin,
    setTheme,
    lineHeight,
    margins,
    fontFamily,
  };
}

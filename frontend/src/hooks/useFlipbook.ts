import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import { readerLog } from '../reader/readerLogger';

export interface ChapterInfo {
  current: number;
  total: number;
  title: string;
}

interface ChapterMapEntry {
  startPage: number;
  title: string;
}

export interface UseFlipbookOptions {
  contentRef: RefObject<HTMLDivElement>;
  viewportRef: RefObject<HTMLDivElement>;
}

export interface UseFlipbookReturn {
  currentPage: number;
  totalPages: number;
  chapterInfo: ChapterInfo | null;
  isFlipping: boolean;
  flipNext: () => void;
  flipPrev: () => void;
  flipTo: (page: number) => void;
  paginate: () => void;
  atStart: boolean;
  atEnd: boolean;
  progressPercent: number;
}

const PADDING_TOP = 48;
const DEFAULT_COLUMN_GAP = 120;
const FLIP_DURATION = 500;
const RESIZE_DEBOUNCE = 200;
const TRANSITION_STYLE = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export function useFlipbook({ contentRef, viewportRef }: UseFlipbookOptions): UseFlipbookReturn {
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isFlipping, setIsFlipping] = useState(false);
  const [chapterInfo, setChapterInfo] = useState<ChapterInfo | null>(null);

  // Use refs for mutable values that callbacks need without re-renders
  const currentPageRef = useRef(0);
  const totalPagesRef = useRef(1);
  const chapterMapRef = useRef<ChapterMapEntry[]>([]);
  const actualColumnWidthRef = useRef(0);
  const gapRef = useRef(DEFAULT_COLUMN_GAP);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getColumnGap = useCallback((): number => {
    const content = contentRef.current;
    if (!content) return DEFAULT_COLUMN_GAP;
    const computed = window.getComputedStyle(content);
    const parsed = parseFloat(computed.columnGap || computed.getPropertyValue('column-gap'));
    return isNaN(parsed) ? DEFAULT_COLUMN_GAP : parsed;
  }, [contentRef]);

  const updateChapterInfo = useCallback((page: number) => {
    const map = chapterMapRef.current;
    if (map.length === 0) {
      setChapterInfo(null);
      return;
    }

    let chapterIndex = 0;
    for (let i = map.length - 1; i >= 0; i--) {
      if (page >= map[i].startPage) {
        chapterIndex = i;
        break;
      }
    }

    setChapterInfo({
      current: chapterIndex + 1,
      total: map.length,
      title: map[chapterIndex].title,
    });
  }, []);

  const updatePosition = useCallback((page: number, animate: boolean) => {
    const content = contentRef.current;
    if (!content) return;

    const colWidth = actualColumnWidthRef.current;
    const gap = gapRef.current;
    const offset = page * (colWidth + gap);

    if (animate) {
      content.style.transition = TRANSITION_STYLE;
      content.style.transform = `translateX(-${offset}px)`;
    } else {
      content.style.transition = 'none';
      content.style.transform = `translateX(-${offset}px)`;
      // Force reflow so the non-animated position applies immediately
      content.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions
      content.style.transition = TRANSITION_STYLE;
    }
  }, [contentRef]);

  const buildChapterMap = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;

    const chapters = content.querySelectorAll('.epub-chapter');
    if (chapters.length === 0) return;

    const colWidth = actualColumnWidthRef.current;
    const gap = gapRef.current;
    const stepSize = colWidth + gap;

    const map: ChapterMapEntry[] = [];

    chapters.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const startPage = stepSize > 0 ? Math.floor(htmlEl.offsetLeft / stepSize) : 0;

      // Extract title from first heading inside this chapter
      const heading = htmlEl.querySelector('h1, h2, h3');
      const title = heading?.textContent?.trim() || `Chapter ${map.length + 1}`;

      map.push({ startPage, title });
    });

    chapterMapRef.current = map;
  }, [contentRef]);

  const paginate = useCallback(() => {
    const t0 = performance.now();
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportHeight = viewportRect.height;
    const viewportWidth = viewportRect.width;

    if (viewportHeight === 0 || viewportWidth === 0) {
      readerLog.warn('flipbook.paginate_skipped', { reason: 'zero-size viewport' });
      return;
    }

    // Calculate line-height from computed styles
    const computed = window.getComputedStyle(content);
    const rawLineHeight = parseFloat(computed.lineHeight);
    const lineHeight = isNaN(rawLineHeight) || rawLineHeight <= 0
      ? parseFloat(computed.fontSize) * 1.6
      : rawLineHeight;

    // Compute exact content height as a multiple of line-height to prevent word cutoff
    const availableHeight = viewportHeight - PADDING_TOP;
    const lineCount = Math.floor(availableHeight / lineHeight);
    const exactContentHeight = lineCount * lineHeight;
    const paddingBottom = viewportHeight - PADDING_TOP - exactContentHeight;

    // Get current padding values
    const padLeft = parseFloat(computed.paddingLeft) || 56;
    const padRight = parseFloat(computed.paddingRight) || 56;
    const actualColumnWidth = viewportWidth - padLeft - padRight;

    // Apply layout properties
    content.style.paddingTop = `${PADDING_TOP}px`;
    content.style.paddingBottom = `${Math.max(0, paddingBottom)}px`;
    content.style.columnWidth = `${actualColumnWidth}px`;
    content.style.height = `${viewportHeight}px`;

    // Read gap from computed styles
    const gap = getColumnGap();
    gapRef.current = gap;

    // Force layout reflow
    content.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions

    const scrollWidth = content.scrollWidth;
    actualColumnWidthRef.current = actualColumnWidth;

    const stepSize = actualColumnWidth + gap;
    const pages = Math.max(1, Math.round(scrollWidth / stepSize));

    totalPagesRef.current = pages;
    setTotalPages(pages);

    // Clamp current page
    const clampedPage = Math.min(currentPageRef.current, pages - 1);
    currentPageRef.current = clampedPage;
    setCurrentPage(clampedPage);

    // Update position without animation on repaginate
    updatePosition(clampedPage, false);

    // Build chapter map after layout
    buildChapterMap();
    updateChapterInfo(clampedPage);

    readerLog.info('flipbook.paginated', { totalPages: pages, durationMs: Math.round(performance.now() - t0) });
  }, [contentRef, viewportRef, getColumnGap, updatePosition, buildChapterMap, updateChapterInfo]);

  const flipNext = useCallback(() => {
    const nextPage = currentPageRef.current + 1;
    if (nextPage >= totalPagesRef.current) return;

    currentPageRef.current = nextPage;
    setCurrentPage(nextPage);
    updatePosition(nextPage, true);
    updateChapterInfo(nextPage);
    readerLog.info('flipbook.flip', { to: nextPage, direction: 'next' });

    setIsFlipping(true);
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => setIsFlipping(false), FLIP_DURATION);
  }, [updatePosition, updateChapterInfo]);

  const flipPrev = useCallback(() => {
    const prevPage = currentPageRef.current - 1;
    if (prevPage < 0) return;

    currentPageRef.current = prevPage;
    setCurrentPage(prevPage);
    updatePosition(prevPage, true);
    updateChapterInfo(prevPage);
    readerLog.info('flipbook.flip', { to: prevPage, direction: 'prev' });

    setIsFlipping(true);
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => setIsFlipping(false), FLIP_DURATION);
  }, [updatePosition, updateChapterInfo]);

  const flipTo = useCallback((page: number) => {
    const clamped = Math.max(0, Math.min(page, totalPagesRef.current - 1));

    currentPageRef.current = clamped;
    setCurrentPage(clamped);
    updatePosition(clamped, true);
    updateChapterInfo(clamped);
    readerLog.info('flipbook.flip', { to: clamped, direction: 'jump' });

    setIsFlipping(true);
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => setIsFlipping(false), FLIP_DURATION);
  }, [updatePosition, updateChapterInfo]);

  // Debounced resize handler
  useEffect(() => {
    const handleResize = () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        paginate();
      }, RESIZE_DEBOUNCE);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    };
  }, [paginate]);

  return {
    currentPage,
    totalPages,
    chapterInfo,
    isFlipping,
    flipNext,
    flipPrev,
    flipTo,
    paginate,
    atStart: currentPage <= 0,
    atEnd: currentPage >= totalPages - 1,
    progressPercent: totalPages > 1 ? (currentPage / (totalPages - 1)) * 100 : 100,
  };
}

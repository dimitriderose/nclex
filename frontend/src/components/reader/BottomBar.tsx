interface BottomBarProps {
  currentPage: number
  totalPages: number
  progressPercent: number
  chapterInfo: { current: number; total: number; title: string } | null
}

export function BottomBar({
  currentPage,
  totalPages,
  progressPercent,
  chapterInfo,
}: BottomBarProps) {
  return (
    <>
      <div className="bottom-bar">
        <div className="bb-left">
          {chapterInfo && (
            <span className="chapter-indicator" title={chapterInfo.title}>
              {chapterInfo.title}
            </span>
          )}
        </div>
        <div className="bb-center">
          <span className="page-info" aria-live="polite">
            {currentPage + 1} / {totalPages}
          </span>
          <span className="kb-hint">&larr; &rarr;</span>
        </div>
        <div className="bb-right" />
      </div>
      <div
        className="page-progress"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading progress"
      >
        <div
          className="page-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </>
  )
}

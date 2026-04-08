import type { AudioReaderAPI } from '../../hooks/useAudioReader'
import '../../styles/ReaderAudio.css'

interface AudioBarProps {
  audio: AudioReaderAPI
  contentRef: React.RefObject<HTMLDivElement | null>
}

export function AudioBar({ audio, contentRef }: AudioBarProps) {
  if (!audio.isAvailable) return null

  const isVisible = audio.isPlaying || audio.isPaused

  const handlePlayPause = () => {
    if (audio.isPlaying) {
      audio.pause()
    } else if (audio.isPaused) {
      audio.resume()
    } else {
      audio.play(contentRef.current)
    }
  }

  const handleStop = () => {
    audio.stop()
  }

  return (
    <div className={`audio-bar${isVisible ? '' : ' hidden'}`} role="toolbar" aria-label="Audio controls">
      <button
        className="audio-btn"
        onClick={audio.skipBackward}
        title="Previous sentence"
        aria-label="Previous sentence"
      >
        ⏮
      </button>

      <button
        className={`audio-btn${audio.isPlaying ? ' playing' : ''}`}
        onClick={handlePlayPause}
        title={audio.isPlaying ? 'Pause' : 'Play'}
        aria-label={audio.isPlaying ? 'Pause audio' : 'Play audio'}
      >
        {audio.isPlaying ? '⏸' : '▶'}
      </button>

      <button
        className="audio-btn"
        onClick={audio.skipForward}
        title="Next sentence"
        aria-label="Next sentence"
      >
        ⏭
      </button>

      <button
        className="audio-btn"
        onClick={handleStop}
        title="Stop"
        aria-label="Stop audio"
      >
        ■
      </button>

      <span className="audio-divider" aria-hidden="true" />

      <span className="audio-sentence-info" aria-live="polite">
        {audio.totalSentences > 0
          ? `${audio.currentSentence + 1} / ${audio.totalSentences}`
          : ''}
      </span>

      <span className="audio-divider" aria-hidden="true" />

      <button
        className="audio-btn audio-speed-btn"
        onClick={audio.cycleSpeed}
        title="Change speed"
        aria-label={`Speed: ${audio.speed}x`}
      >
        {audio.speed}x
      </button>

      <select
        className="audio-voice-select"
        value={audio.selectedVoiceURI ?? ''}
        onChange={(e) => audio.setVoice(e.target.value)}
        aria-label="Select voice"
      >
        {audio.voices
          .filter((v) => v.lang.startsWith('en'))
          .length > 0 && (
          <optgroup label="English">
            {audio.voices
              .filter((v) => v.lang.startsWith('en'))
              .map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
          </optgroup>
        )}
        {audio.voices.filter((v) => !v.lang.startsWith('en')).length > 0 && (
          <optgroup label="Other Languages">
            {audio.voices
              .filter((v) => !v.lang.startsWith('en'))
              .map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

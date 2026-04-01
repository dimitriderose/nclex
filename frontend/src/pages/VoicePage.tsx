import { VoiceAssistant } from '../components/VoiceAssistant'

export function VoicePage() {
  return (
    <div className="voice-page">
      <VoiceAssistant isQuestionActive={false} />
    </div>
  )
}

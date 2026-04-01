import { useState, useCallback } from 'react';
import { useSpeechRecognition, speak, stopSpeaking } from '../hooks/useSpeechRecognition';
import './VoiceAssistant.css';

interface VoiceAssistantProps {
  isQuestionActive: boolean;
  onResponse?: (response: string) => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  source?: string;
}

export function VoiceAssistant({ isQuestionActive, onResponse }: VoiceAssistantProps) {
  const { isListening, transcript, error, isSupported, startListening, stopListening, resetTranscript } = useSpeechRecognition();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleSend = useCallback(async () => {
    const text = transcript.trim();
    if (!text) return;

    stopListening();
    resetTranscript();

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setIsProcessing(true);

    try {
      const res = await fetch('/api/voice/ask', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          isQuestionActive,
          conversationHistory: messages.slice(-6),
        }),
      });

      const data = await res.json();
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.answer || 'I could not generate a response.',
        source: data.source,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      onResponse?.(assistantMsg.content);

      // TTS
      if (handsFree || true) {
        setIsSpeaking(true);
        speak(assistantMsg.content, () => {
          setIsSpeaking(false);
          if (handsFree) startListening();
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [transcript, isQuestionActive, messages, handsFree, stopListening, resetTranscript, startListening, onResponse]);

  if (!isSupported) {
    return <div className="voice-unsupported">Voice assistant requires a browser with Web Speech API support.</div>;
  }

  return (
    <div className="voice-assistant">
      <div className="voice-header">
        <h3>NCLEX Voice Assistant</h3>
        <label className="hands-free-toggle">
          <input
            type="checkbox"
            checked={handsFree}
            onChange={(e) => setHandsFree(e.target.checked)}
          />
          Hands-free
        </label>
      </div>

      <div className="voice-messages">
        {messages.length === 0 && (
          <div className="voice-empty">Tap the mic and ask an NCLEX-related question.</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`voice-msg voice-msg-${msg.role}`}>
            <div className="msg-content">{msg.content}</div>
            {msg.source && <div className="msg-source">Source: {msg.source}</div>}
          </div>
        ))}
        {isProcessing && <div className="voice-msg voice-msg-assistant"><div className="msg-content typing">Thinking...</div></div>}
      </div>

      {transcript && (
        <div className="voice-transcript">
          <p>{transcript}</p>
        </div>
      )}

      {error && <div className="voice-error">{error}</div>}

      <div className="voice-controls">
        <button
          className={`mic-btn${isListening ? ' listening' : ''}`}
          onClick={isListening ? stopListening : startListening}
          disabled={isProcessing}
        >
          {isListening ? '\u23F8 Stop' : '\uD83C\uDF99 Listen'}
        </button>

        {transcript && (
          <button className="send-btn" onClick={handleSend} disabled={isProcessing}>
            Send
          </button>
        )}

        {isSpeaking && (
          <button className="stop-speak-btn" onClick={() => { stopSpeaking(); setIsSpeaking(false); }}>
            Stop Speaking
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

type VoiceInputButtonProps = {
  onTranscript: (transcript: string) => void;
  className?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permite el acceso al micrófono en el navegador y vuelve a intentarlo.',
  'service-not-allowed': 'El navegador bloqueó el servicio de transcripción por voz.',
  'audio-capture': 'No se detectó un micrófono disponible.',
  'no-speech': 'No detecté voz. Pulsa Audio e inténtalo otra vez.',
  network: 'El servicio de transcripción no está disponible en este momento.',
  aborted: 'Dictado detenido.'
};

export function VoiceInputButton({ onTranscript, className = '' }: VoiceInputButtonProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  useEffect(() => () => {
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
  }, []);

  function toggleDictation() {
    if (listening) {
      try {
        recognitionRef.current?.stop();
        setNotice('Finalizando transcripción…');
      } catch {
        setListening(false);
      }
      return;
    }

    const speechWindow = window as any;
    const SpeechRecognitionConstructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setNotice('Este navegador no admite transcripción automática por voz. Abre ARIA en Chrome actualizado y permite el micrófono.');
      return;
    }

    let finalTranscript = '';
    let recognitionError = '';
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new SpeechRecognitionConstructor() as SpeechRecognitionLike;
      recognition.lang = 'es-PR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: any) => {
        const finalParts: string[] = [];
        const startIndex = Math.max(0, Number(event?.resultIndex) || 0);
        for (let index = startIndex; index < (event?.results?.length || 0); index += 1) {
          const item = event.results[index];
          if (!item?.isFinal) continue;
          const phrase = String(item?.[0]?.transcript || '').trim();
          if (phrase) finalParts.push(phrase);
        }
        if (finalParts.length) {
          finalTranscript = [finalTranscript, ...finalParts].filter(Boolean).join(' ').trim();
          setNotice('Transcribiendo… puedes detener el dictado cuando termines.');
        }
      };
      recognition.onerror = (event: any) => {
        const code = String(event?.error || 'unknown');
        recognitionError = ERROR_MESSAGES[code] || 'No se pudo transcribir el audio (' + code + ').';
      };
      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        if (finalTranscript.trim()) {
          onTranscriptRef.current(finalTranscript.trim());
          setNotice('Transcripción insertada. Revísala y envíala.');
        } else if (recognitionError) {
          setNotice(recognitionError);
        } else {
          setNotice('No se recibió ninguna transcripción. Comprueba el micrófono e inténtalo de nuevo.');
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
      setNotice('Escuchando… habla ahora.');
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setNotice('No se pudo iniciar el micrófono. Comprueba los permisos del navegador.');
    }
  }

  return (
    <span className={'voiceInputControl ' + className}>
      <button
        type='button'
        className='voiceInputButton'
        aria-label={listening ? 'Detener dictado por voz' : 'Grabar audio y transcribir'}
        aria-pressed={listening}
        onClick={toggleDictation}
      >
        {listening ? '■ Detener' : '🎙️ Audio'}
      </button>
      {notice && <span className='voiceInputNotice' role='status' aria-live='polite'>{notice}</span>}
    </span>
  );
}

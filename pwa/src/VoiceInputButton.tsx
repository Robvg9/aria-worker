import { useEffect, useRef, useState } from 'react';

type VoiceInputButtonProps = {
  onTranscript: (transcript: string) => void;
  onAudio?: (audio: File) => void;
  captureAudio?: boolean;
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

type VoiceSession = {
  transcript: string;
  recognitionError: string;
  audioError: string;
  recognitionEnded: boolean;
  recorderEnded: boolean;
  finished: boolean;
  audioFile: File | null;
  recognition: SpeechRecognitionLike | null;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
};

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permite el acceso al micrófono en el navegador y vuelve a intentarlo.',
  'service-not-allowed': 'El navegador bloqueó el servicio de transcripción por voz.',
  'audio-capture': 'No se detectó un micrófono disponible.',
  'no-speech': 'No detecté voz. Pulsa Audio e inténtalo otra vez.',
  network: 'El servicio de transcripción no está disponible en este momento.',
  aborted: 'Dictado detenido.'
};

export function VoiceInputButton({
  onTranscript,
  onAudio,
  captureAudio = false,
  className = ''
}: VoiceInputButtonProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const activeRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onAudioRef = useRef(onAudio);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onAudioRef.current = onAudio; }, [onAudio]);

  useEffect(() => () => {
    activeRef.current = false;
    const session = sessionRef.current;
    try { session?.recognition?.abort?.(); } catch {}
    try { if (session?.recorder?.state === 'recording') session.recorder.stop(); } catch {}
    session?.stream?.getTracks().forEach(track => track.stop());
    recognitionRef.current = null;
    sessionRef.current = null;
  }, []);

  function settle(session: VoiceSession) {
    if (session.finished || !session.recognitionEnded || !session.recorderEnded) return;
    session.finished = true;
    activeRef.current = false;
    setListening(false);
    recognitionRef.current = null;
    session.stream?.getTracks().forEach(track => track.stop());
    session.stream = null;

    if (session.audioFile) onAudioRef.current?.(session.audioFile);
    const transcript = session.transcript.trim();
    if (transcript) {
      onTranscriptRef.current(transcript);
      if (session.audioFile) setNotice('Audio adjuntado y transcripción insertada. Revisa el texto y pulsa Enviar.');
      else if (session.audioError) setNotice('Transcripción insertada; no se pudo adjuntar el audio: ' + session.audioError);
      else setNotice('Transcripción insertada. Revísala y envíala.');
    } else if (session.audioFile) {
      setNotice('Audio adjuntado, pero no se obtuvo la transcripción automática. Añade contexto y envíalo.');
    } else {
      setNotice(session.recognitionError || session.audioError || 'No se recibió ninguna transcripción. Comprueba el micrófono e inténtalo de nuevo.');
    }
  }

  async function startAudioCapture(session: VoiceSession) {
    if (!captureAudio) {
      session.recorderEnded = true;
      settle(session);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      session.audioError = 'Este navegador no permite grabar audio adjunto.';
      session.recorderEnded = true;
      settle(session);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current || sessionRef.current !== session) {
        stream.getTracks().forEach(track => track.stop());
        session.recorderEnded = true;
        settle(session);
        return;
      }
      session.stream = stream;
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      session.recorder = recorder;
      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onerror = () => {
        session.audioError = 'La grabación del audio falló.';
      };
      recorder.onstop = () => {
        try {
          const type = recorder.mimeType || session.chunks[0]?.type || 'audio/webm';
          const blob = new Blob(session.chunks, { type });
          if (blob.size > 0) {
            const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            session.audioFile = new File([blob], 'aria-audio-' + stamp + '.' + extension, { type });
          } else {
            session.audioError = session.audioError || 'La grabación quedó vacía.';
          }
        } catch {
          session.audioError = 'No se pudo preparar el archivo de audio.';
        }
        session.stream?.getTracks().forEach(track => track.stop());
        session.stream = null;
        session.recorderEnded = true;
        settle(session);
      };
      recorder.start(250);
      setNotice('Grabando audio y transcribiendo… pulsa Detener cuando termines.');
    } catch {
      session.audioError = 'No se pudo grabar el audio; se conservará la transcripción si está disponible.';
      session.recorderEnded = true;
      settle(session);
    }
  }

  function toggleDictation() {
    if (listening) {
      activeRef.current = false;
      const session = sessionRef.current;
      if (session?.recorder?.state === 'recording') {
        try { session.recorder.stop(); } catch {
          session.audioError = 'No se pudo finalizar la grabación del audio.';
          session.recorderEnded = true;
          settle(session);
        }
      } else if (session && captureAudio && !session.recorderEnded) {
        // getUserMedia may still be resolving; its completion handler will close the stream.
      } else if (session) {
        session.recorderEnded = true;
      }
      try { session?.recognition?.stop(); } catch {
        if (session) session.recognitionEnded = true;
        if (session) settle(session);
      }
      setNotice('Finalizando audio y transcripción…');
      return;
    }

    const speechWindow = window as any;
    const SpeechRecognitionConstructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setNotice('Este navegador no admite transcripción automática por voz. Abre ARIA en Chrome actualizado y permite el micrófono.');
      return;
    }

    const session: VoiceSession = {
      transcript: '',
      recognitionError: '',
      audioError: '',
      recognitionEnded: false,
      recorderEnded: !captureAudio,
      finished: false,
      audioFile: null,
      recognition: null,
      recorder: null,
      stream: null,
      chunks: []
    };
    sessionRef.current = session;

    try {
      const recognition = new SpeechRecognitionConstructor() as SpeechRecognitionLike;
      session.recognition = recognition;
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
          session.transcript = [session.transcript, ...finalParts].filter(Boolean).join(' ').trim();
          setNotice('Transcribiendo… puedes detener el dictado cuando termines.');
        }
      };
      recognition.onerror = (event: any) => {
        const code = String(event?.error || 'unknown');
        session.recognitionError = ERROR_MESSAGES[code] || 'No se pudo transcribir el audio (' + code + ').';
      };
      recognition.onend = () => {
        session.recognitionEnded = true;
        settle(session);
      };
      activeRef.current = true;
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
      setNotice(captureAudio ? 'Preparando audio y transcripción… habla ahora.' : 'Escuchando… habla ahora.');
      if (captureAudio) void startAudioCapture(session);
      else settle(session);
    } catch {
      activeRef.current = false;
      session.recognitionEnded = true;
      session.recorderEnded = true;
      session.recognitionError = 'No se pudo iniciar el micrófono. Comprueba los permisos del navegador.';
      settle(session);
    }
  }

  return (
    <span className={'voiceInputControl ' + className}>
      <button
        type='button'
        className='voiceInputButton'
        aria-label={listening ? 'Detener grabación y transcripción' : captureAudio ? 'Grabar y adjuntar audio con transcripción' : 'Dictar por voz y transcribir'}
        aria-pressed={listening}
        onClick={toggleDictation}
      >
        {listening ? '■ Detener' : '🎙️ Audio'}
      </button>
      {notice && <span className='voiceInputNotice' role='status' aria-live='polite'>{notice}</span>}
    </span>
  );
}

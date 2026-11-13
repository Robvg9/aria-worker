import { useEffect, useRef, useState } from 'react';
import { resolveVoiceRecognitionLocale } from './voiceWakeWord';

type VoiceInputButtonProps = {
  onTranscript: (transcript: string) => void | Promise<unknown>;
  onAudio?: (audio: File) => void;
  captureAudio?: boolean;
  autoSubmit?: boolean;
  buttonLabel?: string;
  listeningLabel?: string;
  disabled?: boolean;
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

type NativeSpeechRecognitionResult = {
  transcript: string;
  language: string;
  recognitionMode: 'on_device';
  durationMs: number;
};

type NativeSpeechRecognitionBridge = {
  recognizeUtterance(input: { max_duration_ms: number; language: string }): Promise<NativeSpeechRecognitionResult>;
  cancelRecognition(): Promise<{ accepted: boolean }>;
};

function getNativeSpeechBridge(): NativeSpeechRecognitionBridge | null {
  const host = window as any;
  const capability = host.__ariaVoiceV4NativeContext?.voice?.speechRecognition;
  const bridge = host.ariaVoiceV4;
  if (capability?.available !== true
      || capability?.mode !== 'on_device'
      || capability?.explicitActivationOnly !== true
      || capability?.audioLeavesDevice !== false
      || typeof bridge?.recognizeUtterance !== 'function'
      || typeof bridge?.cancelRecognition !== 'function') {
    return null;
  }
  return bridge as NativeSpeechRecognitionBridge;
}

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
  autoSubmit = false,
  buttonLabel = '🎙️ Audio',
  listeningLabel = '■ Detener',
  disabled = false,
  className = ''
}: VoiceInputButtonProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const activeRef = useRef(false);
  const nativeRecognitionRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onAudioRef = useRef(onAudio);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onAudioRef.current = onAudio; }, [onAudio]);

  useEffect(() => () => {
    activeRef.current = false;
    if (nativeRecognitionRef.current) {
      nativeRecognitionRef.current = false;
      try { void (window as any).ariaVoiceV4?.cancelRecognition?.(); } catch {}
    }
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
      if (autoSubmit) {
        setNotice('Transcripción recibida. ARIA está preparando tu respuesta…');
        Promise.resolve()
          .then(() => onTranscriptRef.current(transcript))
          .then(result => setNotice(result === false
            ? 'ARIA no pudo completar la respuesta. Revisa el error del chat.'
            : 'Respuesta recibida. Puedes hablar de nuevo.'))
          .catch(() => setNotice('No se pudo completar la respuesta. Revisa el error del chat.'));
      } else {
        onTranscriptRef.current(transcript);
        if (session.audioFile) setNotice('Audio adjuntado y transcripción insertada. Revisa el texto y pulsa Enviar.');
        else if (session.audioError) setNotice('Transcripción insertada; no se pudo adjuntar el audio: ' + session.audioError);
        else setNotice('Transcripción insertada. Revísala y envíala.');
      }
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

  async function startNativeRecognition(bridge: NativeSpeechRecognitionBridge) {
    nativeRecognitionRef.current = true;
    activeRef.current = true;
    setListening(true);
    const language = resolveVoiceRecognitionLocale(navigator.language, navigator.languages);
    setNotice('Reconocimiento local de Android activado. Habla ahora; el audio no sale del teléfono…');
    try {
      let result: NativeSpeechRecognitionResult;
      try {
        result = await bridge.recognizeUtterance({
          max_duration_ms: 8000,
          language
        });
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (['voice_asr_language_unsupported', 'voice_asr_language_unavailable'].includes(code)
            && language.toLowerCase() !== 'es-es'
            && nativeRecognitionRef.current) {
          setNotice('El motor local no admite el idioma preferido. Probando español general…');
          result = await bridge.recognizeUtterance({
            max_duration_ms: 8000,
            language: 'es-ES'
          });
        } else {
          throw cause;
        }
      }
      if (!nativeRecognitionRef.current) return;
      const transcript = String(result?.transcript || '').trim();
      if (!transcript) {
        setNotice('No se recibió una transcripción. Inténtalo otra vez.');
        return;
      }
      if (autoSubmit) {
        setNotice('Transcripción local recibida. ARIA está preparando tu respuesta…');
        const response = await onTranscriptRef.current(transcript);
        setNotice(response === false
          ? 'ARIA no pudo completar la respuesta. Revisa el error del chat.'
          : 'Respuesta recibida. Puedes hablar de nuevo.');
      } else {
        await onTranscriptRef.current(transcript);
        setNotice('Transcripción local insertada. Revísala y envíala.');
      }
    } catch (cause) {
      if (!nativeRecognitionRef.current) return;
      const code = cause instanceof Error ? cause.message : '';
      const messages: Record<string, string> = {
        voice_asr_on_device_unavailable: 'El reconocimiento local no está disponible en este teléfono. No se envió audio a un servicio remoto.',
        voice_asr_permission_required: 'Permite el micrófono a ARIA Unificada en los ajustes de Android.',
        voice_asr_language_unsupported: 'El motor local no admite el español seleccionado.',
        voice_asr_language_unavailable: 'El paquete local de español no está disponible en este teléfono.',
        voice_asr_no_match: 'No detecté una frase clara. Inténtalo otra vez.',
        voice_asr_speech_timeout: 'No detecté voz antes del tiempo límite.',
        voice_asr_timeout: 'Se agotó la ventana de escucha de 8 segundos.',
        voice_asr_busy: 'Ya hay otro reconocimiento de voz activo.',
        voice_asr_listener_active: 'Detén primero la captura PCM del panel Voice y vuelve a pulsar Hablar.',
        voice_asr_audio_error: 'Android no pudo acceder al micrófono.',
        voice_asr_start_failed: 'Android no pudo iniciar el reconocimiento local.',
        voice_asr_cancelled: 'Dictado local detenido.'
      };
      setNotice(messages[code] || 'Falló el reconocimiento local (' + (code || 'voice_asr_failed') + '). No se envió audio a un servicio remoto.');
    } finally {
      nativeRecognitionRef.current = false;
      activeRef.current = false;
      setListening(false);
    }
  }

  function toggleDictation() {
    if (listening && nativeRecognitionRef.current) {
      nativeRecognitionRef.current = false;
      activeRef.current = false;
      setListening(false);
      setNotice('Deteniendo reconocimiento local…');
      const bridge = getNativeSpeechBridge();
      if (bridge) {
        void bridge.cancelRecognition().then(() => setNotice('Dictado local detenido.'))
          .catch(() => setNotice('Se solicitó detener el dictado local.'));
      } else {
        setNotice('Dictado local detenido.');
      }
      return;
    }
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

    const nativeHost = (window as any).ariaNativeBridge?.platform === 'android';
    if (nativeHost) {
      const nativeBridge = getNativeSpeechBridge();
      if (nativeBridge) {
        void startNativeRecognition(nativeBridge);
      } else {
        setNotice('El reconocimiento local no está disponible en este teléfono. No se enviará audio a un servicio remoto; puedes escribir el mensaje.');
      }
      return;
    }

    const speechWindow = window as any;
    const SpeechRecognitionConstructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setNotice('Este navegador no admite transcripción automática por voz. Permite el micrófono o utiliza el teclado.');
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
      const startRecognition = (locale: string) => {
        const recognition = new SpeechRecognitionConstructor() as SpeechRecognitionLike;
        session.recognition = recognition;
        recognition.lang = locale;
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
          if (code === 'language-not-supported' && locale !== 'es-ES') {
            session.recognitionError = '';
            setNotice('El español configurado no está disponible; probando español general…');
            try {
              recognition.onend = null;
              recognition.abort?.();
              startRecognition('es-ES');
              return;
            } catch {
              session.recognitionError = ERROR_MESSAGES[code] || 'El navegador no admite el idioma seleccionado.';
              session.recognitionEnded = true;
              settle(session);
            }
          } else {
            session.recognitionError = ERROR_MESSAGES[code] || 'No se pudo transcribir el audio (' + code + ').';
          }
        };
        recognition.onend = () => {
          if (session.recognition !== recognition) return;
          session.recognitionEnded = true;
          settle(session);
        };
        recognitionRef.current = recognition;
        recognition.start();
      };

      activeRef.current = true;
      startRecognition(resolveVoiceRecognitionLocale(navigator.language, navigator.languages));
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
        disabled={disabled}
        className='voiceInputButton'
        aria-label={listening ? listeningLabel : buttonLabel}
        aria-pressed={listening}
        onClick={toggleDictation}
      >
        {listening ? listeningLabel : buttonLabel}
      </button>
      {notice && <span className='voiceInputNotice' role='status' aria-live='polite'>{notice}</span>}
    </span>
  );
}

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

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permite el acceso al micrófono en el navegador y vuelve a intentarlo.',
  'service-not-allowed': 'El navegador bloqueó el servicio de transcripción por voz.',
  'audio-capture': 'No se detectó un micrófono disponible.',
  'no-speech': 'No detecté voz. Pulsa Audio e inténtalo otra vez.',
  network: 'El servicio de transcripción no está disponible en este momento.',
  aborted: 'Dictado detenido.'
};

const NATIVE_ERROR_MESSAGES: Record<string, string> = {
  voice_asr_permission_required: 'Android no concedió el permiso del micrófono. Actívalo para ARIA Unificada y vuelve a intentarlo.',
  voice_asr_on_device_unavailable: 'Este teléfono no tiene disponible el reconocimiento de voz sin conexión. No se enviará el audio a un servicio remoto.',
  voice_asr_language_invalid: 'El idioma de reconocimiento no está disponible en este teléfono.',
  voice_asr_language_unsupported: 'Este Android tampoco admite el modelo local de español general (es-ES). Instala un paquete de español compatible en los ajustes de reconocimiento de voz.',
  voice_asr_language_unavailable: 'El modelo local de español es compatible, pero todavía no está descargado. Descarga el paquete de español en los ajustes de reconocimiento de voz de Android.',
  voice_asr_no_match: 'No pude reconocer palabras. Habla cerca del micrófono y haz una pausa al terminar.',
  voice_asr_timeout: 'Se agotó el tiempo de escucha. Pulsa Dictar y prueba una frase más corta.',
  voice_asr_listener_active: 'Detén primero la escucha residente antes de usar Dictar.',
  voice_asr_busy: 'Ya hay otro reconocimiento de voz en curso.',
  voice_asr_start_failed: 'Android no pudo iniciar el reconocimiento local.'
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
    const session = sessionRef.current;
    if (nativeRecognitionRef.current) {
      nativeRecognitionRef.current = false;
      try { void (window as any).ariaVoiceV4?.cancelRecognition?.(); } catch {}
    }
    try { session?.recognition?.abort?.(); } catch {}
    try { if (session?.recorder?.state === 'recording') session.recorder.stop(); } catch {}
    session?.stream?.getTracks().forEach(track => track.stop());
    recognitionRef.current = null;
    sessionRef.current = null;
  }, []);

  async function deliverTranscript(transcript: string, audioAttached = false, audioError = '', localeFallback = '') {
    const localeNote = localeFallback
      ? 'Se utilizó el modelo local de español general (' + localeFallback + '). '
      : '';
    if (autoSubmit) {
      setNotice(localeNote + 'Transcripción recibida. ARIA está preparando tu respuesta…');
      try {
        const result = await onTranscriptRef.current(transcript);
        setNotice(localeNote + (result === false
          ? 'ARIA no pudo completar la respuesta. Revisa el error del chat.'
          : 'Respuesta recibida. Puedes hablar de nuevo.'));
      } catch {
        setNotice(localeNote + 'No se pudo completar la respuesta. Revisa el error del chat.');
      }
      return;
    }
    onTranscriptRef.current(transcript);
    if (audioAttached) setNotice(localeNote + 'Audio adjuntado y transcripción insertada. Revisa el texto y pulsa Enviar.');
    else if (audioError) setNotice(localeNote + 'Transcripción insertada; no se pudo adjuntar el audio: ' + audioError);
    else setNotice(localeNote + 'Transcripción insertada. Revísala y envíala.');
  }

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
      void deliverTranscript(transcript, Boolean(session.audioFile), session.audioError);
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

  async function startNativeRecognition(bridge: any, locale: string) {
    activeRef.current = true;
    nativeRecognitionRef.current = true;
    setListening(true);
    setNotice('Escuchando en este Android… di tu frase y haz una pausa para terminar. El audio no se adjunta.');

    let recognitionLanguage = locale;
    try {
      let result: any;
      try {
        result = await bridge.recognizeUtterance({ max_duration_ms: 8000, language: recognitionLanguage });
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : 'voice_asr_failed';
        const mayUseGeneralSpanish = code === 'voice_asr_language_unsupported'
          || code === 'voice_asr_language_unavailable';
        if (!mayUseGeneralSpanish || recognitionLanguage.toLowerCase() === 'es-es') throw cause;

        recognitionLanguage = 'es-ES';
        setNotice('Android no tiene disponible el modelo local de ' + locale
          + '. Probando español general (es-ES)… El audio permanece en este teléfono.');
        result = await bridge.recognizeUtterance({ max_duration_ms: 8000, language: recognitionLanguage });
      }

      if (!activeRef.current || !nativeRecognitionRef.current) return;
      if (!result || typeof result.transcript !== 'string'
          || !result.transcript.trim() || result.transcript.length > 2000
          || result.language !== recognitionLanguage || result.recognitionMode !== 'on_device'
          || !Number.isSafeInteger(result.durationMs)
          || result.durationMs < 0 || result.durationMs > 11000) {
        throw new Error('voice_asr_response_invalid');
      }
      activeRef.current = false;
      nativeRecognitionRef.current = false;
      setListening(false);
      await deliverTranscript(
        result.transcript.trim(),
        false,
        '',
        recognitionLanguage !== locale ? recognitionLanguage : ''
      );
    } catch (cause) {
      if (!activeRef.current || !nativeRecognitionRef.current) return;
      activeRef.current = false;
      nativeRecognitionRef.current = false;
      setListening(false);
      const code = cause instanceof Error ? cause.message : 'voice_asr_failed';
      setNotice(NATIVE_ERROR_MESSAGES[code] || 'No se pudo transcribir la voz en este Android (' + code + ').');
    }
  }

  function toggleDictation() {
    if (listening) {
      if (nativeRecognitionRef.current) {
        activeRef.current = false;
        nativeRecognitionRef.current = false;
        setListening(false);
        setNotice('Cancelando dictado…');
        const bridge = (window as any).ariaVoiceV4;
        Promise.resolve(bridge?.cancelRecognition?.())
          .then(() => setNotice('Dictado cancelado. No se envió ningún audio.'))
          .catch(() => setNotice('No se pudo cancelar el dictado. Cierra y vuelve a abrir la pantalla PWA.'));
        return;
      }
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
    if (!captureAudio && (speechWindow.ReactNativeWebView || speechWindow.__ariaVoiceV4NativeContext)) {
      const nativeContext = speechWindow.__ariaVoiceV4NativeContext;
      if (!nativeContext) {
        setNotice('El puente de voz de ARIA todavía se está conectando. Espera a que la PWA termine de cargar y vuelve a pulsar Dictar.');
        return;
      }
      if (nativeContext.contract !== 'aria-native-bridge-v2' || nativeContext.platform !== 'android') {
        setNotice('El puente nativo de voz no corresponde a este dispositivo Android.');
        return;
      }
      const capability = nativeContext.voice?.speechRecognition;
      const bridge = speechWindow.ariaVoiceV4;
      if (capability?.available !== true || capability.mode !== 'on_device'
          || capability.explicitActivationOnly !== true || capability.audioLeavesDevice !== false
          || typeof bridge?.recognizeUtterance !== 'function'
          || typeof bridge?.cancelRecognition !== 'function') {
        setNotice('El reconocimiento local sin conexión no está disponible en este teléfono. No grabaré ni adjuntaré un audio como sustituto.');
        return;
      }
      void startNativeRecognition(bridge, resolveVoiceRecognitionLocale(navigator.language, navigator.languages));
      return;
    }
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
        aria-label={listening ? (nativeRecognitionRef.current ? 'Cancelar dictado' : listeningLabel) : buttonLabel}
        aria-pressed={listening}
        onClick={toggleDictation}
      >
        {listening ? (nativeRecognitionRef.current ? '■ Cancelar' : listeningLabel) : buttonLabel}
      </button>
      {notice && <span className='voiceInputNotice' role='status' aria-live='polite'>{notice}</span>}
    </span>
  );
}

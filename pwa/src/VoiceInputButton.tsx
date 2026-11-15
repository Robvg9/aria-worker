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


type NativeRecognitionSupport = {
  requestedLanguage: string;
  installedOnDeviceLanguages: string[];
  pendingOnDeviceLanguages: string[];
  supportedOnDeviceLanguages: string[];
};

type NativeModelDownloadResult = {
  state: 'downloaded' | 'scheduled' | 'requested';
  language: string;
};

type NativeVoiceBridge = {
  getRecognitionSupport: (input: { language: string }) => Promise<NativeRecognitionSupport>;
  downloadRecognitionModel: (input: { language: string }) => Promise<NativeModelDownloadResult>;
  recognizeUtterance: (input: { max_duration_ms: number; language: string }) => Promise<{
    transcript: string;
    language: string;
    recognitionMode: 'on_device';
    durationMs: number;
  }>;
  cancelRecognition: () => Promise<{ accepted: boolean }>;
};

function getNativeVoiceRuntime(): {
  bridge: NativeVoiceBridge | null;
  speechAvailable: boolean;
  modelManagementAvailable: boolean;
} | null {
  const runtime = window as any;
  const context = runtime.__ariaVoiceV4NativeContext
    || runtime.ariaNativeBridge?.getContext?.();
  if (context?.platform !== 'android') return null;
  const speech = context?.voice?.speechRecognition;
  return {
    bridge: runtime.ariaVoiceV4 || null,
    speechAvailable: speech?.available === true
      && speech?.mode === 'on_device'
      && speech?.explicitActivationOnly === true
      && speech?.audioLeavesDevice === false,
    modelManagementAvailable: speech?.modelManagementAvailable === true
  };
}

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
  const onTranscriptRef = useRef(onTranscript);
  const onAudioRef = useRef(onAudio);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const modelPreparationRef = useRef(false);
  const nativeRecognitionActiveRef = useRef(false);
  const nativeBridgeRef = useRef<NativeVoiceBridge | null>(null);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onAudioRef.current = onAudio; }, [onAudio]);

  useEffect(() => () => {
    activeRef.current = false;
    if (nativeRecognitionActiveRef.current) {
      nativeRecognitionActiveRef.current = false;
      const activeBridge = nativeBridgeRef.current;
      if (activeBridge) {
        try { void activeBridge.cancelRecognition().catch(() => undefined); } catch {}
      }
    }
    nativeBridgeRef.current = null;
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


  async function ensureSpanishOfflineModel(
    bridge: NativeVoiceBridge,
    onStatus: (message: string) => void
  ): Promise<NativeModelDownloadResult> {
    const preferred = resolveVoiceRecognitionLocale(navigator.language, navigator.languages);
    const localeOrder = Array.from(new Set([preferred, 'es-CU', 'es-PR', 'es-US', 'es-MX', 'es-ES']));
    const installed = new Set<string>();
    const pending = new Set<string>();
    const supported = new Set<string>();
    const queried: string[] = [];

    const progressHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== 'object' || typeof detail.language !== 'string') return;
      if (detail.state === 'downloading') {
        const progress = Number.isFinite(detail.progress) ? Math.max(0, Math.min(100, detail.progress)) : null;
        onStatus(progress === null
          ? 'Descargando el modelo español sin conexión…'
          : 'Descargando el modelo español sin conexión… ' + progress + '%');
      } else if (detail.state === 'downloaded') {
        onStatus('Modelo español local instalado: ' + detail.language + '.');
      } else if (detail.state === 'scheduled' || detail.state === 'requested') {
        onStatus('Android programó la descarga del modelo ' + detail.language + '.');
      } else if (detail.state === 'error') {
        onStatus('Falló la descarga del modelo español. Código ' + String(detail.errorCode ?? 'desconocido') + '.');
      }
    };

    window.addEventListener('aria-voice-model-download-status', progressHandler);
    try {
      for (const locale of localeOrder) {
        try {
          const support = await bridge.getRecognitionSupport({ language: locale });
          queried.push(locale);
          support.installedOnDeviceLanguages.forEach(value => installed.add(value.toLowerCase()));
          support.pendingOnDeviceLanguages.forEach(value => pending.add(value.toLowerCase()));
          support.supportedOnDeviceLanguages.forEach(value => supported.add(value.toLowerCase()));
        } catch (error) {
          const code = String((error as any)?.message || '');
          if (code.includes('voice_asr_model_management_unavailable')
              || code.includes('voice_asr_on_device_unavailable')) throw error;
          // Unsupported regional locales and providers without the support
          // query are handled by trying the next Spanish locale.
        }
      }

      const pick = (languages: Set<string>): string | null => {
        for (const locale of localeOrder) {
          if (languages.has(locale.toLowerCase())) return locale;
        }
        return Array.from(languages).find(value => /^es-[a-z0-9-]+$/i.test(value)) || null;
      };

      const installedLocale = pick(installed);
      if (installedLocale) {
        onStatus('Modelo español local ya instalado: ' + installedLocale + '.');
        return { state: 'downloaded', language: installedLocale };
      }

      const pendingLocale = pick(pending);
      const supportedLocale = pick(supported);
      // If the provider cannot enumerate supported locales, prefer general
      // Spanish after having queried every allowed region rather than blindly
      // requesting the device dialect that may have caused the original miss.
      const targetLanguage = pendingLocale
        || supportedLocale
        || (queried.includes('es-ES') ? 'es-ES' : (queried[queried.length - 1] || 'es-ES'));
      onStatus('Comprobando/solicitando modelo español ' + targetLanguage + '…');

      // Triggering the request is safe even for a pending model: Android's
      // provider may resume it, ask for approval, or report it as scheduled.
      const result = await bridge.downloadRecognitionModel({ language: targetLanguage });
      if (result.state === 'downloaded') {
        onStatus('Modelo español local listo: ' + result.language + '.');
      } else if (result.state === 'scheduled' || result.state === 'requested') {
        onStatus('Android dejó programada la descarga de ' + result.language + '. Vuelve a pulsar cuando esté lista.');
      }
      return result;
    } finally {
      window.removeEventListener('aria-voice-model-download-status', progressHandler);
    }
  }

  async function deliverNativeTranscript(transcriptValue: string) {
    const transcript = String(transcriptValue || '').trim();
    if (!transcript) {
      setNotice('No se obtuvo una transcripción. Habla con claridad e inténtalo de nuevo.');
      return;
    }
    if (autoSubmit) {
      setNotice('Transcripción local recibida. ARIA está preparando tu respuesta…');
      try {
        const result = await onTranscriptRef.current(transcript);
        setNotice(result === false
          ? 'ARIA no pudo completar la respuesta. Revisa el error del chat.'
          : 'Respuesta recibida. Puedes hablar de nuevo.');
      } catch {
        setNotice('No se pudo completar la respuesta. Revisa el error del chat.');
      }
    } else {
      onTranscriptRef.current(transcript);
      setNotice('Transcripción local insertada. Revísala y envíala.');
    }
  }

  async function beginAndroidDictation(bridge: NativeVoiceBridge) {
    activeRef.current = true;
    modelPreparationRef.current = true;
    nativeBridgeRef.current = bridge;
    setListening(true);
    setNotice('Comprobando el modelo español sin conexión…');
    let handedOffToBrowser = false;

    try {
      const model = await ensureSpanishOfflineModel(bridge, setNotice);
      if (!activeRef.current) return;
      if (model.state !== 'downloaded') {
        setNotice(model.state === 'scheduled' || model.state === 'requested'
          ? 'La descarga quedó programada. Cuando Android termine, pulsa Audio otra vez.'
          : 'El modelo español todavía no está listo.');
        return;
      }

      modelPreparationRef.current = false;
      if (captureAudio) {
        // Preserve the existing audio-attachment flow. The model is prepared
        // first; Web Speech and MediaRecorder then run as before.
        activeRef.current = false;
        nativeBridgeRef.current = null;
        setListening(false);
        handedOffToBrowser = true;
        toggleDictation(true, model.language);
        return;
      }

      nativeRecognitionActiveRef.current = true;
      setNotice('Escuchando localmente. Puedes hacer pausas breves; finalizará tras 2,5 segundos de silencio (máximo 30 segundos).');
      const result = await bridge.recognizeUtterance({
        max_duration_ms: 30000,
        language: model.language
      });
      if (activeRef.current) {
        if (result.recognitionMode !== 'on_device'
            || result.language !== model.language
            || typeof result.transcript !== 'string') {
          throw new Error('voice_asr_response_invalid');
        }
        await deliverNativeTranscript(result.transcript);
      }
    } catch (error) {
      if (activeRef.current) {
        const code = String((error as any)?.message || 'voice_asr_failed');
        setNotice(code.includes('voice_asr_language_unavailable')
          ? 'El modelo español todavía no está disponible. Comprueba la descarga y vuelve a intentarlo.'
          : code.includes('voice_asr_cancelled')
            ? 'Dictado detenido.'
            : 'El dictado local falló: ' + code);
      }
    } finally {
      if (!handedOffToBrowser) {
        activeRef.current = false;
        modelPreparationRef.current = false;
        nativeRecognitionActiveRef.current = false;
        nativeBridgeRef.current = null;
        setListening(false);
      }
    }
  }

  function toggleDictation(skipModelPreparation = false, preparedLanguage?: string) {
    if (listening) {
      activeRef.current = false;
      if (modelPreparationRef.current) {
        modelPreparationRef.current = false;
        setListening(false);
        setNotice('Preparación detenida. Si Android continúa descargando el modelo, no se activará el micrófono.');
        return;
      }
      if (nativeRecognitionActiveRef.current) {
        nativeRecognitionActiveRef.current = false;
        const bridge = nativeBridgeRef.current;
        void bridge?.cancelRecognition().catch(() => {});
        setListening(false);
        setNotice('Cancelando dictado local…');
        return;
      }
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

    if (!skipModelPreparation) {
      const nativeRuntime = getNativeVoiceRuntime();
      if (nativeRuntime) {
        if (!nativeRuntime.speechAvailable || !nativeRuntime.modelManagementAvailable || !nativeRuntime.bridge) {
          setNotice('Este Android no ofrece el administrador de modelos de voz local. ARIA no enviará audio a un servicio remoto como alternativa.');
          return;
        }
        void beginAndroidDictation(nativeRuntime.bridge);
        return;
      }
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
      startRecognition(preparedLanguage || resolveVoiceRecognitionLocale(navigator.language, navigator.languages));
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

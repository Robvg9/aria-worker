import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyHandsFreeCommand, extractWakeWordRemainder } from './voiceWakeWord';
import { stopAssistantSpeech } from './voiceOutput';
import { appendVoiceDiagnostic, readVoiceDiagnostics } from './voiceDiagnostics';

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop?: () => void;
  abort?: () => void;
};

type HandsFreeVoiceControlProps = {
  onTranscript: (transcript: string) => void | boolean | Promise<unknown>;
  onEnabledChange?: (enabled: boolean) => void;
  disabled?: boolean;
};

const SILENCE_TO_SEND_MS = 1650;
const WAKE_WORD_WAIT_MS = 7000;

function getRecognitionConstructor(): (new () => RecognitionLike) | null {
  const speechWindow = window as any;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

export function HandsFreeVoiceControl({
  onTranscript,
  onEnabledChange,
  disabled = false
}: HandsFreeVoiceControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Manos libres apagado.');
  const [wakeArmed, setWakeArmed] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const enabledRef = useRef(false);
  const visibleRef = useRef(!document.hidden);
  const speechActiveRef = useRef(false);
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const cursorRef = useRef(0);
  const wakeArmedRef = useRef(false);
  const transcriptBufferRef = useRef('');
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const wakeTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const restartDelayRef = useRef(350);
  const onTranscriptRef = useRef(onTranscript);
  const onEnabledChangeRef = useRef(onEnabledChange);
  const [diagnosticExportStatus, setDiagnosticExportStatus] = useState('');
  const [diagnosticCount, setDiagnosticCount] = useState(() => readVoiceDiagnostics().length);

  const recordDiagnostic = useCallback((event: string, details: Record<string, unknown> = {}) => {
    const result = appendVoiceDiagnostic(event, details);
    setDiagnosticCount(result.count);
  }, []);

  const copyDiagnostics = useCallback(async () => {
    try {
      const payload = JSON.stringify(readVoiceDiagnostics(), null, 2);
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(payload);
      setDiagnosticExportStatus('Diagnóstico técnico copiado. No contiene audio ni transcripciones.');
    } catch {
      setDiagnosticExportStatus('No se pudo copiar el diagnóstico en este navegador.');
    }
  }, []);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onEnabledChangeRef.current = onEnabledChange; }, [onEnabledChange]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current != null) window.clearTimeout(ref.current);
    ref.current = null;
  };

  const clearTurnTimers = useCallback(() => {
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    if (wakeTimerRef.current != null) window.clearTimeout(wakeTimerRef.current);
    silenceTimerRef.current = null;
    wakeTimerRef.current = null;
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    try { void lock?.release?.(); } catch {}
  }, []);

  const acquireWakeLock = useCallback(async () => {
    const wakeLockApi = (navigator as any).wakeLock;
    if (!enabledRef.current || !visibleRef.current || !wakeLockApi?.request || wakeLockRef.current) return;
    try {
      const lock = await wakeLockApi.request('screen');
      if (!enabledRef.current || !visibleRef.current) {
        await lock.release?.();
        return;
      }
      wakeLockRef.current = lock;
      lock.addEventListener?.('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Wake Lock is optional; speech recognition remains available.
    }
  }, []);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      if (typeof recognition.abort === 'function') recognition.abort();
      else recognition.stop?.();
    } catch {}
  }, []);

  const resetWakeTurn = useCallback(() => {
    clearTurnTimers();
    wakeArmedRef.current = false;
    transcriptBufferRef.current = '';
    setWakeArmed(false);
  }, [clearTurnTimers]);

  const scheduleRestart = useCallback((delay = restartDelayRef.current) => {
    if (!enabledRef.current || !visibleRef.current || speechActiveRef.current || inFlightRef.current || disabledRef.current || disposedRef.current) return;
    if (restartTimerRef.current != null) window.clearTimeout(restartTimerRef.current);
    recordDiagnostic('restart_scheduled', { restart_delay_ms: delay });
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      startRecognitionRef.current?.();
    }, delay);
  }, [recordDiagnostic]);

  const submitWakeTurn = useCallback(async () => {
    const transcript = transcriptBufferRef.current.trim();
    if (!transcript || inFlightRef.current) return;
    recordDiagnostic('turn_submitted', { chars: transcript.length });
    resetWakeTurn();
    inFlightRef.current = true;
    clearTimer(restartTimerRef);
    stopRecognition();
    setStatus('Enviando tu consulta a ARIA…');
    try {
      const result = await onTranscriptRef.current(transcript);
      if (result === false) setStatus('No se pudo completar la respuesta. Di «ARIA» para intentarlo otra vez.');
      else setStatus('Respuesta procesada. Esperando «ARIA»…');
    } catch {
      setStatus('No se pudo completar la respuesta. Di «ARIA» para intentarlo otra vez.');
    } finally {
      inFlightRef.current = false;
      if (enabledRef.current && visibleRef.current && !speechActiveRef.current && !disabledRef.current) {
        scheduleRestart(300);
      }
    }
  }, [recordDiagnostic, resetWakeTurn, scheduleRestart, stopRecognition]);

  const appendWakeText = useCallback((phrase: string) => {
    transcriptBufferRef.current = [transcriptBufferRef.current, phrase].filter(Boolean).join(' ').trim().slice(0, 1600);
    if (wakeTimerRef.current != null) window.clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = null;
    setStatus('Te escucho… termina la frase y haré una pausa antes de responder.');
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      void submitWakeTurn();
    }, SILENCE_TO_SEND_MS);
  }, [submitWakeTurn]);

  const handleFinalPhrase = useCallback((phrase: string) => {
    const clean = String(phrase || '').trim();
    if (!clean) return;
    recordDiagnostic('final_result', { chars: clean.length });
    if (!wakeArmedRef.current) {
      const remainder = extractWakeWordRemainder(clean);
      if (remainder === null) {
        recordDiagnostic('wake_rejected', { phrase_chars: clean.length, wake_matched: false });
        return;
      }
      recordDiagnostic('wake_match', { phrase_chars: clean.length, command_chars: remainder.length, wake_matched: true });
      wakeArmedRef.current = true;
      setWakeArmed(true);
      setStatus('Palabra «ARIA» detectada. Te escucho…');
      const command = classifyHandsFreeCommand(remainder);
      if (command === 'stop-listening') {
        setStatus('Escucha continua apagada por comando de voz.');
        enabledRef.current = false;
        setEnabled(false);
        onEnabledChangeRef.current?.(false);
        clearTimer(restartTimerRef);
        clearTurnTimers();
        stopRecognition();
        releaseWakeLock();
        resetWakeTurn();
        return;
      }
      if (command === 'stop-speaking') {
        stopAssistantSpeech();
        resetWakeTurn();
        setStatus('De acuerdo. Sigo escuchando; di «ARIA» cuando me necesites.');
        return;
      }
      if (remainder) {
        appendWakeText(remainder);
      } else {
        wakeTimerRef.current = window.setTimeout(() => {
          wakeTimerRef.current = null;
          if (!transcriptBufferRef.current.trim()) {
            resetWakeTurn();
            setStatus('No escuché una pregunta. Di «ARIA» para volver a activar.');
          }
        }, WAKE_WORD_WAIT_MS);
      }
      return;
    }
    appendWakeText(clean);
  }, [appendWakeText, clearTurnTimers, recordDiagnostic, releaseWakeLock, resetWakeTurn, stopRecognition]);

  const startRecognitionRef = useRef<(() => void) | null>(null);
  const startRecognition = useCallback(() => {
    if (!enabledRef.current || !visibleRef.current || speechActiveRef.current || inFlightRef.current || disabledRef.current || recognitionRef.current || disposedRef.current) return;
    const Constructor = getRecognitionConstructor();
    if (!Constructor) {
      recordDiagnostic('api_missing', { reason: 'speech_recognition_unsupported' });
      setStatus('Este navegador no ofrece reconocimiento de voz continuo. Usa Chrome actualizado.');
      enabledRef.current = false;
      setEnabled(false);
      onEnabledChangeRef.current?.(false);
      releaseWakeLock();
      return;
    }
    try {
      recordDiagnostic('recognition_start_attempt', { language: 'es-PR' });
      const recognition = new Constructor();
      recognition.lang = 'es-PR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      cursorRef.current = 0;
      recognition.onresult = (event: any) => {
        const results = event?.results;
        if (!results) return;
        const start = Math.max(cursorRef.current, Math.max(0, Number(event?.resultIndex) || 0));
        for (let index = start; index < results.length; index += 1) {
          const item = results[index];
          if (!item?.isFinal) continue;
          cursorRef.current = index + 1;
          restartDelayRef.current = 350;
          handleFinalPhrase(String(item?.[0]?.transcript || ''));
        }
      };
      recognition.onerror = (event: any) => {
        const code = String(event?.error || 'unknown');
        recordDiagnostic('recognition_error', { error: code });
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
          enabledRef.current = false;
          setEnabled(false);
          onEnabledChangeRef.current?.(false);
          clearTimer(restartTimerRef);
          clearTurnTimers();
          releaseWakeLock();
          setStatus(code === 'audio-capture'
            ? 'No se encontró un micrófono disponible.'
            : 'El navegador bloqueó el micrófono o el servicio de reconocimiento. Revisa sus permisos.');
          return;
        }
        if (code === 'network') setStatus('El servicio de reconocimiento perdió la conexión; intentaré recuperarlo.');
      };
      recognition.onend = () => {
        recordDiagnostic('recognition_end');
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        restartDelayRef.current = Math.min(2600, Math.max(350, restartDelayRef.current * 1.6));
        scheduleRestart(restartDelayRef.current);
      };
      recognitionRef.current = recognition;
      recognition.start();
      recordDiagnostic('recognition_started', { language: 'es-PR' });
      setStatus(wakeArmedRef.current ? 'Te escucho…' : 'Escuchando. Di «ARIA» para hablar conmigo.');
    } catch (error: any) {
      recordDiagnostic('recognition_start_failed', { error: String(error?.name || 'unknown') });
      recognitionRef.current = null;
      setStatus('No se pudo iniciar el reconocimiento. Comprueba el permiso del micrófono.');
      scheduleRestart(1600);
    }
  }, [clearTurnTimers, handleFinalPhrase, recordDiagnostic, releaseWakeLock, scheduleRestart]);

  startRecognitionRef.current = startRecognition;

  const disable = useCallback((message = 'Manos libres apagado.') => {
    recordDiagnostic('voice_disabled');
    enabledRef.current = false;
    setEnabled(false);
    onEnabledChangeRef.current?.(false);
    clearTimer(restartTimerRef);
    clearTurnTimers();
    resetWakeTurn();
    stopRecognition();
    releaseWakeLock();
    setStatus(message);
  }, [clearTurnTimers, recordDiagnostic, releaseWakeLock, resetWakeTurn, stopRecognition]);

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      disable();
      return;
    }
    if (!getRecognitionConstructor()) {
      recordDiagnostic('api_missing', { reason: 'speech_recognition_unsupported' });
      setStatus('Este navegador no admite escucha continua. Abre ARIA en Chrome actualizado.');
      return;
    }
    disposedRef.current = false;
    recordDiagnostic('voice_enabled', { language: 'es-PR' });
    const permissionsApi = (navigator as any).permissions;
    if (typeof permissionsApi?.query === 'function') {
      void permissionsApi.query({ name: 'microphone' })
        .then((permission: any) => recordDiagnostic('permission_snapshot', {
          permission_state: String(permission?.state || 'unknown')
        }))
        .catch(() => recordDiagnostic('permission_snapshot', { permission_state: 'unavailable' }));
    } else {
      recordDiagnostic('permission_snapshot', { permission_state: 'unsupported' });
    }
    enabledRef.current = true;
    setEnabled(true);
    onEnabledChangeRef.current?.(true);
    setStatus('Activando escucha continua…');
    void acquireWakeLock();
    startRecognition();
  }, [acquireWakeLock, disable, recordDiagnostic, startRecognition]);

  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = !document.hidden;
      if (document.hidden) {
        recordDiagnostic('page_hidden');
        clearTimer(restartTimerRef);
        stopRecognition();
        releaseWakeLock();
        setStatus('Escucha pausada porque ARIA está en segundo plano.');
      } else if (enabledRef.current) {
        recordDiagnostic('page_visible');
        void acquireWakeLock();
        setStatus('Reanudando escucha… di «ARIA».');
        scheduleRestart(250);
      }
    };
    const handlePageHide = () => {
      recordDiagnostic('page_hide');
      disable('Escucha detenida al salir de ARIA.');
    };
    const handleSpeechStart = () => {
      speechActiveRef.current = true;
      clearTimer(restartTimerRef);
      stopRecognition();
      setStatus('ARIA está respondiendo…');
    };
    const handleSpeechEnd = () => {
      speechActiveRef.current = false;
      if (enabledRef.current && visibleRef.current && !disabledRef.current) {
        setStatus('Respuesta terminada. Esperando «ARIA»…');
        scheduleRestart(300);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('aria-voice-output-start', handleSpeechStart);
    window.addEventListener('aria-voice-output-end', handleSpeechEnd);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('aria-voice-output-start', handleSpeechStart);
      window.removeEventListener('aria-voice-output-end', handleSpeechEnd);
      disposedRef.current = true;
      enabledRef.current = false;
      clearTimer(restartTimerRef);
      clearTurnTimers();
      stopRecognition();
      releaseWakeLock();
      onEnabledChangeRef.current?.(false);
    };
  }, [acquireWakeLock, clearTurnTimers, disable, recordDiagnostic, releaseWakeLock, scheduleRestart, stopRecognition]);

  useEffect(() => {
    if (disabled) {
      clearTimer(restartTimerRef);
      stopRecognition();
      setStatus('Procesando la última consulta…');
    } else if (enabledRef.current && visibleRef.current && !speechActiveRef.current && !inFlightRef.current) {
      scheduleRestart(250);
    }
  }, [disabled, scheduleRestart, stopRecognition]);

  return (
    <div className={'handsFreeVoiceControl' + (enabled ? ' active' : '')} data-testid='hands-free-voice-control'>
      <button
        type='button'
        className={'handsFreeVoiceButton' + (enabled ? ' active' : '')}
        aria-pressed={enabled}
        disabled={disabled}
        onClick={toggle}
      >
        <span className='handsFreeVoiceIndicator' aria-hidden='true' />
        {enabled ? '■ Pausar manos libres' : '🎙️ Manos libres'}
      </button>
      <button
        type='button'
        className='handsFreeSilenceButton'
        aria-label='Detener la voz de ARIA'
        onClick={() => {
          stopAssistantSpeech();
          setStatus('Voz de ARIA detenida.');
        }}
      >
        🔇 Silencio
      </button>
      <span className='handsFreeVoiceStatus' role='status' aria-live='polite'>
        {status}{wakeArmed ? ' · frase activada' : ''}
      </span>
      <details className='handsFreeVoiceDiagnostics'>
        <summary>Diagnóstico técnico ({diagnosticCount})</summary>
        <p>Registra únicamente eventos, errores y capacidades del navegador. No guarda audio, palabras reconocidas, mensajes ni conversaciones.</p>
        <button type='button' onClick={copyDiagnostics}>Copiar diagnóstico</button>
        {diagnosticExportStatus && <span role='status' aria-live='polite'>{diagnosticExportStatus}</span>}
      </details>
      {enabled && (
        <small className='handsFreeVoicePrivacy'>
          El reconocimiento escucha mientras esta pestaña está visible; el navegador o su servicio puede procesar el audio. El diagnóstico local no guarda audio ni transcripciones. Esta PWA se pausa al ir a segundo plano y no funciona con la app cerrada o la pantalla bloqueada.
        </small>
      )}
    </div>
  );
}

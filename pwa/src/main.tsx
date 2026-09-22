import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

class BootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    const boot = document.getElementById('aria-boot');
    if (boot) {
      boot.dataset.state = 'error';
      boot.innerHTML =
        "<div class='card'><div class='mark'>ARIA</div><div class='title'>Error al iniciar ARIA</div>" +
        "<div class='detail'>" +
        String(error?.message || 'La interfaz encontró un error de arranque.') +
        "</div><button type='button' onclick='location.reload()'>RECARGAR</button></div>";
    }
  }

  render() {
    if (this.state.error) {
      return null;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ARIA root element is missing');
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <BootErrorBoundary>
        <App />
      </BootErrorBoundary>
    </StrictMode>
  );
  window.requestAnimationFrame(() => {
    (window as any).__ariaBootReady?.();
  });
} catch (error) {
  const boot = document.getElementById('aria-boot');
  if (boot) {
    boot.dataset.state = 'error';
    boot.innerHTML =
      "<div class='card'><div class='mark'>ARIA</div><div class='title'>Error al iniciar ARIA</div>" +
      "<div class='detail'>" +
      String(error instanceof Error ? error.message : error) +
      "</div><button type='button' onclick='location.reload()'>RECARGAR</button></div>";
  }
  throw error;
}

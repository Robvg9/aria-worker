import { Component, StrictMode, useEffect, type ReactNode } from 'react';
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

function BootReady({ children }: { children: ReactNode }) {
  useEffect(() => {
    (window as any).__ariaBootReady?.();
  }, []);
  return children;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ARIA root element is missing');
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <BootErrorBoundary>
        <BootReady>
          <App />
        </BootReady>
      </BootErrorBoundary>
    </StrictMode>
  );
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

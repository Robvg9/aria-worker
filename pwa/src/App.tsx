import { useEffect, useRef, useState } from 'react';
import { ProjectWorkspace } from './ProjectWorkspace';

// NOTE: Temporary partial - if you see this, full restore failed size limit
export default function App() {
  return (
    <main className="appShell" style={{ padding: 24 }}>
      <h1>ARIA</h1>
      <p>La restauración completa del App.tsx requiere un push de ~114KB.</p>
      <p>Abre un PR o usa git local para restaurar el archivo desde el commit 901709b640b7d19b8f89c09ce6f1b05b06c1805a y aplica el indicador swipeNav.</p>
    </main>
  );
}

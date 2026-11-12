import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Escala a interface conforme a resolução física real da tela.
// window.screen.width * devicePixelRatio = pixels físicos, independente
// do escalonamento do OS — resolve o caso de monitores ≥1920px com
// escala de 100% onde o layout aparece muito pequeno.
(function applyDisplayScale() {
  const dpr = window.devicePixelRatio || 1;
  const physW = window.screen.width * dpr;
  const zoom = physW >= 3840 ? 1.5
              : physW >= 2560 ? 1.25
              : physW >= 1920 ? 1.1
              : 1;
  if (zoom !== 1) {
    (document.documentElement.style as any).zoom = String(zoom);
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

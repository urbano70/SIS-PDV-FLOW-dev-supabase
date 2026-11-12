import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Quando o service worker é trocado (novo deploy), recarrega a página para
// garantir que o app rodará sempre com o JS mais recente e ficará em sincronia.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

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
    // Zoom no html faz h-screen parecer maior que o viewport e cria
    // scrollbar no body — bloqueia o scroll do documento para manter o
    // cabeçalho fixo; o scroll fica nos painéis internos (overflow-y-auto).
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

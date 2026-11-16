import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { applyDisplayScale } from './lib/displayScale';

// Atualizações e recarregamentos são controlados pelo botão do UpdateBanner.
// Trocar o service worker em outra aba não deve interromper uma operação aqui.

// A escala preserva a altura útil: 100vh sozinho seria ampliado pelo zoom e
// cortaria os totais/ações abaixo da janela, já que o documento não rola.
applyDisplayScale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

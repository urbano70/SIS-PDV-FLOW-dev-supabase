import { useState, useEffect } from 'react';

export type PWAApp = 'waiter' | 'kds' | 'dashboard' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePWA(app: PWAApp) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches);
  }, []);

  // Injeta o manifest correto no <head>
  useEffect(() => {
    if (!app) return;
    const href = app === 'waiter' ? '/manifest-waiter.webmanifest' : app === 'dashboard' ? '/manifest-dashboard.webmanifest' : '/manifest-kds.webmanifest';
    const themeColor = app === 'kds' ? '#0f172a' : '#141414';

    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = href;

    const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null;
    if (meta) meta.content = themeColor;
  }, [app]);

  // Captura o evento de instalação do browser
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setIsInstalled(true); setInstallPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  return { canInstall: !!installPrompt && !isInstalled, isInstalled, install };
}

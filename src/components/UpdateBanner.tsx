import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import socket from '../lib/socket';
import { LATEST_PR } from '../version';
import { isDifferentBuild, updateAppManually } from '../lib/appUpdate';

export default function UpdateBanner() {
  const [remoteBuildId, setRemoteBuildId] = useState('');
  const dismissalKey = `pdv_update_dismissed:${__BUILD_ID__}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(dismissalKey) || ''; } catch { return ''; }
  });
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh],
  } = useRegisterSW({
    onRegisteredSW(_url, value) { registration.current = value; },
    // Another tab activating the worker must not reload this tab mid-operation.
    onNeedReload() { setExternalUpdate(true); },
    onRegisterError() { registration.current = undefined; },
  });

  useEffect(() => {
    const receiveBuild = (value: unknown) => {
      setRemoteBuildId(isDifferentBuild(value, __BUILD_ID__)
        ? (value as { buildId: string }).buildId : '');
    };
    // Compatibility with servers that have not yet adopted build identifiers.
    const receiveLegacyVersion = (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > LATEST_PR) {
        setRemoteBuildId(`legacy:${value}`);
      }
    };
    const check = () => {
      socket.emit('request_app_version');
      if (navigator.onLine) void registration.current?.update().catch(() => {});
    };
    socket.on('app_version', receiveBuild);
    socket.on('server_version', receiveLegacyVersion);
    socket.on('connect', check);
    window.addEventListener('focus', check);
    // The initial connection event may have occurred before this component mounted.
    check();
    return () => {
      socket.off('app_version', receiveBuild);
      socket.off('server_version', receiveLegacyVersion);
      socket.off('connect', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const updateKey = remoteBuildId || (needRefresh || externalUpdate ? 'pwa-update' : '');
  if (!updateKey || (dismissed === updateKey && !error)) return null;

  const update = async () => {
    if (updating) return;
    setUpdating(true);
    setError('');
    try {
      await updateAppManually(
        registration.current,
        'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
        () => window.location.reload(),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar. Tente novamente.');
      setUpdating(false);
    }
  };

  return (
    <div className="fixed top-2 right-2 z-[9999] pointer-events-none max-w-[calc(100vw-1rem)]">
      <div role="status" className="bg-white text-[#141414] border border-[#141414]/15 rounded-xl px-3 py-2 shadow-sm pointer-events-auto max-w-sm">
        <p className="font-medium text-xs leading-tight">Atualização disponível</p>
        <p className="text-[10px] opacity-60 mt-0.5">Atualize quando concluir sua operação.</p>
        {error && <p role="alert" className="text-xs text-red-300 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-1.5">
          <button disabled={updating} onClick={() => {
            setDismissed(updateKey);
            setError('');
            try { sessionStorage.setItem(dismissalKey, updateKey); } catch {}
          }} className="text-xs px-2 py-1 rounded-lg disabled:opacity-50">Mais tarde</button>
          <button disabled={updating} onClick={update} className="bg-[#141414] text-white font-medium text-xs px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-50">
            {updating ? 'Atualizando...' : 'Atualizar agora'}
          </button>
        </div>
      </div>
    </div>
  );
}

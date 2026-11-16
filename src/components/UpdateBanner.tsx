import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import socket from '../lib/socket';
import { LATEST_PR } from '../version';
import { isDifferentBuild, updateAppManually } from '../lib/appUpdate';

export default function UpdateBanner() {
  const [remoteBuildId, setRemoteBuildId] = useState('');
  const [dismissed, setDismissed] = useState('');
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
    <div className="fixed top-0 left-0 right-0 z-[9999] p-4 pointer-events-none">
      <div role="status" className="bg-[#141414] text-[#E4E3E0] rounded-2xl p-4 shadow-2xl pointer-events-auto max-w-lg mx-auto">
        <p className="font-bold text-sm leading-tight">Atualização disponível</p>
        <p className="text-xs opacity-60 mt-1">Conclua a operação atual antes de atualizar. A tela só será recarregada ao clicar em atualizar.</p>
        {error && <p role="alert" className="text-xs text-red-300 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button disabled={updating} onClick={() => { setDismissed(updateKey); setError(''); }} className="text-sm px-3 py-2 rounded-xl disabled:opacity-50">Mais tarde</button>
          <button disabled={updating} onClick={update} className="bg-white text-[#141414] font-bold text-sm px-4 py-2 rounded-xl active:scale-95 transition-transform disabled:opacity-50">
            {updating ? 'Atualizando...' : 'Atualizar agora'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import socket from '../lib/socket';
import { LATEST_PR } from '../version';
import { isDifferentBuild, updateAppManually } from '../lib/appUpdate';

export default function UpdateBanner() {
  const location = useLocation();
  const isDashboard = location.pathname.startsWith('/app/dashboard');
  const [remoteBuildId, setRemoteBuildId] = useState('');
  const dismissalKey = `pdv_update_dismissed:${__BUILD_ID__}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(dismissalKey) || ''; } catch { return ''; }
  });
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
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

  // Fora do dashboard: atualiza silenciosamente sem mostrar banner
  const silentUpdateDone = useRef(false);
  useEffect(() => {
    if (isDashboard || !updateKey || silentUpdateDone.current) return;
    silentUpdateDone.current = true;
    updateAppManually(
      registration.current,
      'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
      () => window.location.reload(),
    ).catch(() => window.location.reload());
  }, [isDashboard, updateKey]);

  if (!updateKey || !isDashboard || (dismissed === updateKey && !error)) return null;

  const doUpdate = async () => {
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

  const handleUpdateClick = () => {
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setCleaning(true);
    // Tenta limpar todos os pedidos e mesas antes de atualizar.
    // Se falhar (ex: não é admin), continua com a atualização mesmo assim.
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 5000);
      socket.emit('force_release_all_tables', {}, (ack: any) => {
        clearTimeout(timeout);
        resolve();
      });
      // Fallback: se o servidor não mandar ack em 5s, continua mesmo assim
    });
    setCleaning(false);
    setShowConfirm(false);
    doUpdate();
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  return (
    <>
      {/* Popup de confirmação */}
      {showConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-5">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-sm text-[#141414]">Atualizar o sistema</p>
                <p className="text-xs text-[#141414]/60 mt-1 leading-relaxed">
                  Esta atualização irá <span className="font-semibold text-red-600">cancelar todos os pedidos em aberto</span> nas mesas e liberar todas as mesas. Os itens não serão cobrados nos relatórios.
                </p>
                <p className="text-xs text-[#141414]/50 mt-2">Confirme apenas se não houver pedidos em andamento.</p>
              </div>
            </div>
            {error && <p role="alert" className="text-xs text-red-500 mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button
                disabled={cleaning}
                onClick={handleCancel}
                className="flex-1 py-2 rounded-xl border border-[#141414]/15 text-sm font-medium text-[#141414]/70 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                disabled={cleaning}
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-xl bg-[#141414] text-white text-sm font-bold hover:bg-[#141414]/90 transition-colors active:scale-95 disabled:opacity-50"
              >
                {cleaning ? 'Limpando...' : 'Confirmar e atualizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner de atualização disponível */}
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
            <button disabled={updating} onClick={handleUpdateClick} className="bg-[#141414] text-white font-medium text-xs px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-50">
              {updating ? 'Atualizando...' : 'Atualizar agora'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

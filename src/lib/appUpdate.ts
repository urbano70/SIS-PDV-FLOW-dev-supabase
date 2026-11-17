export interface PublishedAppVersion {
  buildId: string;
  version: string;
  builtAt: string;
}

export function isDifferentBuild(value: unknown, localBuildId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const buildId = (value as Partial<PublishedAppVersion>).buildId;
  return typeof buildId === 'string' && buildId.trim().length > 0 && buildId !== localBuildId;
}

function waitForInstallation(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (worker.state === 'installed' || worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('A nova versão não pôde ser instalada.'));
    };
    const timeout = setTimeout(() => finish(new Error('A atualização ainda está sendo baixada. Tente novamente.')), 8000);
    worker.addEventListener('statechange', check);
    check();
  });
}

function activateWaitingWorker(
  worker: ServiceWorker,
  container: ServiceWorkerContainer | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      container?.removeEventListener('controllerchange', check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      // Activation is sufficient: a page that was not controlled may not emit
      // controllerchange until navigation, even though the new worker is ready.
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('A nova versão não pôde ser ativada. Tente novamente.'));
    };
    const timeout = setTimeout(() => {
      if (worker.state === 'activated') finish();
      else finish(new Error('Não foi possível ativar a atualização. Tente novamente.'));
    }, 8000);
    worker.addEventListener('statechange', check);
    container?.addEventListener('controllerchange', check);
    check();
    if (settled) return;
    try {
      // Target the captured waiting worker; requesting activation is not proof
      // that the browser has completed it, so keep observing its real state.
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error('Não foi possível solicitar a ativação da atualização.'));
    }
  });
}

/** Called only from the user's update button; errors never trigger a reload. */
export async function updateAppManually(
  registration: ServiceWorkerRegistration | undefined,
  serviceWorker: ServiceWorkerContainer | undefined,
  reload: () => void,
): Promise<void> {
  if (registration) {
    await registration.update();
    if (registration.installing) await waitForInstallation(registration.installing);
    // Capture once: activation in another tab can clear registration.waiting.
    const waiting = registration.waiting;
    // On failure keep the current screen and its in-progress operation intact.
    if (waiting) await activateWaitingWorker(waiting, serviceWorker);
  }
  reload();
}

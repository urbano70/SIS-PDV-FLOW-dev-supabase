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
    const timeout = setTimeout(() => finish(new Error('A atualização ainda está sendo baixada. Tente novamente.')), 20000);
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Called only from the user's update button; errors never trigger a reload. */
export async function updateAppManually(
  registration: ServiceWorkerRegistration | undefined,
  activateUpdate: () => Promise<void>,
  serviceWorker: ServiceWorkerContainer | undefined,
  reload: () => void,
): Promise<void> {
  if (registration) {
    await registration.update();
    if (registration.installing) await waitForInstallation(registration.installing);
  }

  if (registration?.waiting && serviceWorker) {
    // Observe before activation so a fast controllerchange cannot be missed.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        serviceWorker.removeEventListener('controllerchange', changed);
        error ? reject(error) : resolve();
      };
      const changed = () => finish();
      const timeout = setTimeout(() => finish(new Error('Não foi possível ativar a atualização. Tente novamente.')), 20000);
      serviceWorker.addEventListener('controllerchange', changed);
      Promise.resolve().then(activateUpdate).catch(error => finish(error));
    });
  }
  reload();
}

export function getDisplayScale(screenWidth: number, devicePixelRatio: number): number {
  const physicalWidth = screenWidth * (devicePixelRatio || 1);
  return physicalWidth >= 3840 ? 1.5
    : physicalWidth >= 2560 ? 1.25
    : physicalWidth >= 1920 ? 1.1
    : 1;
}

/** Keep viewport-sized panels inside the visible window even with CSS zoom. */
export function applyDisplayScale(win: Window = window): () => void {
  const root = win.document.documentElement;
  const update = () => {
    const scale = win.innerHeight < 600 ? 1 : getDisplayScale(win.screen.width, win.devicePixelRatio);
    (root.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale);
    root.style.setProperty('--app-display-scale', String(scale));
    root.style.setProperty('--app-viewport-height', `${win.innerHeight / scale}px`);
    root.style.setProperty('--app-viewport-width', `${win.innerWidth / scale}px`);
  };
  update();
  win.addEventListener('resize', update);
  return () => win.removeEventListener('resize', update);
}

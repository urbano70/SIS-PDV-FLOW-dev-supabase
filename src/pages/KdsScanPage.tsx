import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type ScanResult = { ok: boolean; message: string };

const PAUSE_AFTER_SCAN_MS = 5000; // pause camera loop after each successful scan

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = ok ? 880 : 300;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.25 : 0.4));
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.25 : 0.4));
    setTimeout(() => ctx.close(), 600);
  } catch { /* ignore — AudioContext not available */ }
}

export default function KdsScanPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const pausedUntilRef = useRef<number>(0); // timestamp until which scanning is paused
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!token) return;
    if (!('BarcodeDetector' in window)) {
      setSupported(false);
      return;
    }

    let stream: MediaStream | null = null;
    // @ts-ignore — BarcodeDetector is not in lib.dom yet
    const detector = new BarcodeDetector({ formats: ['code_128', 'qr_code'] });

    const scan = async () => {
      // During post-scan pause, skip detection
      if (Date.now() < pausedUntilRef.current) {
        rafRef.current = requestAnimationFrame(scan);
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) { rafRef.current = requestAnimationFrame(scan); return; }

      try {
        const barcodes = await detector.detect(video);
        for (const bc of barcodes) {
          const value: string = bc.rawValue;
          // Only process barcodes that look like KDS codes (contain '|')
          if (!value.includes('|')) continue;
          // If still within debounce window, skip
          if (Date.now() < pausedUntilRef.current) break;
          pausedUntilRef.current = Date.now() + PAUSE_AFTER_SCAN_MS;
          setPaused(true);
          await sendBarcode(value);
          break; // process one barcode per frame
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(scan);
    };

    const sendBarcode = async (barcode: string) => {
      try {
        const res = await fetch('/api/kds/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode, token }),
        });
        const data = await res.json();
        const ok = res.ok && data.ok !== false;
        beep(ok);
        setResult({ ok, message: data.message || (ok ? 'OK' : 'Erro') });
        // Show result, then show pause countdown
        setTimeout(() => {
          setResult(null);
        }, 2500);
      } catch {
        beep(false);
        setResult({ ok: false, message: 'Falha na conexão' });
        setTimeout(() => setResult(null), 2500);
      } finally {
        // Resume scanner after pause window
        setTimeout(() => {
          pausedUntilRef.current = 0;
          setPaused(false);
        }, PAUSE_AFTER_SCAN_MS);
      }
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; }
        setScanning(true);
        rafRef.current = requestAnimationFrame(scan);
      })
      .catch(() => setSupported(false));

    return () => {
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [token]);

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
        <div className="text-center">
          <p className="text-xl font-bold">Token inválido</p>
          <p className="text-sm text-gray-400 mt-2">Escaneie o QR code das configurações do KDS.</p>
        </div>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
        <div className="text-center">
          <p className="text-xl font-bold">Câmera indisponível</p>
          <p className="text-sm text-gray-400 mt-2">Use o Chrome no Android para escanear códigos de barras.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 bg-black/80 px-4 py-3 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${paused ? 'bg-yellow-400' : scanning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
        <span className="text-white text-sm font-semibold">Scanner KDS</span>
        <span className="text-gray-400 text-xs ml-auto">
          {paused ? 'Aguarde...' : scanning ? 'Aguardando código...' : 'Iniciando câmera...'}
        </span>
      </div>

      {/* Camera feed */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Scan frame overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-32 relative">
            <div className={`absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 rounded-tl-md ${paused ? 'border-yellow-400' : 'border-white'}`} />
            <div className={`absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 rounded-tr-md ${paused ? 'border-yellow-400' : 'border-white'}`} />
            <div className={`absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 rounded-bl-md ${paused ? 'border-yellow-400' : 'border-white'}`} />
            <div className={`absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 rounded-br-md ${paused ? 'border-yellow-400' : 'border-white'}`} />
            {paused && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-yellow-400 text-xs font-bold tracking-widest uppercase">Aguarde</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Result banner */}
      <div className={`shrink-0 transition-all duration-300 ${result ? 'h-16' : 'h-0'} overflow-hidden`}>
        {result && (
          <div className={`h-16 flex items-center justify-center px-4 ${result.ok ? 'bg-green-600' : 'bg-red-600'}`}>
            <span className="text-white font-semibold text-center text-sm">{result.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

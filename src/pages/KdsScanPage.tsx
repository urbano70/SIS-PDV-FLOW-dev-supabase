import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type ScanResult = { ok: boolean; message: string };

export default function KdsScanPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const lastBarcodeRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
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
      const video = videoRef.current;
      if (!video || video.readyState < 2) { rafRef.current = requestAnimationFrame(scan); return; }
      try {
        const barcodes = await detector.detect(video);
        for (const bc of barcodes) {
          const value: string = bc.rawValue;
          const now = Date.now();
          if (value === lastBarcodeRef.current.value && now - lastBarcodeRef.current.at < 3000) continue;
          lastBarcodeRef.current = { value, at: now };
          sendBarcode(value);
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
        setResult({ ok: res.ok, message: data.message || (res.ok ? 'OK' : 'Erro') });
      } catch {
        setResult({ ok: false, message: 'Falha na conexão' });
      }
      setTimeout(() => setResult(null), 2500);
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
        <div className={`w-2 h-2 rounded-full ${scanning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
        <span className="text-white text-sm font-semibold">Scanner KDS</span>
        <span className="text-gray-400 text-xs ml-auto">{scanning ? 'Aguardando código...' : 'Iniciando câmera...'}</span>
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
            <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-white rounded-tl-md" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-white rounded-tr-md" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-white rounded-bl-md" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-white rounded-br-md" />
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

import React, { useEffect } from 'react';
import { Download, ArrowLeft } from 'lucide-react';

interface ReservationPreviewProps {
  blobUrl: string;
  filename: string;
  onBack: () => void;
}

export function ReservationPreview({ blobUrl, filename, onBack }: ReservationPreviewProps) {
  // Release the Object URL when this view is unmounted
  useEffect(() => {
    return () => { URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.click();
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <p className="text-center text-sm text-green-600 font-semibold">
        ✓ Sua reserva está pronta!
      </p>

      {/* PDF preview */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden border-2 border-[#141414]/10 bg-gray-50">
        <iframe
          src={blobUrl}
          title="Pré-visualização da reserva"
          className="w-full h-full min-h-[320px]"
        />
      </div>

      <div className="flex gap-3 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-[#141414]/10 text-sm font-bold hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={14} />
          Voltar
        </button>
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#141414] text-[#E4E3E0] text-sm font-bold uppercase tracking-widest hover:bg-[#2a2a2a] active:scale-95 transition-all"
        >
          <Download size={14} />
          Baixar PDF
        </button>
      </div>
    </div>
  );
}

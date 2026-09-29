import React, { useState, useEffect } from 'react';
import { X, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReservationForm } from './ReservationForm';
import { ReservationPreview } from './ReservationPreview';
import { ReservationConfig } from './ReservationConfig';
import { generateReservationPdf } from '../../lib/pdf/generatePdf';
import {
  loadReservationConfig,
  ReservationConfig as ReservationConfigType,
} from '../../lib/pdf/reservationConfig';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PdfReady {
  blobUrl: string;
  filename: string;
}

type View = 'form' | 'config' | 'preview';

const VIEW_TITLES: Record<View, string> = {
  form: 'Fazer Reserva',
  config: 'Configurações',
  preview: 'Sua Reserva',
};
const VIEW_SUBTITLES: Record<View, string> = {
  form: 'Informe o nome que será utilizado na sua reserva.',
  config: 'Personalize o template e a posição do nome no PDF.',
  preview: '',
};

export function ReservationModal({ isOpen, onClose }: ReservationModalProps) {
  const [view, setView] = useState<View>('form');
  const [pdfReady, setPdfReady] = useState<PdfReady | null>(null);
  const [config, setConfig] = useState<ReservationConfigType>(() => loadReservationConfig());

  // Reload config from localStorage each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setConfig(loadReservationConfig());
      setView('form');
      setPdfReady(null);
    }
  }, [isOpen]);

  const handleClose = () => {
    setPdfReady(null);
    setView('form');
    onClose();
  };

  const handleGenerate = async (name: string) => {
    const result = await generateReservationPdf({ name, fieldConfig: config.field });
    setPdfReady(result);
    setView('preview');
  };

  const handleConfigSaved = (next: ReservationConfigType) => {
    setConfig(next);
  };

  const canToggleConfig = view !== 'preview';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-7 pt-7 pb-4 shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold tracking-tight">{VIEW_TITLES[view]}</h2>
                {VIEW_SUBTITLES[view] && (
                  <p className="text-xs text-[#141414]/50 mt-0.5">{VIEW_SUBTITLES[view]}</p>
                )}
              </div>
              <div className="flex items-center gap-1 ml-3 shrink-0">
                {canToggleConfig && (
                  <button
                    onClick={() => setView(v => v === 'config' ? 'form' : 'config')}
                    title="Configurações"
                    className={`p-1.5 rounded-lg transition-colors ${
                      view === 'config'
                        ? 'bg-[#141414] text-[#E4E3E0]'
                        : 'text-[#141414]/40 hover:text-[#141414] hover:bg-gray-100'
                    }`}
                  >
                    <Settings size={15} />
                  </button>
                )}
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-lg text-[#141414]/40 hover:text-[#141414] hover:bg-gray-100 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-7 pb-7 min-h-0">
              <AnimatePresence mode="wait">
                {view === 'config' && (
                  <motion.div key="config" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                    <ReservationConfig config={config} onSaved={handleConfigSaved} />
                  </motion.div>
                )}
                {view === 'form' && (
                  <motion.div key="form" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                    <ReservationForm onGenerate={handleGenerate} />
                  </motion.div>
                )}
                {view === 'preview' && pdfReady && (
                  <motion.div key="preview" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                    <ReservationPreview
                      blobUrl={pdfReady.blobUrl}
                      filename={pdfReady.filename}
                      onBack={() => { setPdfReady(null); setView('form'); }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

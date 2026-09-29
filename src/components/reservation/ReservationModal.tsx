import React, { useState } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReservationForm } from './ReservationForm';
import { ReservationPreview } from './ReservationPreview';
import { generateReservationPdf } from '../../lib/pdf/generatePdf';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PdfReady {
  blobUrl: string;
  filename: string;
}

export function ReservationModal({ isOpen, onClose }: ReservationModalProps) {
  const [pdfReady, setPdfReady] = useState<PdfReady | null>(null);

  const handleClose = () => {
    setPdfReady(null);
    onClose();
  };

  const handleGenerate = async (name: string) => {
    const result = await generateReservationPdf({ name });
    setPdfReady(result);
  };

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
            <div className="flex items-center justify-between px-7 pt-7 pb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Fazer Reserva</h2>
                {!pdfReady && (
                  <p className="text-xs text-[#141414]/50 mt-0.5">
                    Informe o nome que será utilizado na sua reserva.
                  </p>
                )}
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-[#141414]/40 hover:text-[#141414] hover:bg-gray-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-7 pb-7 min-h-0">
              {pdfReady ? (
                <ReservationPreview
                  blobUrl={pdfReady.blobUrl}
                  filename={pdfReady.filename}
                  onBack={() => setPdfReady(null)}
                />
              ) : (
                <ReservationForm onGenerate={handleGenerate} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

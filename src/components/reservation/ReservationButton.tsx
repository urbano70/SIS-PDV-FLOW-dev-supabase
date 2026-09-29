import React, { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { ReservationModal } from './ReservationModal';

export function ReservationButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        title="Fazer Reserva"
        className="p-1.5 rounded-lg border transition-all bg-white text-[#141414]/40 border-[#141414]/10 hover:text-[#141414] hover:border-[#141414]/30"
      >
        <CalendarPlus size={12} />
      </button>

      <ReservationModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

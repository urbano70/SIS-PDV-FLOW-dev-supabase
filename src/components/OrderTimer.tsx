import React, { useState, useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';

interface OrderTimerProps {
  timestamp?: string;
  urgent?: boolean;
}

// Module-level session start so all OrderTimer instances share the same baseline
const SESSION_START_MS = Date.now();

export const OrderTimer = ({ timestamp, urgent }: OrderTimerProps) => {
  const [elapsed, setElapsed] = useState<string>('');

  useEffect(() => {
    if (!timestamp) return;

    const updateTimer = () => {
      // Use the later of the item timestamp or session start to avoid showing
      // stale times from previous shifts
      const rawStart = new Date(timestamp).getTime();
      const start = Math.max(rawStart, SESSION_START_MS);
      const diff = Math.floor((Date.now() - start) / 1000);

      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setElapsed(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  if (!timestamp) return null;

  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ml-2 flex items-center shrink-0 transition-colors ${
      urgent
        ? 'bg-red-500 text-white animate-pulse'
        : 'bg-gray-100 text-gray-500'
    }`}>
      <Clock size={10} className="mr-1 opacity-70" />
      {elapsed}
    </span>
  );
};

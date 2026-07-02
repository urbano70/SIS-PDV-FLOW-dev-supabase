import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface OrderTimerProps {
  timestamp?: string;
  urgent?: boolean;
  shiftStartedAt?: string;
  clockOffset?: number;
}

export const OrderTimer = ({ timestamp, urgent, shiftStartedAt, clockOffset = 0 }: OrderTimerProps) => {
  const [elapsed, setElapsed] = useState<string>('');

  useEffect(() => {
    if (!timestamp) return;

    const updateTimer = () => {
      const rawStart = new Date(timestamp).getTime();
      const start = shiftStartedAt
        ? Math.max(rawStart, new Date(shiftStartedAt).getTime())
        : rawStart;
      const diff = Math.max(0, Math.floor(((Date.now() - clockOffset) - start) / 1000));
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setElapsed(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [timestamp, shiftStartedAt, clockOffset]);

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

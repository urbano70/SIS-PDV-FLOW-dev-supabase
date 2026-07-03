import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface OrderTimerProps {
  timestamp?: string;
  urgent?: boolean;
  shiftStartedAt?: string;
  clockOffset?: number;
}

export const OrderTimer = ({ timestamp, urgent, clockOffset = 0 }: OrderTimerProps) => {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!timestamp) return;
    // Força re-render a cada segundo
    const interval = setInterval(() => tick(n => n + 1), 1000);
    // Em mobile, retoma a contagem quando a tela volta ao foco
    const onVisible = () => { if (document.visibilityState === 'visible') tick(n => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timestamp]);

  if (!timestamp) return null;

  // Computed inline: sem estado inicial vazio, sempre correto a cada render
  const diff = Math.max(0, Math.floor(((Date.now() - clockOffset) - new Date(timestamp).getTime()) / 1000));
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  const elapsed = `${mins}:${secs.toString().padStart(2, '0')}`;

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

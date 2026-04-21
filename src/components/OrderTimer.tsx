import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface OrderTimerProps {
  timestamp?: string;
}

export const OrderTimer = ({ timestamp }: OrderTimerProps) => {
  const [elapsed, setElapsed] = useState<string>('');

  useEffect(() => {
    if (!timestamp) return;

    const updateTimer = () => {
      const start = new Date(timestamp).getTime();
      const now = new Date().getTime();
      const diff = Math.floor((now - start) / 1000);
      
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
    <span className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 ml-2 flex items-center shrink-0">
      <Clock size={10} className="mr-1 opacity-50" />
      {elapsed}
    </span>
  );
};

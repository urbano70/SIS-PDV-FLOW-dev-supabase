import React, { useState, useEffect } from 'react';
import socket from '../lib/socket';
import { User, ShieldCheck, Smartphone } from 'lucide-react';
import { motion } from 'motion/react';

export default function SelfOnboarding() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    password: ''
  });
  const [isWaiting, setIsWaiting] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');

  useEffect(() => {
    const savedData = localStorage.getItem('waiter_credentials');
    if (savedData) {
      const data = JSON.parse(savedData);
      setFormData(data);
      // Try to login automatically if we have saved data
      socket.emit('waiter_login', { name: data.name, password: data.password });
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register') {
      setIsWaiting(true);
      socket.emit('waiter_register', formData);
    } else {
      socket.emit('waiter_login', { name: formData.name, password: formData.password });
    }
    localStorage.setItem('waiter_credentials', JSON.stringify(formData));
  };

  if (isWaiting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center space-y-6">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-24 h-24 bg-[#141414] rounded-full flex items-center justify-center"
        >
          <ShieldCheck className="text-[#E4E3E0] w-12 h-12" />
        </motion.div>
        <h2 className="font-serif italic text-3xl">Aguardando Aprovação</h2>
        <p className="text-sm opacity-60 max-w-xs">
          Seu cadastro foi enviado para o gerente. Por favor, aguarde a liberação no terminal administrativo.
        </p>
        <button 
          onClick={() => setIsWaiting(false)}
          className="text-xs underline opacity-50"
        >
          Voltar para o formulário
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white border-2 border-[#141414] rounded-3xl p-8 shadow-xl"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <Smartphone size={32} />
            <h1 className="font-serif italic text-2xl">
              {mode === 'register' ? 'Novo Cadastro' : 'Acessar Terminal'}
            </h1>
          </div>
          <button 
            onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
            className="text-xs font-bold underline"
          >
            {mode === 'register' ? 'Já tenho conta' : 'Novo cadastro'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold opacity-50 block mb-2">Nome Completo</label>
            <input 
              required
              type="text"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full p-4 bg-gray-50 border border-[#141414]/10 rounded-xl focus:outline-none focus:border-[#141414] transition-colors"
              placeholder="Ex: João Silva"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold opacity-50 block mb-2">Telefone</label>
              <input 
                required
                type="text"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                className="w-full p-4 bg-gray-50 border border-[#141414]/10 rounded-xl focus:outline-none focus:border-[#141414] transition-colors"
                placeholder="(00) 00000-0000"
              />
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold opacity-50 block mb-2">Senha de Acesso</label>
            <input 
              required
              type="password"
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              className="w-full p-4 bg-gray-50 border border-[#141414]/10 rounded-xl focus:outline-none focus:border-[#141414] transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-[#141414] text-[#E4E3E0] py-5 rounded-2xl font-bold text-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            {mode === 'register' ? 'Solicitar Acesso' : 'Entrar'}
          </button>
        </form>

        <p className="text-[10px] text-center mt-8 opacity-40">
          Ao solicitar acesso, você concorda com as políticas de segurança do estabelecimento.
        </p>
      </motion.div>
    </div>
  );
}

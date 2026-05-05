import { db } from './firebase';
import { doc, writeBatch } from 'firebase/firestore';
import { MENU_CATEGORIES } from '../constants';

export const getLocalSeedData = () => ({
  tables: Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    status: 'free' as const,
    currentOrder: null,
    linkedTo: null
  })),
  comandas: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    status: 'free' as const,
    currentOrder: null,
    linkedTo: null
  })),
  menu: MENU_CATEGORIES,
  isCashRegisterOpen: false,
});

export const seedDatabase = async () => {
  const batch = writeBatch(db);

  for (let i = 1; i <= 40; i++) {
    batch.set(doc(db, 'tables', i.toString()), {
      id: i, status: 'free', currentOrder: null, linkedTo: null
    });
  }

  for (let i = 1; i <= 50; i++) {
    batch.set(doc(db, 'comandas', i.toString()), {
      id: i, status: 'free', currentOrder: null, linkedTo: null
    });
  }

  for (const cat of MENU_CATEGORIES) {
    batch.set(doc(db, 'menu', cat.name), cat);
  }

  batch.set(doc(db, 'config', 'app'), {
    isCashRegisterOpen: false,
    dailyCounter: 0,
    lastOrderDate: ''
  });

  await batch.commit();
};

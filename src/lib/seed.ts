import { db } from './firebase';
import { collection, doc, writeBatch, setDoc } from 'firebase/firestore';
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from '../constants';

export const seedDatabase = async () => {
  console.log('Seeding database...');
  const batch = writeBatch(db);

  // Seed tables (1-40)
  for (let i = 1; i <= 40; i++) {
    const tableRef = doc(db, 'tables', i.toString());
    batch.set(tableRef, {
      id: i,
      status: 'free',
      currentOrder: null,
      linkedTo: null
    });
  }

  // Seed comandas (1-50)
  for (let i = 1; i <= 50; i++) {
    const comandaRef = doc(db, 'comandas', i.toString());
    batch.set(comandaRef, {
      id: i,
      status: 'free',
      currentOrder: null,
      linkedTo: null
    });
  }

  // Seed Menu
  for (const cat of MENU_CATEGORIES) {
    const catRef = doc(db, 'menu', cat.name);
    batch.set(catRef, cat);
  }

  // Seed Config
  const configRef = doc(db, 'config', 'app');
  batch.set(configRef, {
    isCashRegisterOpen: false,
    dailyCounter: 0,
    lastOrderDate: ''
  });

  await batch.commit();
  console.log('Database seeded successfully!');
};

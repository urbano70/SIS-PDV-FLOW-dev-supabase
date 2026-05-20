import { db } from './firebase';
import { collection, doc, writeBatch, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from '../constants';

const STOCK_ITEMS = [
  { id: "1", name: "Farinha de Trigo", quantity: 50, unit: "kg", minQuantity: 10 },
  { id: "2", name: "Queijo Mussarela", quantity: 30, unit: "kg", minQuantity: 5 },
  { id: "3", name: "Molho de Tomate", quantity: 20, unit: "L", minQuantity: 4 },
  { id: "4", name: "Calabresa", quantity: 15, unit: "kg", minQuantity: 3 },
  { id: "5", name: "Frango Desfiado", quantity: 12, unit: "kg", minQuantity: 3 },
  { id: "6", name: "Bacon", quantity: 10, unit: "kg", minQuantity: 2 },
  { id: "7", name: "Catupiry", quantity: 8, unit: "kg", minQuantity: 2 },
  { id: "8", name: "Camarão", quantity: 5, unit: "kg", minQuantity: 1 },
  { id: "9", name: "Pão de Hambúrguer", quantity: 50, unit: "un", minQuantity: 10 },
  { id: "10", name: "Hambúrguer de Carne", quantity: 40, unit: "un", minQuantity: 8 },
  { id: "11", name: "Presunto", quantity: 10, unit: "kg", minQuantity: 2 },
];

export const seedDatabase = async (onProgress: (step: string) => void) => {
  console.log('Seeding database...');
  
  onProgress('Limpando dados antigos...');
  // Clear orders and waiters
  const clearCollection = async (collName: string) => {
    const q = getDocs(collection(db, collName));
    const snapshot = await q;
    
    // Process in batches of 500 (Firestore limit)
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + 500);
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  };

  await clearCollection('orders');
  await clearCollection('waiters');
  await clearCollection('stock');
  await clearCollection('pizzaFlavors');
  await clearCollection('pizzaCrusts');
  
  const batch = writeBatch(db);

  onProgress('Configurando 40 mesas...');
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

  onProgress('Configurando 50 comandas...');
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

  onProgress('Carregando categorias do menu...');
  // Seed Menu
  for (const cat of MENU_CATEGORIES) {
    const catRef = doc(db, 'menu', cat.name);
    batch.set(catRef, cat);
  }

  onProgress('Carregando sabores e bordas...');
  // Seed Pizza Flavors
  for (const flavor of PIZZA_FLAVORS) {
    const flavorRef = doc(db, 'pizzaFlavors', flavor.name);
    batch.set(flavorRef, flavor);
  }

  // Seed Pizza Crusts
  for (const crust of PIZZA_CRUSTS) {
    const crustRef = doc(db, 'pizzaCrusts', crust);
    batch.set(crustRef, { name: crust });
  }

  onProgress('Carregando estoque...');
  // Seed Stock
  for (const item of STOCK_ITEMS) {
    const itemRef = doc(db, 'stock', item.id);
    batch.set(itemRef, item);
  }

  onProgress('Configurando sistema de caixa...');
  // Seed Config
  const configRef = doc(db, 'config', 'app');
  batch.set(configRef, {
    isCashRegisterOpen: false,
    dailyCounter: 0,
    lastOrderDate: ''
  });

  onProgress('Finalizando transação no Firestore...');
  try {
    await batch.commit();
    console.log('Database seeded successfully!');
    onProgress('Concluído!');
  } catch (error: any) {
    console.error('Error committing seed batch:', error);
    onProgress(`Erro: ${error.message || 'Erro desconhecido ao salvar'}`);
    throw error;
  }
};

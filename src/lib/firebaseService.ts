import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  getDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  increment,
  arrayUnion,
  addDoc
} from 'firebase/firestore';
import { db, auth, handleFirestoreError } from './firebase';
import { sanitizeForFirestore } from './utils';

// Helper to sync local state with Firestore
export const syncCollection = (collectionName: string, setter: (data: any[]) => void) => {
  try {
    const q = collection(db, collectionName);
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setter(data);
    }, (error) => handleFirestoreError(error, 'list', collectionName));
  } catch (error) {
    console.error(`Error syncing ${collectionName}:`, error);
  }
};

// Generic update document
export const updateDocument = async (collectionName: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, collectionName, docId);
    const sanitizedData = sanitizeForFirestore(data);
    await updateDoc(docRef, {
      ...sanitizedData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `${collectionName}/${docId}`);
  }
};

// Generic create document
export const createDocument = async (collectionName: string, data: any, docId?: string) => {
  try {
    const sanitizedData = sanitizeForFirestore(data);
    if (docId) {
      const docRef = doc(db, collectionName, docId);
      await setDoc(docRef, {
        ...sanitizedData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docId;
    } else {
      const colRef = collection(db, collectionName);
      const res = await addDoc(colRef, {
        ...sanitizedData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return res.id;
    }
  } catch (error) {
    handleFirestoreError(error, 'create', collectionName);
  }
};

// Specifically for orders
export const saveOrder = async (order: any) => {
  return createDocument('orders', order, order.id?.toString());
};

// Specifically for tables
export const updateTableStatus = async (tableId: number, status: string, orderId: string | null = null) => {
  return updateDocument('tables', tableId.toString(), { status, currentOrder: orderId });
};

// Specifically for cash register
export const toggleCashRegister = async (isOpen: boolean) => {
  try {
    const configRef = doc(db, 'config', 'app');
    await setDoc(configRef, { 
      isCashRegisterOpen: isOpen,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, 'update', 'config/app');
  }
};

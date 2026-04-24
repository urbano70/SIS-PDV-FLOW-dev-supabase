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
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `${collectionName}/${docId}`);
  }
};

// Generic create document
export const createDocument = async (collectionName: string, data: any, docId?: string) => {
  try {
    if (docId) {
      const docRef = doc(db, collectionName, docId);
      await setDoc(docRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docId;
    } else {
      const colRef = collection(db, collectionName);
      const res = await addDoc(colRef, {
        ...data,
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

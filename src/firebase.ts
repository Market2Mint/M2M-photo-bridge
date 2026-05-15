import { initializeApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Hard-coded config for gen-lang-client-0110207 stability
const firebaseConfig = {
  projectId: "gen-lang-client-0110207347",
  appId: "1:564116642975:web:1b1337d5aa9843a07256aa",
  apiKey: "AIzaSyDCX6gzbCEMfz1YtugUi7AAbE7TArma4wk",
  authDomain: "gen-lang-client-0110207347.firebaseapp.com",
  storageBucket: "gen-lang-client-0110207347.firebasestorage.app",
};

const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const db = getFirestore(app);

import { initializeApp } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyBnqCze2y2aW1cEUNResPpGlT3IzYMRSQs',
  authDomain: 'afiliadocdnx.firebaseapp.com',
  projectId: 'afiliadocdnx',
  storageBucket: 'afiliadocdnx.firebasestorage.app',
  messagingSenderId: '760879445698',
  appId: '1:760879445698:web:0bf32bb03cf9e39b73ed5b',
}

const app = initializeApp(firebaseConfig)
// Persistência FIXA (IndexedDB → localStorage), pra sessão não cair em memória e deslogar sozinho.
// O getAuth() no automático cai pra memória se o IndexedDB falhar (privacidade/anônimo/Brave) = logout aleatório.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver, // necessário pro signInWithPopup (Google)
})
export const db = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
export const storage = getStorage(app)
export default app

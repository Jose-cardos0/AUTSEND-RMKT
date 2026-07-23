import { initializeApp } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey: 'AIzaSyBnqCze2y2aW1cEUNResPpGlT3IzYMRSQs',
  authDomain: 'afiliadocdnx.firebaseapp.com',
  projectId: 'afiliadocdnx',
  storageBucket: 'afiliadocdnx.firebasestorage.app',
  messagingSenderId: '760879445698',
  appId: '1:760879445698:web:0bf32bb03cf9e39b73ed5b',
}

const app = initializeApp(firebaseConfig)

// App Check (anti-abuso): o app manda um token reCAPTCHA v3 que prova que a requisição veio do site real.
// A Site Key é PÚBLICA (fica na página e só vale nos domínios cadastrados) → fixada como fallback; dá pra
// sobrescrever via env VITE_RECAPTCHA_SITE_KEY. Depois a gente ENFORCE nas Cloud Functions pra bloquear
// chamadas de fora do app. (A Secret Key correspondente fica só no Firebase App Check, nunca aqui.)
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6Lfyw2AtAAAAAChZdxtjEjMFsF7bc4F3lbS6cZ6c'
if (RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (e) { console.warn('AppCheck init falhou:', e?.message || e) }
}

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

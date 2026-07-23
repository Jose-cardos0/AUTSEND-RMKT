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

// App Check (anti-abuso): só inicializa se a chave reCAPTCHA v3 estiver configurada (VITE_RECAPTCHA_SITE_KEY).
// Sem a chave → no-op (não quebra nada). Com a chave → o app passa a mandar um token que prova que a
// requisição veio do site real; depois a gente ENFORCE nas Cloud Functions pra bloquear chamadas de fora.
if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
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

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyBnqCze2y2aW1cEUNResPpGlT3IzYMRSQs',
  authDomain: 'afiliadocdnx.firebaseapp.com',
  projectId: 'afiliadocdnx',
  storageBucket: 'afiliadocdnx.firebasestorage.app',
  messagingSenderId: '760879445698',
  appId: '1:760879445698:web:0bf32bb03cf9e39b73ed5b',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
export default app

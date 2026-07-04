import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from './lib/firebase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Integracoes from './pages/Integracoes'
import Remarketing from './pages/Remarketing'
import RemarketingGrupos from './pages/RemarketingGrupos'
import EnviarMensagem from './pages/EnviarMensagem'
import Automacoes from './pages/Automacoes'
import EmailIntegracoes from './pages/email/EmailIntegracoes'
import Tracker from './pages/email/Tracker'
import EmailAutomacoes from './pages/email/EmailAutomacoes'
import EmailDisparos from './pages/email/EmailDisparos'
import EmailMetricas from './pages/email/EmailMetricas'
import EmailEmBreve from './pages/email/EmailEmBreve'
import PageLoader from './components/PageLoader'

const EmailConstrutor = lazy(() => import('./pages/email/EmailConstrutor'))
const EmailFunil = lazy(() => import('./pages/email/EmailFunil'))
import ParticlesBackground from './components/ParticlesBackground'

function ProtectedRoute({ children }) {
  const [user, loading] = useAuthState(auth)
  if (loading) {
    return (
      <ParticlesBackground className="flex px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
        <PageLoader label="Carregando sua sessão…" />
      </ParticlesBackground>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter basename="/rmkt">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fff',
            border: '1px solid #e2e5ea',
            borderRadius: '14px',
            boxShadow: '0 4px 24px -4px rgba(91, 94, 235, 0.12), 0 2px 6px rgba(0,0,0,0.04)',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#5b5eeb' },
          },
          error: {
            iconTheme: { primary: '#dc2626' },
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/integracoes" replace />} />
          <Route path="integracoes" element={<Integracoes />} />
          <Route path="automacoes" element={<Automacoes />} />
          <Route path="remarketing" element={<Remarketing />} />
          <Route path="remarketing-grupos" element={<RemarketingGrupos />} />
          <Route path="enviar-mensagem" element={<EnviarMensagem />} />
          <Route path="email/integracoes" element={<EmailIntegracoes />} />
          <Route path="email/tracker" element={<Tracker />} />
          <Route
            path="email/construtor"
            element={
              <Suspense fallback={<PageLoader label="Carregando editor…" />}>
                <EmailConstrutor />
              </Suspense>
            }
          />
          <Route path="email/automacoes" element={<EmailAutomacoes />} />
          <Route path="email/disparos" element={<EmailDisparos />} />
          <Route path="email/metricas" element={<EmailMetricas />} />
          <Route
            path="email/funil"
            element={
              <Suspense fallback={<PageLoader label="Carregando funil…" />}>
                <EmailFunil />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

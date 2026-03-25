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

function ProtectedRoute({ children }) {
  const [user, loading] = useAuthState(auth)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="animate-pulse text-stone-500">Carregando...</div>
      </div>
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

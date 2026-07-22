import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from './lib/firebase'
import Layout from './components/Layout'
import TermosDeUso from './components/TermosDeUso'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Integracoes from './pages/Integracoes'
import Remarketing from './pages/Remarketing'
import RemarketingGrupos from './pages/RemarketingGrupos'
import Atendentes from './pages/Atendentes'
import VendedorRelatorio from './pages/VendedorRelatorio'
import EnviarMensagem from './pages/EnviarMensagem'
import Automacoes from './pages/Automacoes'
import Checkouts from './pages/Checkouts'
import BancoLeads from './pages/BancoLeads'
import Admin from './pages/Admin'
import Perfil from './pages/Perfil'
import { isAdmin } from './lib/admin'
import MensagemTemplates from './pages/MensagemTemplates'
import EmailIntegracoes from './pages/email/EmailIntegracoes'
import Tracker from './pages/email/Tracker'
import EmailAutomacoes from './pages/email/EmailAutomacoes'
import EmailProdutos from './pages/email/EmailProdutos'
import EmailDisparos from './pages/email/EmailDisparos'
import EmailMetricas from './pages/email/EmailMetricas'
import EmailEmBreve from './pages/email/EmailEmBreve'
import SmsIntegracao from './pages/sms/SmsIntegracao'
import SmsDisparos from './pages/sms/SmsDisparos'
import SmsFunil from './pages/sms/SmsFunil'
import SmsAutomacoes from './pages/sms/SmsAutomacoes'
import SmsRemarketing from './pages/sms/SmsRemarketing'
import SmsMetricas from './pages/sms/SmsMetricas'
import CallIntegracao from './pages/call/CallIntegracao'
import CallCampanha from './pages/call/CallCampanha'
import CallAutomacoes from './pages/call/CallAutomacoes'
import CallFunil from './pages/call/CallFunil'
import CallMetricas from './pages/call/CallMetricas'
import PageLoader from './components/PageLoader'
import { ConfirmProvider } from './components/ConfirmDialog'
import { PlanoProvider, usePlano } from './lib/PlanoContext'

const EmailConstrutor = lazy(() => import('./pages/email/EmailConstrutor'))
const Docs = lazy(() => import('./pages/Docs'))
const EmailFunil = lazy(() => import('./pages/email/EmailFunil'))
const WhatsappFunil = lazy(() => import('./pages/WhatsappFunil'))
const WhatsappMetricas = lazy(() => import('./pages/WhatsappMetricas'))
import ParticlesBackground from './components/ParticlesBackground'

// Raiz: deslogado vê a Landing (rota pública), logado entra no app.
function RootRoute() {
  const [user, loading] = useAuthState(auth)
  if (loading) {
    return (
      <ParticlesBackground className="flex px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
        <PageLoader label="Carregando sua sessão…" />
      </ParticlesBackground>
    )
  }
  if (!user) return <Landing />
  return (
    <PlanoProvider>
      <GateApp />
    </PlanoProvider>
  )
}

/**
 * Portão de entrada do app. Enquanto o plano não carrega do backend, mostra loader.
 * Se o cliente ainda NÃO aceitou o Termo de Uso, renderiza SÓ o Termo — o Layout (app) nem
 * entra no DOM, então não dá pra burlar apagando elemento no DevTools nem digitando rota.
 */
function GateApp() {
  const { loading, isAdmin, termosAceito } = usePlano()
  if (loading) {
    return (
      <ParticlesBackground className="flex px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
        <PageLoader label="Verificando sua conta…" />
      </ParticlesBackground>
    )
  }
  if (!isAdmin && termosAceito === false) return <TermosDeUso />
  return <Layout />
}

function InicioRedirect() {
  const { temFeature, loading } = usePlano()
  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />
  if (temFeature('waIntegracoes')) return <Navigate to="/integracoes" replace />
  if (temFeature('emailIntegracoes')) return <Navigate to="/email/integracoes" replace />
  return <Navigate to="/tracker" replace />
}

function AdminRoute({ children }) {
  const [user, loading] = useAuthState(auth)
  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" label="Verificando acesso…" />
  if (!isAdmin(user)) return <Navigate to="/integracoes" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfirmProvider>
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
        {/* Documentação pública (linkada no rodapé da landing) */}
        <Route path="/docs" element={<Suspense fallback={<PageLoader className="min-h-screen" />}><Docs /></Suspense>} />
        <Route path="/" element={<RootRoute />}>
          <Route index element={<InicioRedirect />} />
          <Route path="integracoes" element={<Integracoes />} />
          <Route path="automacoes" element={<Automacoes />} />
          <Route path="remarketing" element={<Remarketing />} />
          <Route path="remarketing-grupos" element={<RemarketingGrupos />} />
          <Route path="atendentes" element={<Atendentes />} />
          <Route path="atendentes/relatorio" element={<VendedorRelatorio />} />
          <Route path="enviar-mensagem" element={<EnviarMensagem />} />
          <Route
            path="metricas"
            element={
              <Suspense fallback={<PageLoader label="Carregando métricas…" />}>
                <WhatsappMetricas />
              </Suspense>
            }
          />
          <Route
            path="funil"
            element={
              <Suspense fallback={<PageLoader label="Carregando funil…" />}>
                <WhatsappFunil />
              </Suspense>
            }
          />
          <Route path="tracker" element={<Tracker />} />
          <Route path="produtos" element={<EmailProdutos />} />
          <Route path="checkouts" element={<Checkouts />} />
          <Route path="banco-leads" element={<BancoLeads />} />
          <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="perfil" element={<Perfil />} />
          <Route path="templates" element={<MensagemTemplates />} />
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
          <Route path="email/produtos" element={<EmailProdutos />} />
          <Route path="email/automacoes" element={<EmailAutomacoes />} />
          <Route path="email/disparos" element={<EmailDisparos />} />
          <Route path="email/metricas" element={<EmailMetricas />} />
          <Route path="sms/integracao" element={<SmsIntegracao />} />
          {/* Canais de SMS: eua (nossa conta) | api (conta Telnyx do cliente). Param :canal. */}
          <Route path="sms/:canal/disparos" element={<SmsDisparos />} />
          <Route path="sms/:canal/funil" element={<SmsFunil />} />
          <Route path="sms/:canal/automacoes" element={<SmsAutomacoes />} />
          <Route path="sms/:canal/remarketing" element={<SmsRemarketing />} />
          <Route path="sms/:canal/metricas" element={<SmsMetricas />} />
          {/* Rotas antigas → redirecionam pro canal EUA (compat) */}
          <Route path="sms/disparos" element={<Navigate to="/sms/eua/disparos" replace />} />
          <Route path="sms/funil" element={<Navigate to="/sms/eua/funil" replace />} />
          <Route path="sms/automacoes" element={<Navigate to="/sms/eua/automacoes" replace />} />
          <Route path="sms/remarketing" element={<Navigate to="/sms/eua/remarketing" replace />} />
          <Route path="sms/metricas" element={<Navigate to="/sms/eua/metricas" replace />} />
          {/* Call Marketing IA — canal eua (nossa conta) | api (Telnyx do cliente). */}
          <Route path="call/:canal/integracao" element={<CallIntegracao />} />
          <Route path="call/:canal/campanha" element={<CallCampanha />} />
          <Route path="call/:canal/automacoes" element={<CallAutomacoes />} />
          <Route path="call/:canal/funil" element={<CallFunil />} />
          <Route path="call/:canal/metricas" element={<CallMetricas />} />
          <Route path="call/integracao" element={<Navigate to="/call/eua/integracao" replace />} />
          <Route path="call/campanha" element={<Navigate to="/call/eua/campanha" replace />} />
          <Route path="call/metricas" element={<Navigate to="/call/eua/metricas" replace />} />
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
      </ConfirmProvider>
    </BrowserRouter>
  )
}

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset, applyActionCode } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { Lock, Eye, EyeOff, CheckCircle2, XCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react'
import ParticlesBackground from '../components/ParticlesBackground'
import ShootingStars from '../components/ShootingStars'
import sendlyLogo from '../assets/autsendlogo.png'
import { SUPPORT_WHATSAPP } from '../lib/constants'
import WhatsAppIcon from '../components/WhatsAppIcon'

/** Lê mode + oobCode da URL (o Firebase acrescenta esses params ao link do e-mail). */
function getParams() {
  const p = new URLSearchParams(window.location.search)
  return { mode: p.get('mode') || '', oobCode: p.get('oobCode') || '' }
}

/**
 * Página de ação de autenticação (redefinir senha, verificar e-mail, recuperar e-mail) — com a cara do Autsend.
 * Configure no Firebase Console → Authentication → Templates → "URL acionável" = https://autsend.com.br/auth/action
 */
export default function AuthAction() {
  const navigate = useNavigate()
  const { mode, oobCode } = getParams()
  const [fase, setFase] = useState('carregando') // carregando | senha | sucesso | erro
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [titulo, setTitulo] = useState('')

  useEffect(() => {
    document.title = 'Autsend · Sua conta'
    let vivo = true
    async function run() {
      if (!oobCode) { setFase('erro'); setErro('Link inválido ou incompleto.'); return }
      try {
        if (mode === 'resetPassword') {
          const em = await verifyPasswordResetCode(auth, oobCode)
          if (!vivo) return
          setEmail(em); setFase('senha')
        } else if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') {
          await applyActionCode(auth, oobCode)
          if (!vivo) return
          setTitulo('E-mail verificado!'); setFase('sucesso')
        } else if (mode === 'recoverEmail') {
          await applyActionCode(auth, oobCode)
          if (!vivo) return
          setTitulo('E-mail restaurado!'); setFase('sucesso')
        } else {
          setFase('erro'); setErro('Ação não reconhecida.')
        }
      } catch (e) {
        if (!vivo) return
        setFase('erro')
        setErro(mapErro(e))
      }
    }
    run()
    return () => { vivo = false }
  }, [mode, oobCode])

  const salvarSenha = async (e) => {
    e.preventDefault()
    setErro('')
    if (senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres.'); return }
    if (senha !== senha2) { setErro('As senhas não conferem.'); return }
    setSalvando(true)
    try {
      await confirmPasswordReset(auth, oobCode, senha)
      setTitulo('Senha redefinida!'); setFase('sucesso')
    } catch (e2) {
      setErro(mapErro(e2))
    } finally { setSalvando(false) }
  }

  return (
    <ParticlesBackground className="bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
      <div aria-hidden className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.16) 1px, transparent 1.6px)', backgroundSize: '22px 22px' }} />
        <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-primary-400/25 blur-3xl animate-float" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-violet-400/20 blur-3xl animate-float-slow" />
      </div>
      <ShootingStars />

      <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5a] hover:scale-110 active:scale-95 transition-all bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte" aria-label="Falar com suporte no WhatsApp">
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>

      <div className="w-full max-w-[440px] relative z-10 px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 bg-white/30 backdrop-blur-xl border border-white/40 shadow-[0_25px_50px_-12px_rgba(74,70,222,0.18),0_0_0_1px_rgba(255,255,255,0.3)_inset]"
        >
          <div className="absolute -inset-px rounded-2xl sm:rounded-3xl bg-gradient-to-br from-primary-400/20 via-transparent to-violet-400/15 -z-10 blur-sm" />

          <div className="flex flex-col items-center gap-1.5 mb-5 sm:mb-6">
            <img src={sendlyLogo} alt="Autsend" className="h-12 sm:h-14 w-auto drop-shadow-sm" />
          </div>

          {/* ── Carregando ── */}
          {fase === 'carregando' && (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
              <p className="mt-4 text-sm text-stone-500">Validando seu link…</p>
            </div>
          )}

          {/* ── Redefinir senha ── */}
          {fase === 'senha' && (
            <>
              <div className="text-center mb-5">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-100 text-primary-600 mb-3"><ShieldCheck className="w-6 h-6" /></span>
                <h1 className="text-lg font-bold text-stone-800">Criar nova senha</h1>
                <p className="text-sm text-stone-500 mt-1">Para a conta <b className="text-stone-700">{email}</b></p>
              </div>
              <form onSubmit={salvarSenha} className="space-y-4">
                {erro && <div className="p-3.5 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm font-medium">{erro}</div>}
                <div>
                  <label className="block text-xs font-semibold text-stone-600 uppercase tracking-wider mb-2">Nova senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                    <input type={showPass ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" required minLength={6}
                      className="w-full pl-11 pr-11 py-3 rounded-xl border border-surface-200 bg-surface-50/50 text-sm" />
                    <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-surface-100" aria-label={showPass ? 'Ocultar' : 'Mostrar'}>
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 uppercase tracking-wider mb-2">Confirmar senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                    <input type={showPass ? 'text' : 'password'} value={senha2} onChange={(e) => setSenha2(e.target.value)} placeholder="••••••••" required minLength={6}
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-surface-200 bg-surface-50/50 text-sm" />
                  </div>
                </div>
                <motion.button type="submit" disabled={salvando} whileTap={{ scale: salvando ? 1 : 0.99 }} className="btn-primary w-full py-3 min-h-[48px] text-sm rounded-xl">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {salvando ? 'Salvando…' : 'Redefinir senha'}
                </motion.button>
              </form>
            </>
          )}

          {/* ── Sucesso ── */}
          {fase === 'sucesso' && (
            <div className="text-center py-4">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-4"><CheckCircle2 className="w-9 h-9" /></motion.span>
              <h1 className="text-xl font-bold text-stone-800">{titulo}</h1>
              <p className="text-sm text-stone-500 mt-2">Tudo certo com a sua conta. Você já pode entrar.</p>
              <button onClick={() => navigate('/login')} className="btn-primary w-full py-3 min-h-[48px] text-sm rounded-xl mt-6">
                Ir para o login <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Erro ── */}
          {fase === 'erro' && (
            <div className="text-center py-4">
              <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-500 mb-4"><XCircle className="w-9 h-9" /></span>
              <h1 className="text-xl font-bold text-stone-800">Ops!</h1>
              <p className="text-sm text-stone-500 mt-2">{erro}</p>
              <button onClick={() => navigate('/login')} className="btn-primary w-full py-3 min-h-[48px] text-sm rounded-xl mt-6">
                Voltar ao login <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>

        <p className="text-center text-[11px] text-stone-400 mt-4">Autsend · sua conta em segurança 🔒</p>
      </div>
    </ParticlesBackground>
  )
}

function mapErro(e) {
  const c = e?.code || ''
  if (c === 'auth/expired-action-code') return 'Este link expirou. Solicite um novo pela tela de login.'
  if (c === 'auth/invalid-action-code') return 'Este link é inválido ou já foi usado. Solicite um novo.'
  if (c === 'auth/weak-password') return 'Senha muito fraca (mínimo 6 caracteres).'
  if (c === 'auth/user-disabled') return 'Esta conta está desativada.'
  if (c === 'auth/user-not-found') return 'Conta não encontrada.'
  return e?.message || 'Não foi possível concluir. Tente novamente.'
}

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react'
import WhatsAppIcon from '../components/WhatsAppIcon'
import ParticlesBackground from '../components/ParticlesBackground'
import ShootingStars from '../components/ShootingStars'
import sendlyLogo from '../assets/autsendlogo.png'
import { SUPPORT_WHATSAPP } from '../lib/constants'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const navigate = useNavigate()

  const handleRecuperar = async () => {
    const em = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Digite seu e-mail no campo acima para recuperar a senha.')
      return
    }
    setRecuperando(true)
    setError('')
    try {
      await sendPasswordResetEmail(auth, em)
      toast.success(`Enviamos um link de recuperação para ${em}. Confira a caixa de entrada (e o spam).`)
    } catch (err) {
      setError(err.code === 'auth/user-not-found' ? 'Não encontramos uma conta com esse e-mail.' : (err.message || 'Erro ao enviar a recuperação.'))
    } finally {
      setRecuperando(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      navigate('/integracoes')
    } catch (err) {
      setError(
        err.code === 'auth/email-already-in-use'
          ? 'Este e-mail já está em uso.'
          : err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
          ? 'E-mail ou senha incorretos.'
          : err.message || 'Ocorreu um erro. Tente novamente.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <ParticlesBackground className="bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
      {/* Fundo decorativo (só no login): pontilhado + orbs de luz — atrás de tudo */}
      <div aria-hidden className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.16) 1px, transparent 1.6px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-primary-400/25 blur-3xl animate-float" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-violet-400/20 blur-3xl animate-float-slow" />
        <div className="absolute bottom-4 left-1/3 w-72 h-72 rounded-full bg-sky-300/20 blur-3xl animate-float" />
      </div>
      {/* world.svg como decoração de fundo à direita (desktop): altura TOTAL, sangrando pra fora da borda */}
      <div aria-hidden className="hidden lg:block absolute inset-x-0 bottom-0 h-[55%] z-[1] pointer-events-none overflow-hidden">
        <img
          src={`${import.meta.env.BASE_URL}world.svg`}
          alt=""
          className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-[65%] w-[100%] max-w-none opacity-80 select-none"
        />
      </div>

      {/* world.svg no mobile: no rodapé, sangrando pra baixo (só o topo do globo aparece) */}
      <div aria-hidden className="lg:hidden absolute inset-x-0 bottom-0 h-[40%] z-[1] pointer-events-none overflow-hidden">
        <img
          src={`${import.meta.env.BASE_URL}world.svg`}
          alt=""
          className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-[42%] w-[156%] max-w-none opacity-80 select-none"
        />
      </div>
      {/* Estrelas cadentes cruzando a tela (atrás do card) */}
      <ShootingStars />

      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5a] hover:scale-110 active:scale-95 transition-all duration-200 touch-manipulation bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte"
        aria-label="Falar com suporte no WhatsApp"
      >
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>
      <div className="w-full max-w-[440px] relative z-10 px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 bg-white/30 backdrop-blur-xl border border-white/40 shadow-[0_25px_50px_-12px_rgba(74,70,222,0.18),0_0_0_1px_rgba(255,255,255,0.3)_inset]"
        >
          <div className="absolute -inset-px rounded-2xl sm:rounded-3xl bg-gradient-to-br from-primary-400/20 via-transparent to-violet-400/15 -z-10 blur-sm" />
          <div className="flex flex-col justify-center items-center gap-1.5 mb-4 sm:mb-6">
            <motion.img
              src={sendlyLogo}
              alt="Autsend"
              className="h-12 sm:h-16 w-auto drop-shadow-sm"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
            />
            {isSignUp && <p className="text-[11px] text-primary-600/90 uppercase tracking-[0.2em] font-bold">Criar conta</p>}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {error && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm font-medium">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-stone-600 uppercase tracking-wider mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-surface-200 bg-surface-50/50 text-sm transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 uppercase tracking-wider mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full pl-11 pr-11 py-3 rounded-xl border border-surface-200 bg-surface-50/50 text-sm transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-surface-100 transition-colors touch-manipulation"
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.01 }}
              whileTap={{ scale: loading ? 1 : 0.99 }}
              className="btn-primary w-full py-3 min-h-[48px] text-sm touch-manipulation rounded-xl"
            >
              {loading ? 'Aguarde...' : isSignUp ? 'Criar conta' : 'Entrar'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </motion.button>
          </form>

          <div className="mt-5 sm:mt-6 pt-5 sm:pt-6 border-t border-surface-200/80">
            {isSignUp ? (
              <p className="text-center text-sm text-stone-500">
                Já tem conta?{' '}
                <button
                  type="button"
                  onClick={() => { setIsSignUp(false); setError('') }}
                  className="text-primary-600 font-semibold hover:text-primary-700 transition-colors"
                >
                  Entrar
                </button>
              </p>
            ) : (
              <div className="flex items-center justify-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleRecuperar}
                  disabled={recuperando}
                  className="text-primary-600 font-semibold hover:text-primary-700 transition-colors disabled:opacity-60"
                >
                  {recuperando ? 'Enviando…' : 'Rec. Senha'}
                </button>
                <span className="text-surface-300">|</span>
                <button
                  type="button"
                  onClick={() => { setIsSignUp(true); setError('') }}
                  className="text-primary-600 font-semibold hover:text-primary-700 transition-colors"
                >
                  Cadastro
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ParticlesBackground>
  )
}

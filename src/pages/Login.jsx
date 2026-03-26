import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react'
import logo from '../assets/logo.png'
import WhatsAppIcon from '../components/WhatsAppIcon'
import ParticlesBackground from '../components/ParticlesBackground'
import { SUPPORT_WHATSAPP } from '../lib/constants'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

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
    <ParticlesBackground className="flex px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35">
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
      <div className="w-full max-w-[440px]">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 bg-white/90 backdrop-blur-xl border border-white/80 shadow-[0_25px_50px_-12px_rgba(74,70,222,0.2),0_0_0_1px_rgba(255,255,255,0.9)_inset]"
        >
          <div className="absolute -inset-px rounded-2xl sm:rounded-3xl bg-gradient-to-br from-primary-400/20 via-transparent to-violet-400/15 -z-10 blur-sm" />
          <div className="flex justify-center mb-6 sm:mb-8">
            <motion.img
              src={logo}
              alt="CODE NXT"
              className=" max-w-28 w-auto drop-shadow-sm"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
            />
          </div>
          <p className="text-[11px] sm:text-xs text-primary-600/90 text-center mb-6 sm:mb-8 uppercase tracking-[0.2em] font-bold">
            {isSignUp ? 'Criar conta' : 'CODENXT MARKETING'}
          </p>

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
            <p className="text-center text-sm text-stone-500">
              {isSignUp ? 'Já tem conta?' : 'Não tem conta?'}{' '}
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError('') }}
                className="text-primary-600 font-semibold hover:text-primary-700 transition-colors"
              >
                {isSignUp ? 'Entrar' : 'Criar conta'}
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    </ParticlesBackground>
  )
}

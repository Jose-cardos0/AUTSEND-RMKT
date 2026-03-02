import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { Mail, Lock, MessageCircle } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg border border-surface-200 p-8">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-primary-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-center text-gray-800 mb-1">
            Remarketing
          </h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            {isSignUp ? 'Crie sua conta' : 'Entre na sua conta'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 transition"
            >
              {loading ? 'Aguarde...' : isSignUp ? 'Criar conta' : 'Entrar'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            {isSignUp ? 'Já tem conta?' : 'Não tem conta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError('')
              }}
              className="text-primary-600 font-medium hover:underline"
            >
              {isSignUp ? 'Entrar' : 'Criar conta'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

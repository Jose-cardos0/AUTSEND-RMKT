import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import { getPerfilStats, criarCheckoutCreditoSMS, PACOTES_CREDITO } from '../lib/perfil'
import { User, Mail, MessageSquare, Zap, Loader2, Sparkles, Check } from 'lucide-react'

const PLANO_LABEL = { free: 'Free', inicial: 'Inicial', padrao: 'Padrão', pro: 'Pro' }

/** Barra de uso (azulzinha) com rótulo X / Y. */
function BarraUso({ icon: Icon, titulo, usados, limite, cor = 'primary' }) {
  const pct = limite > 0 ? Math.min(100, Math.round((usados / limite) * 100)) : 0
  const cores = {
    primary: 'bg-primary-500',
    violet: 'bg-violet-500',
  }
  return (
    <div className="p-4 rounded-xl border border-surface-200 bg-surface-50/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          <Icon className="w-4 h-4 text-primary-600" /> {titulo}
        </span>
        <span className="text-sm font-semibold text-stone-800 tabular-nums">
          {usados.toLocaleString('pt-BR')} <span className="text-stone-400 font-normal">/ {limite.toLocaleString('pt-BR')}</span>
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-surface-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cores[cor]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Perfil() {
  const [user] = useAuthState(auth)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comprando, setComprando] = useState(null) // key do pacote em compra

  const carregar = async () => {
    try {
      const s = await getPerfilStats()
      setStats(s)
    } catch (_) {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user?.uid) return
    carregar()
  }, [user?.uid])

  // Volta do checkout de recarga (?recarga=ok|cancelado)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const r = params.get('recarga')
    if (!r) return
    if (r === 'ok') {
      toast.success('Recarga confirmada! Seus créditos são adicionados em instantes.')
      setTimeout(carregar, 2500)
    } else if (r === 'cancelado') {
      toast('Recarga cancelada.', { icon: '↩️' })
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const comprar = async (key) => {
    setComprando(key)
    try {
      const r = await criarCheckoutCreditoSMS(key)
      if (r?.url) window.location.href = r.url
      else toast.error('Não consegui abrir o checkout. Tente de novo.')
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a recarga.')
    } finally {
      setComprando(null)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const nome = stats?.nome || ''
  const email = stats?.email || user?.email || ''
  const inicial = (nome || email || '?').trim().charAt(0).toUpperCase()
  const planoLabel = PLANO_LABEL[stats?.plano] || 'Free'
  const smsLimiteEfetivo = (stats?.smsLimite || 0) + (stats?.smsCreditos || 0)

  return (
    <PageShell badge="Conta · Perfil">
      <div className="space-y-3">
        {/* Cabeçalho do usuário */}
        <Panel title="Meu perfil" icon={User}>
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-violet-500 text-white text-2xl font-bold shrink-0 shadow-md">
              {inicial}
            </span>
            <div className="min-w-0">
              {nome && <p className="text-lg font-bold text-stone-800 truncate">{nome}</p>}
              <p className="text-sm text-stone-500 flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 shrink-0" /> {email}</p>
              <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 border border-primary-200">
                <Sparkles className="w-3 h-3" /> Plano {planoLabel}
              </span>
            </div>
          </div>
        </Panel>

        {/* Uso do mês */}
        <Panel title="Uso deste mês" icon={Zap}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BarraUso icon={Mail} titulo="E-mails" usados={stats?.emailsUsados || 0} limite={stats?.emailsLimite || 0} cor="primary" />
            <BarraUso icon={MessageSquare} titulo="SMS" usados={stats?.smsUsados || 0} limite={smsLimiteEfetivo} cor="violet" />
          </div>
          <p className="text-xs text-stone-400 mt-2">
            SMS: {stats?.smsLimite || 0} do plano{stats?.smsCreditos > 0 ? ` + ${stats.smsCreditos.toLocaleString('pt-BR')} de crédito` : ''}. Os limites do plano renovam todo mês; os créditos não expiram.
          </p>
        </Panel>

        {/* Recarga de SMS */}
        <Panel title="Recarregar créditos de SMS" icon={MessageSquare} description="Créditos extras de SMS (EUA) que somam ao seu limite mensal e não expiram.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO.map((p) => (
              <div
                key={p.key}
                className={`relative flex flex-col p-5 rounded-2xl border-2 transition ${
                  p.destaque ? 'border-primary-400 bg-primary-50/40' : 'border-surface-200 bg-surface-50/60'
                }`}
              >
                {p.destaque && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary-600 text-white shadow-sm whitespace-nowrap">
                    MAIS POPULAR
                  </span>
                )}
                <div className="text-center">
                  <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</p>
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">SMS</p>
                  <p className="text-lg font-bold text-primary-600 mt-2">{p.valor}</p>
                </div>
                <button
                  onClick={() => comprar(p.key)}
                  disabled={!!comprando}
                  className="btn-primary w-full mt-4 min-h-[42px] disabled:opacity-60"
                >
                  {comprando === p.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {comprando === p.key ? 'Abrindo…' : 'Comprar'}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </PageShell>
  )
}

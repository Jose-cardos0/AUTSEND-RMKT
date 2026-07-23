import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { listarNumerosVozCall } from '../../lib/smsNumeros'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Bandeira from '../../components/Bandeira'
import { Phone, Check, Loader2, ChevronDown, ShoppingCart } from 'lucide-react'

function formatarNumero(n) {
  const d = String(n || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return n
}

/** Seção recolhível — mesmo padrão do "Meus números" do SMS (ícone faded no canto direito). */
function Secao({ title, icon: Icon, open, onToggle, children, bgIcon: BgIcon }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden relative">
      {BgIcon && <BgIcon className="pointer-events-none absolute right-0 top-0 -mr-6 -mt-8 w-36 h-36 text-primary-500 opacity-[0.06] z-0" />}
      <div className="relative z-10 flex items-center gap-2 px-4 sm:px-5 py-3.5">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
            {Icon && <Icon className="w-5 h-5 text-primary-600 shrink-0" />}
            <span className="truncate">{title}</span>
          </span>
        </button>
        <button type="button" onClick={onToggle} className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors" aria-label={open ? 'Recolher' : 'Expandir'}>
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && <div className="relative z-10 px-4 sm:px-5 pb-4 pt-1">{children}</div>}
    </div>
  )
}

export default function CallIntegracao() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const [loading, setLoading] = useState(true)
  const [numeros, setNumeros] = useState([])
  const [aberto, setAberto] = useState(false)
  const [ativandoId, setAtivandoId] = useState(null)

  const carregar = async () => {
    if (!user?.uid) return
    try { const r = await listarNumerosVozCall(); setNumeros(r?.numeros || []) }
    catch { setNumeros([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [user?.uid])

  const ativarVoz = async (n) => {
    setAtivandoId(n.id)
    try {
      const fn = httpsCallable(functions, 'callAtivarVozNoChip')
      await fn({ numeroId: n.id })
      setNumeros((prev) => prev.map((x) => x.id === n.id ? { ...x, vozAtiva: true } : x))
      toast.success('Ligação IA ativada neste chip!')
    } catch (err) {
      toast.error(err.message || 'Não consegui ativar a voz.')
    } finally { setAtivandoId(null) }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell badge={`Call · Integração · ${canal === 'api' ? "API's" : 'EUA'}`}>
      <Secao title="Ativar voz no meu chip (EUA)" icon={Phone} bgIcon={Phone} open={aberto} onToggle={() => setAberto((v) => !v)}>
        {numeros.length === 0 ? (
          <div className="py-8 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100 text-stone-400 mb-3"><Phone className="w-6 h-6" /></span>
            <p className="text-sm text-stone-600 font-medium">Você ainda não tem um número (EUA).</p>
            <Link to="/sms/integracao" className="btn-primary mt-4 min-h-[42px] px-5 inline-flex"><ShoppingCart className="w-4 h-4" /> Comprar um chip EUA</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-700">Selecione o chip que a <strong>Ligação IA</strong> vai usar.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {numeros.map((n) => (
                <div key={n.id} className={`relative p-4 sm:p-5 rounded-xl border-2 transition ${n.vozAtiva ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-800 break-all tabular-nums flex items-center gap-1.5">
                        <Bandeira code={n.pais} numero={n.numero} className="w-4 h-auto rounded-sm shrink-0" />
                        {formatarNumero(n.numero)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {n.vozAtiva ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium"><Check className="w-3 h-3" /> Ativo · Ligação EUA</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Ativo</span>
                        )}
                        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${n.fonte === 'byo' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-surface-100 text-stone-500 border-surface-200'}`}>
                          {n.fonte === 'byo' ? 'Sua Telnyx' : 'Autsend'}
                        </span>
                      </div>
                    </div>
                    {!n.vozAtiva && (
                      <button type="button" onClick={() => ativarVoz(n)} disabled={ativandoId === n.id} className="btn-primary shrink-0 min-h-[38px] text-sm px-3 disabled:opacity-60">
                        {ativandoId === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />} Ativar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Secao>
    </PageShell>
  )
}

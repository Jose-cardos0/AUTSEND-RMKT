import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import MessageEditor from '../../components/MessageEditor'
import MelhorarPlano from '../../components/MelhorarPlano'
import { getSmsAutomations, saveSmsAutomationGrupo, getProductGroups } from '../../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../../lib/constants'
import { usePlano } from '../../lib/PlanoContext'
import { Loader2, Zap, Package, Check, ChevronDown, ChevronUp, Send, MessageSquare, Globe, AlertCircle } from 'lucide-react'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'

function EventCard({ event, auto, onSave, productName }) {
  const [expanded, setExpanded] = useState(false)
  const [mensagem, setMensagem] = useState(auto?.mensagem || '')
  const [ativo, setAtivo] = useState(auto?.ativo ?? false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    setMensagem(auto?.mensagem || '')
    setAtivo(auto?.ativo ?? false)
  }, [auto?.mensagem, auto?.ativo])

  const segmentos = Math.max(1, Math.ceil((mensagem.length || 1) / 160))

  const handleSave = async () => {
    setSalvando(true)
    try {
      await onSave(event.id, { mensagem, ativo })
      toast.success(`Automação de SMS "${event.label}" salva.`)
    } catch {
      toast.error('Erro ao salvar automação.')
    } finally {
      setSalvando(false)
    }
  }

  const handleToggleAtivo = async () => {
    const novo = !ativo
    setAtivo(novo)
    try { await onSave(event.id, { mensagem, ativo: novo }) }
    catch { setAtivo(!novo); toast.error('Erro ao salvar.') }
  }

  return (
    <div className="app-panel border border-surface-200/90 rounded-2xl overflow-hidden bg-white/90">
      <div className="w-full flex items-center justify-between p-3 sm:p-4 min-h-[52px] gap-3">
        <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <MessageSquare className={`w-4 h-4 shrink-0 ${ativo ? 'text-sky-500' : 'text-stone-400'}`} />
          <span className="font-medium text-stone-800">{event.label}</span>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={handleToggleAtivo} className={`relative w-11 h-6 rounded-full transition-colors ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`} title={ativo ? 'Desativar' : 'Ativar'}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-stone-400 p-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 pt-0 space-y-2 border-t border-surface-100">
          <label className="block text-sm font-medium text-stone-700 mb-1.5 mt-3">Texto do SMS automático</label>
          <MessageEditor
            value={mensagem}
            onChange={setMensagem}
            placeholder={'Autsend: hey {nome_cliente}, thanks for your interest in {nome_produto}! Reply STOP to opt out.'}
            variables={TEMPLATE_VARIABLES}
            rows={4}
          />
          <p className="text-[11px] text-stone-400">
            {mensagem.length} caractere(s) · <span className={segmentos > 1 ? 'text-amber-600 font-medium' : ''}>{segmentos} segmento(s)</span>. Acentos removidos automaticamente. Só dispara pra leads internacionais (ignora +55).
          </p>
          <button onClick={handleSave} disabled={salvando} className="btn-primary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {salvando ? 'Salvando...' : 'Salvar automação'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function SmsAutomacoes() {
  const [user] = useAuthState(auth)
  const { temFeature, limiteDe } = usePlano()
  const podeSms = temFeature('smsDisparos') && limiteDe('smsMes') > 0

  const [loading, setLoading] = useState(true)
  const [autos, setAutos] = useState([])
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getSmsAutomations(user.uid), getProductGroups(user.uid)])
      .then(([a, gs]) => { setAutos(a); setGrupos(gs) })
      .finally(() => setLoading(false))
  }, [user?.uid])

  useEffect(() => {
    if (grupos.length > 0 && !grupos.some((g) => g.id === grupoId)) setGrupoId(grupos[0].id)
  }, [grupos])

  const autoMap = useMemo(() => {
    const m = {}
    KIWIFY_EVENTS.forEach((e) => { m[e.id] = autos.find((a) => a.grupoId === grupoId && a.evento === e.id) || null })
    return m
  }, [autos, grupoId])

  const grupoNome = useMemo(() => grupos.find((g) => g.id === grupoId)?.nome || '', [grupos, grupoId])

  const handleSave = async (evento, data) => {
    if (!grupoId) { toast.error('Selecione um grupo de produto.'); return }
    await saveSmsAutomationGrupo(user.uid, grupoId, evento, data)
    setAutos((prev) => {
      const idx = prev.findIndex((a) => a.grupoId === grupoId && a.evento === evento)
      const updated = { grupoId, evento, ...data, id: `${grupoId}__${evento}` }
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...updated }; return copy }
      return [...prev, updated]
    })
  }

  if (loading) return <PageLoader />

  return (
    <PageShell badge="SMS · Automações (EUA)" title="Automações de SMS">
      <div className="space-y-4 sm:space-y-5">
        {!podeSms && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="flex-1">Seu plano não inclui SMS. Faça upgrade para disparar SMS automático.</span>
            <MelhorarPlano label="Ver planos" className="shrink-0" />
          </div>
        )}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-sm">
          <Globe className="w-5 h-5 shrink-0 mt-0.5" />
          <span>O SMS automático dispara <strong>só pra leads internacionais</strong>. Leads do Brasil (+55) são ignorados — no BR use as Automações de WhatsApp. Configure por <strong>grupo de produto</strong> e evento.</span>
        </div>

        {grupos.length === 0 ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            As automações são <strong>por grupo de produto</strong>. Crie um{' '}
            <Link to="/produtos" className="font-semibold underline">grupo</Link> primeiro.
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Grupos */}
            <aside className="lg:w-56 xl:w-60 shrink-0">
              <div className="lg:sticky lg:top-24 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-widest">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Package className="w-4 h-4 shrink-0" /></span>
                    Produtos <span className="text-[10px] font-normal text-stone-400 normal-case tracking-normal">({grupos.length})</span>
                  </span>
                  <Link to="/produtos" className="text-[11px] text-primary-600 hover:underline">Gerenciar</Link>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                  {grupos.map((g) => {
                    const sel = grupoId === g.id
                    return (
                      <button key={g.id} type="button" onClick={() => setGrupoId(g.id)}
                        className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition touch-manipulation ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}>
                        {g.imagem ? (
                          <img src={g.imagem} alt="" className="h-7 w-7 rounded-lg object-contain shrink-0" />
                        ) : (
                          <span className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${sel ? 'bg-primary-500 text-white' : 'bg-surface-100 text-stone-400'}`}><Package className="w-3.5 h-3.5" /></span>
                        )}
                        <span className="text-sm font-medium text-stone-800 truncate">{g.nome}</span>
                        {sel && <Check className="w-4 h-4 text-primary-600 shrink-0 ml-auto" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </aside>

            {/* Eventos */}
            <div className="flex-1 min-w-0">
              {grupoId && (
                <div className="app-panel rounded-2xl overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-surface-100">
                    <Zap className="w-5 h-5 text-primary-600 shrink-0" />
                    <span className="text-sm sm:text-base font-semibold text-stone-800">Automações de SMS — {grupoNome}</span>
                  </div>
                  <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                    {KIWIFY_EVENTS.map((event) => (
                      <EventCard key={event.id} event={event} auto={autoMap[event.id]} onSave={handleSave} productName={grupoNome} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}

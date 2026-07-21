import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import { getAtendentes, criarAtendente, saveAtendente, deleteAtendente, getProductGroups, getInstances } from '../lib/firestore'
import { usePlano } from '../lib/PlanoContext'
import { personaLabel } from '../lib/atendentePersonas'
import { KIWIFY_EVENTS } from '../lib/constants'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import WhatsAppIcon from '../components/WhatsAppIcon'
import MelhorarPlano from '../components/MelhorarPlano'
import Select from '../components/Select'
import AtendenteSimulador from '../components/AtendenteSimulador'
import { useConfirm } from '../components/ConfirmDialog'
import { Rocket, Plus, Trash2, Loader2, X, Package, Smartphone, Check, AlertCircle, Pencil, ChevronDown, FlaskConical, Search } from 'lucide-react'

export default function Atendentes() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const { limiteDe, isAdmin } = usePlano()
  const [loading, setLoading] = useState(true)
  const [atendentes, setAtendentes] = useState([])
  const [grupos, setGrupos] = useState([])
  const [instancias, setInstancias] = useState([])
  const [showCriar, setShowCriar] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoGrupo, setNovoGrupo] = useState('')
  const [novaInst, setNovaInst] = useState('')
  const [instPickerOpen, setInstPickerOpen] = useState(false)
  const [criando, setCriando] = useState(false)
  const [testando, setTestando] = useState(null) // { grupoId, nome }
  const [eventosPopup, setEventosPopup] = useState(null) // id do atendente

  const load = async () => {
    if (!user?.uid) return
    const [a, g, i] = await Promise.all([getAtendentes(user.uid), getProductGroups(user.uid), getInstances(user.uid)])
    setAtendentes(a); setGrupos(g); setInstancias(i)
  }
  useEffect(() => { if (!user?.uid) return; setLoading(true); load().finally(() => setLoading(false)) }, [user?.uid])

  const limite = isAdmin ? Infinity : (limiteDe('atendentes') || 0)
  const podeCriar = isAdmin || atendentes.length < limite

  const grupoById = useMemo(() => Object.fromEntries(grupos.map((g) => [g.id, g])), [grupos])
  const instById = useMemo(() => Object.fromEntries(instancias.map((i) => [i.id, i])), [instancias])

  // Produtos/instâncias ainda livres (1 atendente por produto e por instância).
  const gruposLivres = useMemo(() => grupos.filter((g) => !atendentes.some((a) => a.grupoId === g.id)), [grupos, atendentes])
  const instLivres = useMemo(() => instancias.filter((i) => !atendentes.some((a) => a.instanceId === i.id)), [instancias, atendentes])
  const novaInstObj = useMemo(() => instLivres.find((i) => i.id === novaInst) || null, [instLivres, novaInst])

  const abrirCriar = () => {
    if (!podeCriar) { toast.error(`Seu plano permite ${limite} vendedor(es). Compre uma instância ou faça upgrade pra liberar mais.`); return }
    setNovoNome(''); setNovoGrupo(gruposLivres[0]?.id || ''); setNovaInst(instLivres[0]?.id || ''); setShowCriar(true)
  }

  const handleCriar = async () => {
    if (!novoGrupo) { toast.error('Escolha o produto.'); return }
    if (!novaInst) { toast.error('Escolha a instância de WhatsApp.'); return }
    setCriando(true)
    try {
      const g = grupoById[novoGrupo]
      await criarAtendente({ nome: novoNome.trim() || (g?.nome || 'Atendente'), grupoId: novoGrupo, instanceId: novaInst })
      await load()
      setShowCriar(false)
      toast.success('Vendedor criado! Configure o contexto do produto e ative.')
    } catch (err) { toast.error(err.message || 'Erro ao criar vendedor') }
    finally { setCriando(false) }
  }

  const toggleAtivo = async (a) => {
    const g = grupoById[a.grupoId]
    if (!a.ativo && !(g?.iaContexto || '').trim()) { toast.error('Configure o contexto do produto antes de ativar.'); return }
    const novo = !a.ativo
    setAtendentes((prev) => prev.map((x) => (x.id === a.id ? { ...x, ativo: novo } : x)))
    try { await saveAtendente(user.uid, a.id, { ativo: novo }) } catch (err) { setAtendentes((prev) => prev.map((x) => (x.id === a.id ? { ...x, ativo: !novo } : x))); toast.error('Erro ao salvar.') }
  }

  // Eventos em que o vendedor puxa conversa (Fase 3 proativo). Se tiver automação pro evento, ela abre; senão o vendedor abre.
  const toggleEvento = async (a, ev) => {
    const atuais = Array.isArray(a.eventos) ? a.eventos : []
    const novos = atuais.includes(ev) ? atuais.filter((e) => e !== ev) : [...atuais, ev]
    setAtendentes((prev) => prev.map((x) => (x.id === a.id ? { ...x, eventos: novos } : x)))
    try { await saveAtendente(user.uid, a.id, { eventos: novos }) } catch (err) { setAtendentes((prev) => prev.map((x) => (x.id === a.id ? { ...x, eventos: atuais } : x))); toast.error('Erro ao salvar.') }
  }

  const excluir = async (a) => {
    const g = grupoById[a.grupoId]
    if (!(await confirm({ title: `Excluir vendedor "${g?.nome || a.nome}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))) return
    try { await deleteAtendente(user.uid, a.id); setAtendentes((prev) => prev.filter((x) => x.id !== a.id)); toast.success('Vendedor excluído.') }
    catch (err) { toast.error(err.message || 'Erro ao excluir') }
  }

  if (loading) return <PageLoader />

  return (
    <PageShell
      badge="Comercial · Vendedores"
      title="Vendedores"
      right={
        <button onClick={abrirCriar} className="btn-primary text-sm min-h-[44px]"><Plus className="w-4 h-4" /> Novo vendedor</button>
      }
    >
      {/* Limite */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 bg-surface-100 rounded-full px-3 py-1.5">
          <Rocket className="w-3.5 h-3.5" /> {atendentes.length}{isAdmin ? '' : ` de ${limite}`} vendedor(es)
        </span>
        {!isAdmin && atendentes.length >= limite && (
          <span className="text-xs text-stone-500">Comprou uma instância? Ela libera +1 vendedor. <MelhorarPlano label="Ver planos" className="inline-flex" /></span>
        )}
      </div>

      {atendentes.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><Rocket className="w-7 h-7" /></span>
            <h2 className="text-lg font-semibold text-stone-800">Nenhum vendedor ainda</h2>
            <p className="text-sm text-stone-500 max-w-md leading-relaxed">
              Crie um <strong>bot de IA no WhatsApp</strong> que conversa com seus leads, tira dúvidas do produto e envia o checkout na hora certa. Um vendedor por produto.
            </p>
            <button onClick={abrirCriar} className="btn-primary min-h-[44px]"><Plus className="w-4 h-4" /> Criar vendedor</button>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {atendentes.map((a) => {
            const g = grupoById[a.grupoId]
            const inst = instById[a.instanceId]
            const semContexto = !(g?.iaContexto || '').trim()
            const semCheckout = !(Array.isArray(g?.iaPlanos) && g.iaPlanos.length)
            return (
              <div key={a.id} className="app-panel rounded-2xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 overflow-hidden ${g?.imagem ? '' : 'bg-violet-100 text-violet-600'}`}>
                    {g?.imagem ? <img src={g.imagem} alt="" className="h-full w-full object-contain" /> : <Rocket className="w-5 h-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-stone-800 truncate">{g?.nome || a.nome}</h3>
                    <p className="text-[11px] text-stone-400">Perfil: {personaLabel(g?.iaPersona)}</p>
                  </div>
                  {/* Toggle ativo */}
                  <button type="button" onClick={() => toggleAtivo(a)} className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${a.ativo ? 'bg-emerald-500' : 'bg-stone-300'}`} title={a.ativo ? 'Desativar' : 'Ativar'}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${a.ativo ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-stone-600">
                  <WhatsAppIcon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{inst?.nomeInstancia || '—'}</span>
                  {inst?.numeroWhatsapp && <span className="text-stone-400">· {inst.numeroWhatsapp}</span>}
                  {inst && (inst.conectado
                    ? <span className="text-emerald-600 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> Conectada</span>
                    : <span className="text-amber-600">desconectada</span>)}
                </div>

                {/* Avisos de config */}
                {(semContexto || semCheckout) && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {semContexto ? 'Falta o contexto do produto. ' : ''}{semCheckout ? 'Sem checkout pra vender. ' : ''}
                      <Link to="/produtos" className="font-semibold underline">Configurar em Produtos</Link>
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1 pt-2 border-t border-surface-100">
                  <button onClick={() => setTestando({ grupoId: a.grupoId, nome: g?.nome || a.nome })} disabled={semContexto} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg py-2 transition-colors disabled:opacity-40 disabled:pointer-events-none" title={semContexto ? 'Configure o contexto primeiro' : 'Testar a IA'}><FlaskConical className="w-3.5 h-3.5" /> Testar IA</button>
                  <button onClick={() => setEventosPopup(a.id)} className="relative inline-flex items-center justify-center text-stone-600 hover:bg-surface-100 rounded-lg px-2.5 py-2 transition-colors" title="Eventos em que o vendedor puxa conversa">
                    <Search className="w-4 h-4" />
                    {Array.isArray(a.eventos) && a.eventos.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary-600 text-white text-[9px] font-bold flex items-center justify-center">{a.eventos.length}</span>}
                  </button>
                  <Link to="/produtos" className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-stone-600 hover:bg-surface-100 rounded-lg px-2.5 py-2 transition-colors" title="Contexto & checkouts"><Pencil className="w-3.5 h-3.5" /></Link>
                  <button onClick={() => excluir(a)} className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Popup: criar atendente */}
      {showCriar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCriar(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shrink-0"><Rocket className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">Novo vendedor</h3>
              <button onClick={() => setShowCriar(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {gruposLivres.length === 0 || instLivres.length === 0 ? (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {gruposLivres.length === 0 && <>Todos os produtos já têm vendedor. Crie um novo grupo em <Link to="/produtos" className="underline font-semibold">Produtos</Link>. </>}
                  {instLivres.length === 0 && <>Nenhuma instância livre. Cada vendedor usa uma instância — conecte outra em <Link to="/integracoes" className="underline font-semibold">WhatsApp → Integrações</Link>.</>}
                </span>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1.5"><Package className="w-3.5 h-3.5 inline mr-1" /> Produto</label>
                  <Select
                    value={novoGrupo}
                    onChange={setNovoGrupo}
                    withThumb
                    title="Selecionar produto"
                    placeholder="Escolher produto"
                    className="w-full"
                    options={gruposLivres.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1.5"><Smartphone className="w-3.5 h-3.5 inline mr-1" /> Instância de WhatsApp</label>
                  <button type="button" onClick={() => setInstPickerOpen(true)} className="w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[48px] rounded-xl border border-surface-200 bg-white text-left hover:border-primary-300 transition">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><WhatsAppIcon className="w-4 h-4" /></span>
                    {novaInstObj ? (
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-stone-800 truncate">{novaInstObj.nomeInstancia || 'Sem nome'}</span>
                        <span className="block text-[11px] text-stone-400">{novaInstObj.numeroWhatsapp || 'sem número'} · {novaInstObj.conectado ? 'conectada' : 'desconectada'}</span>
                      </span>
                    ) : <span className="flex-1 text-sm text-stone-400">Escolher instância</span>}
                    <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowCriar(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
                  <button onClick={handleCriar} disabled={criando} className="btn-primary min-h-[44px]">{criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Criar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Popup: escolher instância (cards) */}
      {instPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setInstPickerOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><WhatsAppIcon className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Escolher instância</h3>
              <button onClick={() => setInstPickerOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto">
              {instLivres.map((i) => {
                const sel = novaInst === i.id
                return (
                  <button key={i.id} type="button" onClick={() => { setNovaInst(i.id); setInstPickerOpen(false) }} className={`relative p-4 rounded-xl border-2 text-left transition ${sel ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50 hover:border-primary-200'}`}>
                    <p className="font-semibold text-stone-800 break-all">{i.nomeInstancia || 'Sem nome'}</p>
                    {i.numeroWhatsapp && <p className="text-sm text-stone-500 mt-0.5">{i.numeroWhatsapp}</p>}
                    <div className="mt-2">
                      {i.conectado
                        ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Conectado</span>
                        : <span className="text-xs text-stone-500">Não conectado</span>}
                    </div>
                    {sel && <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center shadow"><Check className="w-3 h-3" /></span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Popup: eventos em que o vendedor puxa conversa */}
      {eventosPopup && (() => {
        const a = atendentes.find((x) => x.id === eventosPopup)
        if (!a) return null
        const g = grupoById[a.grupoId]
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setEventosPopup(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Search className="w-4 h-4" /></span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-stone-800 truncate">Puxar conversa nos eventos</h3>
                  <p className="text-[11px] text-stone-400 truncate">{g?.nome || a.nome} · toque pra marcar</p>
                </div>
                <button onClick={() => setEventosPopup(null)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                {KIWIFY_EVENTS.map((ev) => {
                  const on = Array.isArray(a.eventos) && a.eventos.includes(ev.id)
                  return (
                    <button key={ev.id} type="button" onClick={() => toggleEvento(a, ev.id)} className={`text-xs px-3 py-1.5 rounded-full border transition ${on ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-stone-600 border-surface-200 hover:border-primary-300'}`}>
                      {ev.label}
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-end pt-1">
                <button onClick={() => setEventosPopup(null)} className="btn-primary min-h-[40px] text-sm"><Check className="w-4 h-4" /> Pronto</button>
              </div>
            </div>
          </div>
        )
      })()}

      {testando && (
        <AtendenteSimulador grupoId={testando.grupoId} nome={testando.nome} onClose={() => setTestando(null)} />
      )}
    </PageShell>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, getEmailAutomations, saveEmailAutomation, getLeads, getProductGroups, getEmailProviders } from '../../lib/firestore'
import RemetentePicker from '../../components/RemetentePicker'
import Select from '../../components/Select'
import { emailPreviewDoc } from '../../lib/emailPreview'
import CollapsibleSearch from '../../components/CollapsibleSearch'
import { KIWIFY_EVENTS, canonicalEvento } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Mail, Zap, LayoutTemplate, ArrowRight, AlertCircle, History, RefreshCw, CheckCircle2, XCircle, Clock, Send, Loader2, ChevronDown, ChevronLeft, ChevronRight, Package, Check } from 'lucide-react'

/** Seção recolhível (accordion). */
function Secao({ title, icon: Icon, open, onToggle, children, noPad }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3 hover:bg-surface-50 transition">
        <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
          {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
          <span className="truncate">{title}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className={noPad ? '' : 'px-4 sm:px-5 pb-4 pt-1 space-y-3'}>{children}</div>}
    </div>
  )
}

export default function EmailAutomacoes() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [autosAll, setAutosAll] = useState([])
  const [leads, setLeads] = useState([])
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [enviarModal, setEnviarModal] = useState(null)
  const [manualTemplateId, setManualTemplateId] = useState('')
  const [enviandoManual, setEnviandoManual] = useState(false)
  const [eventosAbertos, setEventosAbertos] = useState(false)
  const [pTimeline, setPTimeline] = useState(1)
  const [sortKey, setSortKey] = useState('quando')
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const [buscaTL, setBuscaTL] = useState('')
  const [providers, setProviders] = useState([])

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getEmailTemplates(user.uid), getEmailAutomations(user.uid), getLeads(user.uid), getProductGroups(user.uid), getEmailProviders(user.uid)])
      .then(([tpls, autos, lds, gs, provs]) => {
        setTemplates(tpls)
        setAutosAll(autos)
        setLeads(lds)
        setGrupos(gs)
        setProviders(provs)
        setGrupoId((cur) => cur || (gs[0]?.id || ''))
      })
      .finally(() => setLoading(false))
  }, [user?.uid])

  const automations = useMemo(() => {
    const m = {}
    autosAll.filter((a) => a.grupoId === grupoId).forEach((a) => { m[a.evento] = a })
    return m
  }, [autosAll, grupoId])

  const reload = async () => {
    if (!user?.uid) return
    setLeads(await getLeads(user.uid))
  }

  const openEnviar = (lead) => {
    setManualTemplateId(automations[lead.evento]?.templateId || '')
    setEnviarModal(lead)
  }

  const enviarManual = async () => {
    const lead = enviarModal
    if (!lead) return
    if (!lead.email) { toast.error('Esse lead não tem e-mail.'); return }
    if (!manualTemplateId) { toast.error('Escolha um template.'); return }
    setEnviandoManual(true)
    try {
      const fn = httpsCallable(functions, 'sendTemplateManual')
      await fn({ templateId: manualTemplateId, to: lead.email, nome: lead.nome, produto: lead.produto, leadId: lead.id })
      toast.success(`E-mail enviado para ${lead.email}.`)
      setEnviarModal(null)
      setManualTemplateId('')
      setLeads(await getLeads(user.uid))
    } catch (err) {
      toast.error(err.message || 'Falha ao enviar.')
    } finally {
      setEnviandoManual(false)
    }
  }

  const eventoLabel = (id) => KIWIFY_EVENTS.find((e) => e.id === canonicalEvento(id))?.label || id || 'Outro'
  const formatDate = (ts) => {
    if (!ts) return '-'
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  const setAuto = async (evento, patch) => {
    if (!grupoId) { toast.error('Selecione um grupo de produto.'); return }
    const atual = automations[evento] || { evento, grupoId, ativo: false, templateId: '', remetenteId: null }
    const novo = { ...atual, ...patch }
    setAutosAll((prev) => {
      const idx = prev.findIndex((a) => a.grupoId === grupoId && a.evento === evento)
      const updated = { grupoId, evento, ...novo }
      if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], ...updated }; return c }
      return [...prev, updated]
    })
    try {
      await saveEmailAutomation(user.uid, grupoId, evento, { templateId: novo.templateId || '', ativo: !!novo.ativo, remetenteId: novo.remetenteId ?? null })
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar automação')
    }
  }

  const templatesById = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t])), [templates])

  const produtosLista = useMemo(() => [...new Set(leads.map((l) => l.produto).filter(Boolean))].sort(), [leads])
  const leadsOrdenados = useMemo(() => {
    const val = (l) => {
      switch (sortKey) {
        case 'contato': return (l.nome || l.email || '').toLowerCase()
        case 'evento': return canonicalEvento(l.evento) || ''
        case 'produto': return (l.produto || '').toLowerCase()
        case 'status': return l.status || 'pendente'
        case 'quando': return l.createdAt?.toMillis?.() ?? l.createdAt ?? 0
        default: return 0
      }
    }
    let list = leads
    const q = buscaTL.trim().toLowerCase()
    if (q) list = list.filter((l) => (l.nome || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.produto || '').toLowerCase().includes(q))
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [leads, buscaTL, sortKey, sortDir])
  useEffect(() => { setPTimeline(1) }, [buscaTL, sortKey, sortDir])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const TL_POR_PAGINA = 5
  const tlTotalPaginas = Math.max(1, Math.ceil(leadsOrdenados.length / TL_POR_PAGINA))
  const tlPagina = Math.min(pTimeline, tlTotalPaginas)
  const leadsPagina = leadsOrdenados.slice((tlPagina - 1) * TL_POR_PAGINA, tlPagina * TL_POR_PAGINA)

  return (
    <PageShell
      badge="E-mail · Automações"
      title="Automações de E-mail"
      right={
        <button onClick={reload} className="btn-secondary text-sm min-h-[44px]"><RefreshCw className="w-4 h-4" /> Atualizar</button>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6">
      {/* Seletor de grupos — coluna lateral direita fixa (sticky), estilo do WhatsApp */}
      {grupos.length > 0 && (
        <aside className="lg:w-56 xl:w-60 shrink-0 order-1 lg:order-1">
          <div className="lg:sticky lg:top-24 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-widest">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Package className="w-4 h-4 shrink-0" /></span>
                Produtos
                <span className="text-[10px] font-normal text-stone-400 normal-case tracking-normal">({grupos.length})</span>
              </span>
              <Link to="/produtos" className="text-[11px] text-primary-600 hover:underline">Gerenciar</Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
              {grupos.map((g) => {
                const sel = grupoId === g.id
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGrupoId(g.id)}
                    className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition touch-manipulation ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                  >
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
      )}

      {/* Conteúdo principal (esquerda) */}
      <div className="flex-1 min-w-0 order-2 lg:order-2 space-y-4 sm:space-y-5">
      {templates.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>
            Você ainda não tem templates. Crie um no{' '}
            <Link to="/email/construtor" className="font-semibold underline">Construtor</Link> para poder escolher aqui.
          </span>
        </div>
      )}

      {grupos.length === 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          As automações de e-mail são <strong>por produto</strong>. Crie um{' '}
          <Link to="/produtos" className="font-semibold underline">grupo de produto</Link> primeiro (ex.: Gekko Pan, MemoMax).
        </div>
      )}

      {grupoId && (
        <Secao title={(() => { const gs = grupos.find((g) => g.id === grupoId); return (
          <span className="flex items-center gap-2 min-w-0">
            {gs?.imagem
              ? <img src={gs.imagem} alt={gs.nome} title={gs.nome} className="h-7 w-7 rounded-lg object-contain shrink-0" />
              : <Zap className="w-5 h-5 text-primary-600 shrink-0" />}
            Automação
          </span>
        ) })()} open={eventosAbertos} onToggle={() => setEventosAbertos((v) => !v)} noPad>
        <div className="divide-y divide-surface-100 border-t border-surface-100">
          {KIWIFY_EVENTS.map((ev) => {
            const auto = automations[ev.id] || { ativo: false, templateId: '' }
            const ativo = !!auto.ativo
            const tpl = templatesById[auto.templateId]
            return (
              <div key={ev.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <div className="flex items-center gap-2 sm:w-52 shrink-0">
                  <Mail className={`w-4 h-4 ${ativo ? 'text-green-500' : 'text-stone-400'}`} />
                  <span className="font-medium text-stone-800 text-sm">{ev.label}</span>
                </div>

                <div className="flex-1 min-w-0 flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-stone-300 shrink-0 hidden sm:block mt-3.5" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Select
                      value={auto.templateId || ''}
                      onChange={(v) => setAuto(ev.id, { templateId: v })}
                      className="w-full"
                      disabled={templates.length === 0}
                      placeholder={templates.length === 0 ? 'SEM TEMPLATE' : 'Escolher template'}
                      preview
                      options={[{ value: '', label: 'Sem template' }, ...templates.map((t) => ({ value: t.id, label: t.nome, preview: emailPreviewDoc(t) }))]}
                    />
                    {auto.templateId && (
                      <RemetentePicker providers={providers} value={auto.remetenteId || null} onChange={(id) => setAuto(ev.id, { remetenteId: id })} />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuto(ev.id, { ativo: !ativo })}
                    disabled={!auto.templateId}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mt-2.5 disabled:opacity-40 ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
                    title={!auto.templateId ? 'Escolha um template primeiro' : ativo ? 'Desativar' : 'Ativar'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="sm:w-40 shrink-0 text-xs">
                  {ativo && tpl ? (
                    <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                      <LayoutTemplate className="w-3.5 h-3.5" /> {tpl.nome}
                    </span>
                  ) : (
                    <span className="text-stone-400">Inativo</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </Secao>
      )}


      <Panel
        title={<span className="flex items-center gap-2"><History className="w-4 h-4 text-primary-600" /> Linha do tempo</span>}
        noPadding
        right={<CollapsibleSearch value={buscaTL} onChange={setBuscaTL} placeholder="Contato ou produto" />}
      >
        <div className="overflow-x-auto">
          {leadsOrdenados.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">
              {buscaTL ? 'Nenhum evento encontrado.' : 'Nenhum evento recebido ainda. Quando a MundPay/Kiwify disparar um webhook, ele aparece aqui.'}
            </p>
          ) : (
            <table className="w-full text-sm min-w-[740px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  {[['contato', 'Contato'], ['evento', 'Evento recebido'], ['produto', 'Produto'], ['status', 'Envio automático'], ['quando', 'Quando']].map(([key, label]) => (
                    <th key={key} onClick={() => toggleSort(key)} className="px-4 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium text-xs"></th>
                </tr>
              </thead>
              <tbody>
                {leadsPagina.map((l) => (
                  <tr key={l.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-stone-800 truncate max-w-[180px]">{l.nome || '-'}</div>
                      <div className="text-xs text-stone-400 truncate max-w-[180px]">{l.email || ''}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs bg-surface-100 text-stone-600 px-2 py-0.5 rounded-full whitespace-nowrap">{eventoLabel(l.evento)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-stone-600 truncate max-w-[120px]">{l.produto || '-'}</td>
                    <td className="px-4 py-2.5">
                      {l.status === 'enviado' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Enviado{l.canal === 'email' ? ' (e-mail)' : ''}</span>
                      ) : l.status === 'erro' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" title={l.erroMsg || ''}><XCircle className="w-3.5 h-3.5" /> Erro</span>
                      ) : l.status === 'cancelado_recovery' ? (
                        <span className="text-xs text-slate-500">Cancelado</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title="Evento recebido, mas nenhuma automação ativa enviou"><Clock className="w-3.5 h-3.5" /> Só recebido</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{formatDate(l.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => openEnviar(l)} disabled={!l.email} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg px-2 py-1.5 disabled:opacity-40" title={l.email ? 'Enviar e-mail manual' : 'Lead sem e-mail'}><Send className="w-3.5 h-3.5" /> Enviar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {leadsOrdenados.length > TL_POR_PAGINA && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Página {tlPagina} de {tlTotalPaginas} · {leadsOrdenados.length} evento(s)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPTimeline((p) => Math.max(1, p - 1))} disabled={tlPagina <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPTimeline((p) => Math.min(tlTotalPaginas, p + 1))} disabled={tlPagina >= tlTotalPaginas} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </Panel>
      </div>
      </div>

      {enviarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setEnviarModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Send className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Enviar e-mail manual</h3>
                <p className="text-xs text-stone-500 truncate">Para: {enviarModal.email || '—'}{enviarModal.produto ? ` · ${enviarModal.produto}` : ''}</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Template</label>
              <Select
                value={manualTemplateId}
                onChange={setManualTemplateId}
                placeholder=""
                className="w-full"
                preview
                options={templates.map((t) => ({ value: t.id, label: t.nome, preview: emailPreviewDoc(t) }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEnviarModal(null)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={enviarManual} disabled={enviandoManual} className="btn-primary min-h-[44px]">{enviandoManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

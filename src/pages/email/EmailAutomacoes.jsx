import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, getEmailAutomations, saveEmailAutomation, getLeads, getProductGroups, getEmailProviders } from '../../lib/firestore'
import RemetentePicker from '../../components/RemetentePicker'
import { KIWIFY_EVENTS, canonicalEvento } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Mail, Zap, LayoutTemplate, ArrowRight, AlertCircle, History, RefreshCw, CheckCircle2, XCircle, Clock, Send, Loader2, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

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
  const [fEvento, setFEvento] = useState('')
  const [fProduto, setFProduto] = useState('')
  const [fStatus, setFStatus] = useState('')
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
  const leadsFiltrados = useMemo(() => leads.filter((l) => {
    if (fEvento && canonicalEvento(l.evento) !== fEvento) return false
    if (fProduto && l.produto !== fProduto) return false
    if (fStatus) {
      const s = l.status || 'pendente'
      if (fStatus === 'pendente') return s === 'pendente'
      return s === fStatus
    }
    return true
  }), [leads, fEvento, fProduto, fStatus])
  useEffect(() => { setPTimeline(1) }, [fEvento, fProduto, fStatus])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const TL_POR_PAGINA = 10
  const tlTotalPaginas = Math.max(1, Math.ceil(leadsFiltrados.length / TL_POR_PAGINA))
  const tlPagina = Math.min(pTimeline, tlTotalPaginas)
  const leadsPagina = leadsFiltrados.slice((tlPagina - 1) * TL_POR_PAGINA, tlPagina * TL_POR_PAGINA)

  return (
    <PageShell
      badge="E-mail · Automações"
      title="Automações de E-mail"
      subtitle="Escolha qual template de e-mail é enviado em cada evento. Vários eventos podem usar o mesmo template."
      right={
        <button onClick={reload} className="btn-secondary text-sm min-h-[44px]"><RefreshCw className="w-4 h-4" /> Atualizar</button>
      }
    >
      <div className="space-y-4 sm:space-y-5">
      {templates.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>
            Você ainda não tem templates. Crie um no{' '}
            <Link to="/email/construtor" className="font-semibold underline">Construtor</Link> para poder escolher aqui.
          </span>
        </div>
      )}

      {grupos.length === 0 ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          As automações de e-mail são <strong>por produto</strong>. Crie um{' '}
          <Link to="/email/produtos" className="font-semibold underline">grupo de produto</Link> primeiro (ex.: Gekko Pan, MemoMax).
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/70 border border-surface-200">
          <span className="text-sm font-medium text-stone-600">Automações do produto:</span>
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} className="px-3 py-2 min-h-[42px] rounded-xl border border-surface-200 text-sm bg-white font-semibold">
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </div>
      )}

      {grupoId && (
        <Secao title="Eventos" icon={Zap} open={eventosAbertos} onToggle={() => setEventosAbertos((v) => !v)} noPad>
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

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-stone-300 shrink-0 hidden sm:block" />
                    <select
                      value={auto.templateId || ''}
                      onChange={(e) => setAuto(ev.id, { templateId: e.target.value })}
                      className="flex-1 min-w-0 px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm bg-white"
                      disabled={templates.length === 0}
                    >
                      <option value="">{templates.length === 0 ? 'SEM TEMPLATE' : ''}</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                    </select>

                    <button
                      type="button"
                      onClick={() => setAuto(ev.id, { ativo: !ativo })}
                      disabled={!auto.templateId}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
                      title={!auto.templateId ? 'Escolha um template primeiro' : ativo ? 'Desativar' : 'Ativar'}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {auto.templateId && (
                    <div className="sm:pl-6">
                      <RemetentePicker providers={providers} value={auto.remetenteId || null} onChange={(id) => setAuto(ev.id, { remetenteId: id })} />
                    </div>
                  )}
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

      <p className="text-xs text-stone-500 leading-relaxed">
        Quando um evento chega e há uma automação <strong>ativa</strong> com template, o e-mail sai automático para o lead (variáveis já preenchidas). Use <strong>Enviar</strong> na linha do tempo para mandar manualmente.
      </p>

      <Panel title={<span className="flex items-center gap-2"><History className="w-4 h-4 text-primary-600" /> Linha do tempo — eventos recebidos</span>} noPadding>
        <div className="p-3 sm:p-4 border-b border-surface-100 flex flex-col sm:flex-row sm:flex-wrap gap-2 bg-white/40">
          <select value={fEvento} onChange={(e) => setFEvento(e.target.value)} className="min-h-[40px] px-3 rounded-xl border border-surface-200 text-sm bg-white">
            <option value="">Todos os eventos</option>
            {KIWIFY_EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
          </select>
          <select value={fProduto} onChange={(e) => setFProduto(e.target.value)} className="min-h-[40px] px-3 rounded-xl border border-surface-200 text-sm bg-white">
            <option value="">Todos os produtos</option>
            {produtosLista.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="min-h-[40px] px-3 rounded-xl border border-surface-200 text-sm bg-white">
            <option value="">Todos os envios</option>
            <option value="enviado">Enviado</option>
            <option value="pendente">Só recebido</option>
            <option value="erro">Erro</option>
            <option value="cancelado_recovery">Cancelado</option>
          </select>
          {(fEvento || fProduto || fStatus) && (
            <button onClick={() => { setFEvento(''); setFProduto(''); setFStatus('') }} className="text-xs text-primary-600 hover:underline px-2 self-center">Limpar filtros</button>
          )}
        </div>
        <div className="overflow-x-auto">
          {leadsFiltrados.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">
              {leads.length === 0 ? 'Nenhum evento recebido ainda. Quando a MundPay/Kiwify disparar um webhook, ele aparece aqui.' : 'Nenhum evento com esses filtros.'}
            </p>
          ) : (
            <table className="w-full text-sm min-w-[740px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  <th className="px-4 py-2.5 font-medium text-xs">Contato</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Evento recebido</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Produto</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Envio automático</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Quando</th>
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
        {leadsFiltrados.length > TL_POR_PAGINA && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Página {tlPagina} de {tlTotalPaginas} · {leadsFiltrados.length} evento(s)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPTimeline((p) => Math.max(1, p - 1))} disabled={tlPagina <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPTimeline((p) => Math.min(tlTotalPaginas, p + 1))} disabled={tlPagina >= tlTotalPaginas} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </Panel>
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
              <select value={manualTemplateId} onChange={(e) => setManualTemplateId(e.target.value)} className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm bg-white">
                <option value="">— escolha —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
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

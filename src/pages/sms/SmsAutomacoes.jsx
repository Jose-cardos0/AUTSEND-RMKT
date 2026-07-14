import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import MessageEditor from '../../components/MessageEditor'
import MelhorarPlano from '../../components/MelhorarPlano'
import CollapsibleSearch from '../../components/CollapsibleSearch'
import { getSmsAutomations, saveSmsAutomationGrupo, getProductGroups, getLeads, getSmsLogs } from '../../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../../lib/constants'
import { usePlano } from '../../lib/PlanoContext'
import { Loader2, Zap, Package, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Send, MessageSquare, AlertCircle, RefreshCw, Filter } from 'lucide-react'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'

const eventLabel = (id) => {
  if (!id || id === 'unknown' || id === 'false') return 'Outro'
  return KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id
}

/** Normaliza pra E.164 internacional (espelho do backend). Rejeita BR (+55). */
function normalizarE164Internacional(raw) {
  let s = String(raw || '').trim()
  const temMais = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false }
  if (!temMais && d.length === 10) d = '1' + d
  if (d.startsWith('55')) return { ok: false, br: true }
  if (d.length < 8 || d.length > 15) return { ok: false }
  return { ok: true, e164: '+' + d }
}

function SmsStatusBadge({ status }) {
  const map = { enviado: 'bg-green-100 text-green-700', erro: 'bg-red-100 text-red-700', pendente: 'bg-stone-100 text-stone-500' }
  const label = { enviado: 'Enviado', erro: 'Erro', pendente: 'Não enviado' }
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.pendente}`}>{label[status] || 'Não enviado'}</span>
}

function EventCard({ event, auto, onSave }) {
  const [expanded, setExpanded] = useState(false)
  const [mensagem, setMensagem] = useState(auto?.mensagem || '')
  const [ativo, setAtivo] = useState(auto?.ativo ?? false)
  const [salvando, setSalvando] = useState(false)
  const editorRef = useRef(null)

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
        <div className="p-4 pt-0 space-y-3 border-t border-surface-100">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">Texto do SMS automático</label>
            <MessageEditor
              ref={editorRef}
              value={mensagem}
              onChange={setMensagem}
              placeholder={'Autsend: hey {nome_cliente}, thanks for your interest in {nome_produto}! Reply STOP to opt out.'}
              rows={4}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => editorRef.current?.insert(v.key)}
                className="text-[11px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200/70 rounded-full px-2.5 py-1 transition-colors"
              >
                {v.key}
              </button>
            ))}
          </div>

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
  const [autoMsgAberto, setAutoMsgAberto] = useState(false)

  const [leads, setLeads] = useState([])
  const [smsLogs, setSmsLogs] = useState([])
  const [filtroNome, setFiltroNome] = useState('')
  const [paginaLeads, setPaginaLeads] = useState(1)
  const [reenviandoId, setReenviandoId] = useState(null)
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  useEffect(() => { setPaginaLeads(1) }, [filtroNome, sortKey, sortDir])

  const load = async () => {
    if (!user?.uid) return
    const [a, gs, l, logs] = await Promise.all([getSmsAutomations(user.uid), getProductGroups(user.uid), getLeads(user.uid), getSmsLogs(user.uid)])
    setAutos(a); setGrupos(gs); setLeads(l); setSmsLogs(logs)
  }

  useEffect(() => {
    if (!user?.uid) return
    load().finally(() => setLoading(false))
  }, [user?.uid])

  const reload = async () => { setLoading(true); await load(); setLoading(false) }

  useEffect(() => {
    if (grupos.length > 0 && !grupos.some((g) => g.id === grupoId)) setGrupoId(grupos[0].id)
  }, [grupos])

  const autoMap = useMemo(() => {
    const m = {}
    KIWIFY_EVENTS.forEach((e) => { m[e.id] = autos.find((a) => a.grupoId === grupoId && a.evento === e.id) || null })
    return m
  }, [autos, grupoId])

  const grupoSel = useMemo(() => grupos.find((g) => g.id === grupoId) || null, [grupos, grupoId])

  // Status de SMS por lead (o log mais recente vence — smsLogs já vem ordenado desc).
  const smsStatusByLead = useMemo(() => {
    const m = {}
    for (const l of smsLogs) { if (l.leadId && !(l.leadId in m)) m[l.leadId] = l.status }
    return m
  }, [smsLogs])

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

  const handleReenviar = async (lead) => {
    const grupoLead = grupos.find((g) => Array.isArray(g.produtos) && g.produtos.includes(lead.produto))
    const forEvent = autos.filter((a) => a.evento === lead.evento)
    const auto = (grupoLead && forEvent.find((a) => a.grupoId === grupoLead.id)) || forEvent.find((a) => !a.grupoId) || null
    if (!auto?.mensagem) { toast.error('Nenhuma automação de SMS configurada para este evento. Configure primeiro.'); return }
    const norm = normalizarE164Internacional(lead.telefone)
    if (!norm.ok) { toast.error(norm.br ? 'SMS não atende números do Brasil (+55).' : 'Número inválido.'); return }
    setReenviandoId(lead.id)
    try {
      const fn = httpsCallable(functions, 'reenviarSMSLead')
      await fn({ telefone: lead.telefone, nome: lead.nome, produto: lead.produto, email: lead.email, evento: lead.evento, mensagem: auto.mensagem, leadId: lead.id })
      toast.success(`SMS reenviado para ${lead.nome || lead.telefone}`)
      setSmsLogs(await getSmsLogs(user.uid))
    } catch (err) {
      toast.error(err.message || 'Erro ao reenviar')
    } finally {
      setReenviandoId(null)
    }
  }

  const formatDate = (ts) => {
    if (!ts) return '-'
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  const LEADS_POR_PAGINA = 5
  const filtered = useMemo(() => {
    let list = leads
    if (filtroNome.trim()) {
      const q = filtroNome.toLowerCase()
      list = list.filter((l) => (l.nome || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.telefone || '').includes(filtroNome))
    }
    if (sortKey) {
      const val = (l) => {
        switch (sortKey) {
          case 'nome': return (l.nome || '').toLowerCase()
          case 'telefone': return l.telefone || ''
          case 'produto': return (l.produto || '').toLowerCase()
          case 'evento': return (l.evento || '').toLowerCase()
          case 'status': return smsStatusByLead[l.id] || 'pendente'
          case 'data': return l.createdAt?.toMillis ? l.createdAt.toMillis() : (l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0)
          default: return 0
        }
      }
      list = [...list].sort((a, b) => {
        const va = val(a), vb = val(b)
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }
    return list
  }, [leads, filtroNome, sortKey, sortDir, smsStatusByLead])

  const totalPaginasLeads = Math.max(1, Math.ceil(filtered.length / LEADS_POR_PAGINA))
  const paginaLeadsAtual = Math.min(paginaLeads, totalPaginasLeads)
  const leadsPagina = filtered.slice((paginaLeadsAtual - 1) * LEADS_POR_PAGINA, paginaLeadsAtual * LEADS_POR_PAGINA)

  if (loading) return <PageLoader />

  return (
    <PageShell
      className="!space-y-0 pb-12 sm:pb-14"
      badge="SMS · Automações"
      right={
        <button onClick={reload} className="btn-secondary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      }
    >
      <div className="mt-8 sm:mt-10 flex flex-col lg:flex-row gap-6">
        {/* Grupos — coluna lateral esquerda fixa (sticky) */}
        <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-1">
          <div className="lg:sticky lg:top-24 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-widest">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Package className="w-4 h-4 shrink-0" /></span>
                Produtos <span className="text-[10px] font-normal text-stone-400 normal-case tracking-normal">({grupos.length})</span>
              </span>
              <Link to="/produtos" className="text-[11px] text-primary-600 hover:underline">Gerenciar</Link>
            </div>
            {grupos.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                As automações são <strong>por grupo de produto</strong>. Crie um{' '}
                <Link to="/produtos" className="font-semibold underline">grupo</Link> primeiro.
              </div>
            ) : (
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
            )}
          </div>
        </aside>

        {/* Conteúdo principal */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 lg:order-2">
          {!podeSms && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="flex-1">Seu plano não inclui SMS. Faça upgrade para disparar SMS automático.</span>
              <MelhorarPlano label="Ver planos" className="shrink-0" />
            </div>
          )}

          {grupoId && (
            <div className="app-panel rounded-2xl overflow-hidden">
              <button type="button" onClick={() => setAutoMsgAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 hover:bg-surface-50 transition">
                <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
                  {grupoSel?.imagem
                    ? <img src={grupoSel.imagem} alt={grupoSel.nome} title={grupoSel.nome} className="h-7 w-7 rounded-lg object-contain shrink-0" />
                    : <Zap className="w-5 h-5 text-primary-600 shrink-0" />}
                  Automação
                </span>
                <ChevronDown className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${autoMsgAberto ? 'rotate-180' : ''}`} />
              </button>
              {autoMsgAberto && (
                <div className="p-4 sm:p-6 space-y-3 sm:space-y-4 border-t border-surface-100">
                  {KIWIFY_EVENTS.map((event) => (
                    <EventCard key={event.id} event={event} auto={autoMap[event.id]} onSave={handleSave} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Leads recebidos — relatório de SMS + reenvio */}
          <Panel
            title="Leads recebidos"
            icon={Filter}
            noPadding
            right={<CollapsibleSearch value={filtroNome} onChange={setFiltroNome} placeholder="Nome, e-mail ou telefone" />}
          >
            <div className="w-full overflow-x-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-stone-400 text-sm">
                  {leads.length === 0 ? 'Nenhum lead recebido ainda.' : 'Nenhum lead corresponde aos filtros.'}
                </div>
              ) : (
                <table className="w-full text-sm min-w-[680px]">
                  <thead>
                    <tr className="border-b border-surface-100 text-left text-stone-500">
                      {[['nome', 'Nome'], ['telefone', 'Telefone'], ['produto', 'Produto'], ['evento', 'Evento'], ['status', 'Status'], ['data', 'Data']].map(([key, label]) => (
                        <th key={key} onClick={() => toggleSort(key)} className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                          {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium w-14 sm:w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPagina.map((lead) => {
                      const norm = normalizarE164Internacional(lead.telefone)
                      return (
                        <tr key={lead.id} className="border-b border-surface-50 hover:bg-surface-50/80 transition">
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <div className="font-medium text-stone-800 truncate max-w-[120px] sm:max-w-[160px]">{lead.nome || '-'}</div>
                            <div className="text-xs text-stone-400 truncate max-w-[120px] sm:max-w-[160px]">{lead.email || ''}</div>
                          </td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-600 font-mono text-xs">{lead.telefone || '-'}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-700 truncate max-w-[80px] sm:max-w-[120px]">{lead.produto || '-'}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <span className="text-xs bg-surface-100 text-stone-600 px-2 py-0.5 rounded-full whitespace-nowrap">{eventLabel(lead.evento)}</span>
                          </td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3"><SmsStatusBadge status={smsStatusByLead[lead.id] || 'pendente'} /></td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs text-stone-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <button
                              onClick={() => handleReenviar(lead)}
                              disabled={reenviandoId === lead.id || !norm.ok}
                              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-primary-50 text-primary-600 disabled:opacity-40 disabled:pointer-events-none transition touch-manipulation"
                              title={!norm.ok ? (norm.br ? 'SMS não atende números do Brasil' : 'Número inválido') : 'Enviar SMS'}
                            >
                              {reenviandoId === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {filtered.length > LEADS_POR_PAGINA && (
                <div className="px-4 py-3 sm:py-4 border-t border-surface-100 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
                  <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">
                    Página {paginaLeadsAtual} de {totalPaginasLeads} · {filtered.length} lead(s)
                  </p>
                  <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
                    <button type="button" onClick={() => setPaginaLeads((p) => Math.max(1, p - 1))} disabled={paginaLeadsAtual <= 1}
                      className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial">
                      <ChevronLeft className="w-4 h-4" /> Anterior
                    </button>
                    <button type="button" onClick={() => setPaginaLeads((p) => Math.min(totalPaginasLeads, p + 1))} disabled={paginaLeadsAtual >= totalPaginasLeads}
                      className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial">
                      Próxima <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}

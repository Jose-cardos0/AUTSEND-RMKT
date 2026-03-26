import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import {
  getLeads,
  getProducts,
  getAutoMessages,
  saveAutoMessage,
  getMessageLogs,
  getEvolutionConfig,
  reenviarLead,
} from '../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../lib/constants'
import {
  Loader2,
  Zap,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  RefreshCw,
  Package,
  BarChart3,
  Filter,
  Send,
} from 'lucide-react'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'

const eventLabel = (id) => {
    if (!id || id === 'unknown' || id === 'false') return 'Outro'
    return KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id
  }

function StatCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90 shadow-blue-500/5',
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90 shadow-emerald-500/5',
    red: 'from-rose-50 to-red-50/80 text-rose-700 border-rose-100/90 shadow-rose-500/5',
    amber: 'from-amber-50 to-orange-50/70 text-amber-800 border-amber-100/90 shadow-amber-500/5',
    purple: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90 shadow-violet-500/5',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, transition: { type: 'spring', stiffness: 400, damping: 22 } }}
      className={`rounded-2xl sm:rounded-3xl border bg-gradient-to-br p-4 sm:p-5 shadow-lg ${colors[color] || colors.blue}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-55">{label}</p>
          <p className="text-2xl sm:text-3xl font-bold mt-2 tracking-tight tabular-nums">{value}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-white/70 backdrop-blur-sm shadow-inner flex items-center justify-center ring-1 ring-white/80">
          <Icon className="w-5 h-5 opacity-70" />
        </div>
      </div>
    </motion.div>
  )
}

const STATUS_LABELS = { enviado: 'Enviado', erro: 'Erro', pendente: 'Pendente', cancelado_recovery: 'Cancelado (compra aprovada)' }
function StatusBadge({ status }) {
  const map = {
    enviado: 'bg-green-100 text-green-700',
    erro: 'bg-red-100 text-red-700',
    pendente: 'bg-amber-100 text-amber-700',
    cancelado_recovery: 'bg-slate-100 text-slate-600',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.pendente}`}>
      {STATUS_LABELS[status] || status || 'Pendente'}
    </span>
  )
}

function VariableButtons({ textareaRef, value, onChange }) {
  const insert = (varKey) => {
    const ta = textareaRef.current
    if (!ta) {
      onChange((value || '') + varKey)
      return
    }
    const start = ta.selectionStart
    const text = value || ''
    const newText = text.slice(0, start) + varKey + text.slice(start)
    onChange(newText)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + varKey.length, start + varKey.length)
    }, 0)
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {TEMPLATE_VARIABLES.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => insert(v.key)}
          className="px-2.5 py-1 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100 border border-primary-200 transition"
          title={v.label}
        >
          {v.key}
        </button>
      ))}
    </div>
  )
}

function EventCard({ event, autoMsg, leadCount, onSave, productName }) {
  const [expanded, setExpanded] = useState(false)
  const [mensagem, setMensagem] = useState(autoMsg?.mensagem || '')
  const [ativo, setAtivo] = useState(autoMsg?.ativo ?? false)
  const [salvando, setSalvando] = useState(false)
  const taRef = useRef(null)

  useEffect(() => {
    setMensagem(autoMsg?.mensagem || '')
    setAtivo(autoMsg?.ativo ?? false)
  }, [autoMsg?.mensagem, autoMsg?.ativo])

  const handleSave = async () => {
    setSalvando(true)
    try {
      await onSave(event.id, { mensagem, ativo })
      toast.success(productName ? `Mensagem "${event.label}" do produto "${productName}" salva.` : `Automação "${event.label}" salva.`)
    } catch {
      toast.error('Erro ao salvar automação.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="app-panel border border-surface-200/90 rounded-2xl overflow-hidden bg-white/90">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 sm:p-4 min-h-[52px] hover:bg-surface-50 active:bg-surface-100 transition touch-manipulation"
      >
        <div className="flex items-center gap-3">
          <Zap className={`w-4 h-4 ${ativo ? 'text-green-500' : 'text-stone-400'}`} />
          <span className="font-medium text-stone-800">{event.label}</span>
          {leadCount > 0 && (
            <span className="text-xs bg-surface-100 text-stone-500 px-2 py-0.5 rounded-full">{leadCount} leads</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${ativo ? 'text-green-600' : 'text-stone-400'}`}>
            {ativo ? 'Ativo' : 'Inativo'}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 pt-0 space-y-3 border-t border-surface-100">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-stone-700">Envio automático</label>
            <button
              type="button"
              onClick={() => setAtivo(!ativo)}
              className={`relative w-11 h-6 rounded-full transition-colors ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">Variáveis de template</label>
            <VariableButtons textareaRef={taRef} value={mensagem} onChange={setMensagem} />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">Mensagem automática</label>
            <textarea
              ref={taRef}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder={`Ex: Olá {nome_cliente}, notamos que você se interessou por {nome_produto}...`}
              rows={4}
              className="w-full p-3 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-sm"
            />
            <p className="text-xs text-stone-400 mt-1">Use *texto* para negrito e _texto_ para itálico no WhatsApp.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={salvando}
            className="btn-primary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {salvando ? 'Salvando...' : 'Salvar automação'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Automacoes() {
  const [user] = useAuthState(auth)
  const [leads, setLeads] = useState([])
  const [products, setProducts] = useState([])
  const [autoMessages, setAutoMessages] = useState([])
  const [evolution, setEvolution] = useState(null)
  const [loading, setLoading] = useState(true)

  const [filtroEvento, setFiltroEvento] = useState('')
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroNome, setFiltroNome] = useState('')

  const [reenviandoId, setReenviandoId] = useState(null)
  const [paginaLeads, setPaginaLeads] = useState(1)
  const [selectedProduto, setSelectedProduto] = useState('')

  useEffect(() => {
    setPaginaLeads(1)
  }, [filtroEvento, filtroProduto, filtroStatus, filtroNome])

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([
      getLeads(user.uid),
      getProducts(user.uid),
      getAutoMessages(user.uid),
      getEvolutionConfig(user.uid),
    ]).then(([l, p, a, e]) => {
      setLeads(l)
      setProducts(p)
      setAutoMessages(a)
      setEvolution(e)
      setLoading(false)
    })
  }, [user?.uid])

  const reload = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [l, p, a, e] = await Promise.all([
      getLeads(user.uid),
      getProducts(user.uid),
      getAutoMessages(user.uid),
      getEvolutionConfig(user.uid),
    ])
    setLeads(l)
    setProducts(p)
    setAutoMessages(a)
    setEvolution(e)
    setLoading(false)
  }

  const autoMsgMap = useMemo(() => {
    const m = {}
    KIWIFY_EVENTS.forEach((e) => {
      const forEvent = autoMessages.filter((a) => a.evento === e.id)
      const exact = forEvent.find((a) => a.produto === selectedProduto)
      const global = forEvent.find((a) => !a.produto || a.produto === '')
      m[e.id] = exact || global || forEvent[0] || null
    })
    return m
  }, [autoMessages, selectedProduto])

  const leadsCountByEvent = useMemo(() => {
    const m = {}
    leads.forEach((l) => { m[l.evento] = (m[l.evento] || 0) + 1 })
    return m
  }, [leads])

  const stats = useMemo(() => {
    const total = leads.length
    const enviados = leads.filter((l) => l.status === 'enviado').length
    const erros = leads.filter((l) => l.status === 'erro').length
    const pendentes = leads.filter((l) => !l.status || l.status === 'pendente').length
    return { total, enviados, erros, pendentes }
  }, [leads])

  const LEADS_POR_PAGINA = 5

  const filtered = useMemo(() => {
    let list = leads
    if (filtroEvento) list = list.filter((l) => l.evento === filtroEvento)
    if (filtroProduto) list = list.filter((l) => l.produto === filtroProduto)
    if (filtroStatus) list = list.filter((l) => (l.status || 'pendente') === filtroStatus)
    if (filtroNome.trim()) {
      const q = filtroNome.toLowerCase()
      list = list.filter(
        (l) =>
          (l.nome || '').toLowerCase().includes(q) ||
          (l.email || '').toLowerCase().includes(q) ||
          (l.telefone || '').includes(filtroNome)
      )
    }
    return list
  }, [leads, filtroEvento, filtroProduto, filtroStatus, filtroNome])

  const totalPaginasLeads = Math.max(1, Math.ceil(filtered.length / LEADS_POR_PAGINA))
  const paginaLeadsAtual = Math.min(paginaLeads, totalPaginasLeads)
  const leadsPagina = useMemo(
    () => filtered.slice((paginaLeadsAtual - 1) * LEADS_POR_PAGINA, paginaLeadsAtual * LEADS_POR_PAGINA),
    [filtered, paginaLeadsAtual]
  )

  const handleSaveAutoMsg = async (evento, data) => {
    await saveAutoMessage(user.uid, evento, selectedProduto, data)
    setAutoMessages((prev) => {
      const idx = prev.findIndex((a) => a.evento === evento && (a.produto || '') === (selectedProduto || ''))
      const updated = { evento, produto: selectedProduto || '', ...data }
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], ...updated }
        return copy
      }
      return [...prev, updated]
    })
  }

  const handleReenviar = async (lead) => {
    const forEvent = autoMessages.filter((a) => a.evento === lead.evento)
    const msg = forEvent.find((a) => a.produto === lead.produto) || forEvent.find((a) => !a.produto || a.produto === '') || forEvent[0]
    if (!msg?.mensagem) {
      toast.error('Nenhuma mensagem automática configurada para este evento. Configure primeiro.')
      return
    }
    if (!evolution?.nomeInstancia) {
      toast.error('Nenhuma instância conectada. Vá em Integrações.')
      return
    }
    setReenviandoId(lead.id)
    try {
      const ok = await reenviarLead(user.uid, lead, msg.mensagem, evolution)
      if (ok) {
        toast.success(`Reenviado para ${lead.nome || lead.telefone}`)
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: 'enviado' } : l)))
      } else {
        toast.error('Falha ao reenviar')
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: 'erro' } : l)))
      }
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

  const uniqueProducts = useMemo(() => {
    const names = new Set(leads.map((l) => l.produto).filter(Boolean))
    products.forEach((p) => names.add(p.nome))
    return [...names].filter(Boolean).sort()
  }, [leads, products])

  useEffect(() => {
    if (uniqueProducts.length > 0 && !uniqueProducts.includes(selectedProduto)) {
      setSelectedProduto(uniqueProducts[0])
    }
  }, [uniqueProducts])

  if (loading) {
    return <PageLoader />
  }

  return (
    <PageShell
      className="!space-y-0 pb-12 sm:pb-14"
      badge="Kiwify & WhatsApp"
      title="Automações"
      subtitle="Fluxos por evento, mensagens por produto e visão dos leads em tempo real."
      right={
        <button onClick={reload} className="btn-secondary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      }
    >
      <div className="mt-8 sm:mt-10 flex flex-col gap-8 sm:gap-10">
      <section>
        <h2 className="text-xs sm:text-sm font-bold text-stone-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
            <BarChart3 className="w-4 h-4 shrink-0" />
          </span>
          Dashboard
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Leads" value={stats.total} icon={Users} color="blue" />
          <StatCard label="Enviados" value={stats.enviados} icon={CheckCircle2} color="green" />
          <StatCard label="Erros" value={stats.erros} icon={XCircle} color="red" />
          <StatCard label="Pendentes" value={stats.pendentes} icon={Clock} color="amber" />
        </div>
      </section>

      <section>
        <h2 className="text-xs sm:text-sm font-bold text-stone-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Package className="w-4 h-4 shrink-0" />
          </span>
          Produtos
        </h2>
        <div className="flex overflow-x-auto gap-2 sm:gap-3 p-1">
          {uniqueProducts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedProduto(p)}
              className={`px-3.5 sm:px-4 py-2.5 min-h-[42px] rounded-xl border text-sm font-semibold transition-all duration-200 whitespace-nowrap touch-manipulation shrink-0 ${
                selectedProduto === p
                  ? 'border-primary-500 bg-gradient-to-br from-white to-primary-50/80 text-primary-800 shadow-lg shadow-primary-500/15 ring-2 ring-primary-200/80'
                  : 'border-transparent bg-white/60 text-stone-700 hover:bg-white hover:border-surface-200 hover:shadow-md'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {selectedProduto && (
          <p className="text-sm text-stone-600 mt-4 leading-relaxed">
            Configurando mensagens para: <strong className="text-primary-600">{selectedProduto}</strong>
          </p>
        )}
      </section>

      {selectedProduto && (
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500 shrink-0" />
            Mensagens automáticas —{' '}
            <strong className="text-primary-600 break-all">{selectedProduto}</strong>
          </span>
        }
        noPadding
      >
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          {KIWIFY_EVENTS.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              autoMsg={autoMsgMap[event.id]}
              leadCount={leadsCountByEvent[event.id] || 0}
              onSave={handleSaveAutoMsg}
              productName={selectedProduto}
            />
          ))}
        </div>
      </Panel>
      )}

      <Panel title="Leads recebidos" icon={Filter} noPadding>
        <div className="p-4 border-b border-surface-100 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end bg-white/40">
          <div className="relative w-full sm:w-56 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={filtroNome}
              onChange={(e) => setFiltroNome(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <select
            value={filtroEvento}
            onChange={(e) => setFiltroEvento(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] px-3 py-2.5 rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="">Todos os eventos</option>
            {KIWIFY_EVENTS.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          <select
            value={filtroProduto}
            onChange={(e) => setFiltroProduto(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] px-3 py-2.5 rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="">Todos os produtos</option>
            {uniqueProducts.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] px-3 py-2.5 rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="">Todos os status</option>
            <option value="enviado">Enviado</option>
            <option value="erro">Erro</option>
            <option value="pendente">Pendente</option>
            <option value="cancelado_recovery">Cancelado (compra aprovada)</option>
          </select>
          {(filtroEvento || filtroProduto || filtroStatus || filtroNome) && (
            <button
              onClick={() => { setFiltroEvento(''); setFiltroProduto(''); setFiltroStatus(''); setFiltroNome('') }}
              className="text-xs text-primary-600 hover:underline py-2 touch-manipulation"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-sm">
              {leads.length === 0
                ? 'Nenhum lead recebido ainda. Configure o webhook na Kiwify para começar a receber eventos.'
                : 'Nenhum lead corresponde aos filtros selecionados.'}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Nome</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Telefone</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Produto</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Evento</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Status</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm">Data</th>
                  <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium w-14 sm:w-20"></th>
                </tr>
              </thead>
              <tbody>
                {leadsPagina.map((lead) => (
                  <tr key={lead.id} className="border-b border-surface-50 hover:bg-surface-50/80 transition">
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                      <div className="font-medium text-stone-800 truncate max-w-[120px] sm:max-w-[160px]">{lead.nome || '-'}</div>
                      <div className="text-xs text-stone-400 truncate max-w-[120px] sm:max-w-[160px]">{lead.email || ''}</div>
                    </td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-600 font-mono text-xs">{lead.telefone || '-'}</td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-700 truncate max-w-[80px] sm:max-w-[120px]">{lead.produto || '-'}</td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                      <span className="text-xs bg-surface-100 text-stone-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {eventLabel(lead.evento)}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3"><StatusBadge status={lead.status} /></td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs text-stone-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                      {(lead.status === 'erro' || lead.status === 'pendente' || !lead.status) && (
                        <button
                          onClick={() => handleReenviar(lead)}
                          disabled={reenviandoId === lead.id}
                          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-primary-50 text-primary-600 disabled:opacity-50 transition touch-manipulation"
                          title="Reenviar"
                        >
                          {reenviandoId === lead.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <RefreshCw className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > LEADS_POR_PAGINA && (
            <div className="px-4 py-3 sm:py-4 border-t border-surface-100 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
              <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">
                Página {paginaLeadsAtual} de {totalPaginasLeads} · {filtered.length} lead(s)
              </p>
              <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPaginaLeads((p) => Math.max(1, p - 1))}
                  disabled={paginaLeadsAtual <= 1}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPaginaLeads((p) => Math.min(totalPaginasLeads, p + 1))}
                  disabled={paginaLeadsAtual >= totalPaginasLeads}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </Panel>
      </div>
    </PageShell>
  )
}

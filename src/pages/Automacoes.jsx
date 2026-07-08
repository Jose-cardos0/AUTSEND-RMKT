import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import {
  getLeads,
  getProducts,
  getAutoMessages,
  saveAutoMessageGrupo,
  getProductGroups,
  getMessageLogs,
  getEvolutionConfig,
  reenviarLead,
  setLeadReenvios,
} from '../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../lib/constants'
import {
  Loader2,
  Zap,
  Users,
  CheckCircle2,
  Check,
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
function WhatsappIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function StatusBadge({ status, reenvios }) {
  const map = {
    enviado: 'bg-green-100 text-green-700',
    erro: 'bg-red-100 text-red-700',
    pendente: 'bg-amber-100 text-amber-700',
    cancelado_recovery: 'bg-slate-100 text-slate-600',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.pendente}`}>
      {STATUS_LABELS[status] || status || 'Pendente'}
      {status === 'enviado' && reenvios > 0 ? ` +${reenvios}` : ''}
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

  const handleToggleAtivo = async () => {
    const novo = !ativo
    setAtivo(novo)
    try {
      await onSave(event.id, { mensagem, ativo: novo })
    } catch {
      setAtivo(!novo)
      toast.error('Erro ao salvar.')
    }
  }

  return (
    <div className="app-panel border border-surface-200/90 rounded-2xl overflow-hidden bg-white/90">
      <div className="w-full flex items-center justify-between p-3 sm:p-4 min-h-[52px] gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <WhatsappIcon className={`w-4 h-4 shrink-0 ${ativo ? 'text-green-500' : 'text-stone-400'}`} />
          <span className="font-medium text-stone-800">{event.label}</span>
          {leadCount > 0 && (
            <span className="text-xs bg-surface-100 text-stone-500 px-2 py-0.5 rounded-full shrink-0">{leadCount} leads</span>
          )}
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleToggleAtivo}
            className={`relative w-11 h-6 rounded-full transition-colors ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
            title={ativo ? 'Desativar' : 'Ativar'}
          >
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
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [autoMsgAberto, setAutoMsgAberto] = useState(false)

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
      getProductGroups(user.uid),
    ]).then(([l, p, a, e, gs]) => {
      setLeads(l)
      setProducts(p)
      setAutoMessages(a)
      setEvolution(e)
      setGrupos(gs)
      setLoading(false)
    })
  }, [user?.uid])

  const reload = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [l, p, a, e, gs] = await Promise.all([
      getLeads(user.uid),
      getProducts(user.uid),
      getAutoMessages(user.uid),
      getEvolutionConfig(user.uid),
      getProductGroups(user.uid),
    ])
    setLeads(l)
    setProducts(p)
    setAutoMessages(a)
    setEvolution(e)
    setGrupos(gs)
    setLoading(false)
  }

  const autoMsgMap = useMemo(() => {
    const m = {}
    KIWIFY_EVENTS.forEach((e) => {
      m[e.id] = autoMessages.find((a) => a.grupoId === grupoId && a.evento === e.id) || null
    })
    return m
  }, [autoMessages, grupoId])

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
    if (!grupoId) { toast.error('Selecione um grupo de produto.'); return }
    await saveAutoMessageGrupo(user.uid, grupoId, evento, data)
    setAutoMessages((prev) => {
      const idx = prev.findIndex((a) => a.grupoId === grupoId && a.evento === evento)
      const updated = { grupoId, evento, ...data, id: `${grupoId}__${evento}` }
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], ...updated }
        return copy
      }
      return [...prev, updated]
    })
  }

  const handleReenviar = async (lead) => {
    const grupoLead = grupos.find((g) => Array.isArray(g.produtos) && g.produtos.includes(lead.produto))
    const forEvent = autoMessages.filter((a) => a.evento === lead.evento)
    const msg = (grupoLead && forEvent.find((a) => a.grupoId === grupoLead.id)) || forEvent.find((a) => !a.produto && !a.grupoId) || null
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
        // Só conta "+N" quando o lead JÁ estava enviado antes deste reenvio
        const novoReenvios = lead.status === 'enviado' ? (lead.reenvios || 0) + 1 : (lead.reenvios || 0)
        toast.success(`Reenviado para ${lead.nome || lead.telefone}`)
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: 'enviado', reenvios: novoReenvios } : l)))
        setLeadReenvios(user.uid, lead.id, novoReenvios).catch(() => {})
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
    if (grupos.length > 0 && !grupos.some((g) => g.id === grupoId)) setGrupoId(grupos[0].id)
  }, [grupos])

  const grupoNome = useMemo(() => grupos.find((g) => g.id === grupoId)?.nome || '', [grupos, grupoId])

  if (loading) {
    return <PageLoader />
  }

  return (
    <PageShell
      className="!space-y-0 pb-12 sm:pb-14"
      badge="Dashboard"
      title="Automações"
      right={
        <button onClick={reload} className="btn-secondary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      }
    >
      <div className="mt-8 sm:mt-10 flex flex-col lg:flex-row gap-6">
      {/* Dashboard — coluna lateral direita fixa (sticky) no desktop */}
      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-3">
        <div className="lg:sticky lg:top-24 space-y-3">
          <h2 className="text-xs font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
              <BarChart3 className="w-4 h-4 shrink-0" />
            </span>
            Dashboard
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            <StatCard label="Total Leads" value={stats.total} icon={Users} color="blue" />
            <StatCard label="Enviados" value={stats.enviados} icon={CheckCircle2} color="green" />
            <StatCard label="Erros" value={stats.erros} icon={XCircle} color="red" />
            <StatCard label="Pendentes" value={stats.pendentes} icon={Clock} color="amber" />
          </div>
        </div>
      </aside>

      {/* Grupo de produtos — coluna lateral esquerda fixa (sticky), sem fundo, estilo do dashboard */}
      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-1">
        <div className="lg:sticky lg:top-24 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-widest">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Package className="w-4 h-4 shrink-0" /></span>
              Produtos
              <span className="text-[10px] font-normal text-stone-400 normal-case tracking-normal">({grupos.length})</span>
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
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGrupoId(g.id)}
                    className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition touch-manipulation ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${sel ? 'bg-primary-500 text-white' : 'bg-surface-100 text-stone-400'}`}><Package className="w-3.5 h-3.5" /></span>
                    <span className="text-sm font-medium text-stone-800 truncate">{g.nome}</span>
                    {sel && <Check className="w-4 h-4 text-primary-600 shrink-0 ml-auto" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Conteúdo principal (meio) */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 lg:order-2">

      {grupoId && (
        <div className="app-panel rounded-2xl overflow-hidden">
          <button type="button" onClick={() => setAutoMsgAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 hover:bg-surface-50 transition">
            <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800">
              <Zap className="w-5 h-5 text-amber-500 shrink-0" />
              Automação
            </span>
            <ChevronDown className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${autoMsgAberto ? 'rotate-180' : ''}`} />
          </button>
          {autoMsgAberto && (
            <div className="p-4 sm:p-6 space-y-3 sm:space-y-4 border-t border-surface-100">
              {KIWIFY_EVENTS.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  autoMsg={autoMsgMap[event.id]}
                  leadCount={leadsCountByEvent[event.id] || 0}
                  onSave={handleSaveAutoMsg}
                  productName={grupoNome}
                />
              ))}
            </div>
          )}
        </div>
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
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3"><StatusBadge status={lead.status} reenvios={lead.reenvios} /></td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs text-stone-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                    <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                      {lead.status !== 'cancelado_recovery' && (
                        <button
                          onClick={() => handleReenviar(lead)}
                          disabled={reenviandoId === lead.id}
                          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-primary-50 text-primary-600 disabled:opacity-50 transition touch-manipulation"
                          title={lead.status === 'enviado' ? 'Reenviar novamente' : 'Reenviar'}
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
      </div>
    </PageShell>
  )
}

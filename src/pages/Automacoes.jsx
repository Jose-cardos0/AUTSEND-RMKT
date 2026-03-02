import { useState, useEffect, useMemo, useRef } from 'react'
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
  Search,
  RefreshCw,
  Package,
  BarChart3,
  Filter,
  Send,
} from 'lucide-react'

const eventLabel = (id) => {
    if (!id || id === 'unknown' || id === 'false') return 'Outro'
    return KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id
  }

function StatCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
  }
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] || colors.blue}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon className="w-8 h-8 opacity-40" />
      </div>
    </div>
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
    <div className="border border-surface-200 rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-50 transition"
      >
        <div className="flex items-center gap-3">
          <Zap className={`w-4 h-4 ${ativo ? 'text-green-500' : 'text-gray-400'}`} />
          <span className="font-medium text-gray-800">{event.label}</span>
          {leadCount > 0 && (
            <span className="text-xs bg-surface-100 text-gray-500 px-2 py-0.5 rounded-full">{leadCount} leads</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${ativo ? 'text-green-600' : 'text-gray-400'}`}>
            {ativo ? 'Ativo' : 'Inativo'}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 pt-0 space-y-3 border-t border-surface-100">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Envio automático</label>
            <button
              type="button"
              onClick={() => setAtivo(!ativo)}
              className={`relative w-11 h-6 rounded-full transition ${ativo ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Variáveis de template</label>
            <VariableButtons textareaRef={taRef} value={mensagem} onChange={setMensagem} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mensagem automática</label>
            <textarea
              ref={taRef}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder={`Ex: Olá {nome_cliente}, notamos que você se interessou por {nome_produto}...`}
              rows={4}
              className="w-full p-3 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Use *texto* para negrito e _texto_ para itálico no WhatsApp.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={salvando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition"
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
  const [selectedProduto, setSelectedProduto] = useState('')
  const [addedProducts, setAddedProducts] = useState([])
  const [newProductName, setNewProductName] = useState('')

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

  const handleAddProduct = () => {
    const name = newProductName.trim()
    if (!name) return
    setAddedProducts((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setSelectedProduto(name)
    setNewProductName('')
    toast.success(`Produto "${name}" adicionado. Configure as mensagens abaixo.`)
  }

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
    addedProducts.forEach((p) => names.add(p))
    return [...names].filter(Boolean).sort()
  }, [leads, products, addedProducts])

  useEffect(() => {
    if (uniqueProducts.length > 0 && !uniqueProducts.includes(selectedProduto)) {
      setSelectedProduto(uniqueProducts[0])
    }
  }, [uniqueProducts])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Automações</h1>
          <p className="text-gray-500 mt-1">Mensagens automáticas por evento Kiwify, produtos e leads.</p>
        </div>
        <button onClick={reload} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-200 bg-white font-medium text-sm hover:bg-surface-50 transition">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      {/* Dashboard Stats */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> Dashboard
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Leads" value={stats.total} icon={Users} color="blue" />
          <StatCard label="Enviados" value={stats.enviados} icon={CheckCircle2} color="green" />
          <StatCard label="Erros" value={stats.erros} icon={XCircle} color="red" />
          <StatCard label="Pendentes" value={stats.pendentes} icon={Clock} color="amber" />
        </div>

        {/* Mini cards por evento */}
        {leads.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {KIWIFY_EVENTS.filter((e) => leadsCountByEvent[e.id]).map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-50 border border-surface-200 text-xs">
                <span className="font-medium text-gray-700">{e.label}</span>
                <span className="font-bold text-gray-900">{leadsCountByEvent[e.id]}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Produtos — cada produto tem suas próprias mensagens; o nome do produto é a referência */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Package className="w-4 h-4" /> Produtos
        </h2>
        <p className="text-xs text-gray-500 mb-2">
          Cada produto tem suas próprias mensagens de automação. Clique em um produto para criar ou editar as mensagens dele. O <strong>nome do produto</strong> é a referência: quando um evento chegar da Kiwify, o sistema usa o nome do produto para escolher qual automação enviar (produto 1, 2, 3…).
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {uniqueProducts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedProduto(p)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition shadow-sm ${
                selectedProduto === p
                  ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500'
                  : 'border-surface-200 bg-white text-gray-800 hover:bg-surface-50'
              }`}
            >
              {p}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              placeholder="Nome do novo produto"
              className="px-3 py-2 rounded-lg border border-surface-200 text-sm w-48 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddProduct())}
            />
            <button
              type="button"
              onClick={handleAddProduct}
              disabled={!newProductName.trim()}
              className="px-3 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Adicionar produto
            </button>
          </div>
        </div>
        {selectedProduto && (
          <p className="text-sm text-gray-600">
            Configurando mensagens para: <strong className="text-primary-600">{selectedProduto}</strong>
          </p>
        )}
      </section>

      {/* Mensagens automáticas do produto selecionado */}
      {selectedProduto && (
      <section className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-surface-200 bg-surface-50/50">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary-500" />
            Mensagens automáticas — {selectedProduto}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Crie ou edite as mensagens para cada evento. Quando um lead chegar da Kiwify com o produto &quot;{selectedProduto}&quot;, a mensagem ativa do evento será enviada automaticamente pelo WhatsApp.
          </p>
        </div>
        <div className="p-4 space-y-2">
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
      </section>
      )}

      {/* Tabela de Leads */}
      <section className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-surface-200 bg-surface-50/50">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Filter className="w-5 h-5 text-primary-500" />
            Leads recebidos
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Todos os leads recebidos dos eventos Kiwify. Filtre e reenvie mensagens com erro.
          </p>
        </div>

        {/* Filtros */}
        <div className="p-4 border-b border-surface-100 flex flex-wrap gap-3 items-end">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filtroNome}
              onChange={(e) => setFiltroNome(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              className="pl-9 pr-3 py-2 rounded-lg border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none w-56"
            />
          </div>
          <select
            value={filtroEvento}
            onChange={(e) => setFiltroEvento(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="">Todos os eventos</option>
            {KIWIFY_EVENTS.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          <select
            value={filtroProduto}
            onChange={(e) => setFiltroProduto(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="">Todos os produtos</option>
            {uniqueProducts.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
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
              className="text-xs text-primary-600 hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              {leads.length === 0
                ? 'Nenhum lead recebido ainda. Configure o webhook na Kiwify para começar a receber eventos.'
                : 'Nenhum lead corresponde aos filtros selecionados.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Evento</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((lead) => (
                  <tr key={lead.id} className="border-b border-surface-50 hover:bg-surface-50/50 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 truncate max-w-[160px]">{lead.nome || '-'}</div>
                      <div className="text-xs text-gray-400 truncate max-w-[160px]">{lead.email || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{lead.telefone || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-[120px]">{lead.produto || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {eventLabel(lead.evento)}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                    <td className="px-4 py-3">
                      {(lead.status === 'erro' || lead.status === 'pendente' || !lead.status) && (
                        <button
                          onClick={() => handleReenviar(lead)}
                          disabled={reenviandoId === lead.id}
                          className="p-1.5 rounded-lg hover:bg-primary-50 text-primary-600 disabled:opacity-50 transition"
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
          {filtered.length > 100 && (
            <p className="text-center text-xs text-gray-400 py-3">Exibindo 100 de {filtered.length} leads.</p>
          )}
        </div>
      </section>
    </div>
  )
}

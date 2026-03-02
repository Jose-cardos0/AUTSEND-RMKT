import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { parseISO } from 'date-fns'
import { auth } from '../lib/firebase'
import {
  getAbandonedCarts,
  getLeads,
  updateAbandonedCartRemarketingSent,
  updateLeadStatus,
  addRemarketingLog,
  getEvolutionConfig,
} from '../lib/firestore'
import { enviarRemarketing } from '../lib/remarketingApi'
import { enviarMensagemParaGrupos } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import toast from 'react-hot-toast'
import { KIWIFY_EVENTS } from '../lib/constants'
import {
  MessageCircle,
  Search,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Users,
  Tag,
} from 'lucide-react'

export default function Remarketing() {
  const [user] = useAuthState(auth)
  const [carts, setCarts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [mensagem, setMensagem] = useState('')
  const [filtroNome, setFiltroNome] = useState('')
  const [filtroDataInicio, setFiltroDataInicio] = useState('')
  const [filtroDataFim, setFiltroDataFim] = useState('')
  const [apenasNaoEnviados, setApenasNaoEnviados] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [grupos, setGrupos] = useState([])
  const [evolutionConfig, setEvolutionConfig] = useState(null)
  const [selectedGrupoIds, setSelectedGrupoIds] = useState(new Set())
  const [mensagemGrupos, setMensagemGrupos] = useState('')
  const [enviandoGrupos, setEnviandoGrupos] = useState(false)
  const [filtroGrupos, setFiltroGrupos] = useState('')
  const [filtroTag, setFiltroTag] = useState('')

  const gruposFiltrados = useMemo(() => {
    if (!filtroGrupos.trim()) return grupos
    const q = filtroGrupos.toLowerCase().trim()
    return grupos.filter(
      (g) =>
        (g.nome ?? g.name ?? g.subject ?? '').toLowerCase().includes(q) ||
        (g.id ?? '').toLowerCase().includes(q)
    )
  }, [grupos, filtroGrupos])

  const eventTag = (eventoId) => {
    if (!eventoId || eventoId === 'unknown' || eventoId === 'false') return 'Outro'
    return KIWIFY_EVENTS.find((e) => e.id === eventoId)?.label ?? eventoId
  }

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([
      getAbandonedCarts(user.uid),
      getLeads(user.uid),
      getEvolutionConfig(user.uid),
    ]).then(([cartsData, leadsData, evolution]) => {
      const leadKeys = new Set()
      const fromLeads = (leadsData || []).map((l) => {
        const key = l.telefone || l.email || l.id
        if (key) leadKeys.add(key)
        return {
          id: `lead_${l.id}`,
          nome: l.nome,
          name: l.nome,
          email: l.email,
          telefone: l.telefone,
          phone: l.telefone,
          numero: l.telefone,
          remarketingEnviado: l.status === 'enviado',
          createdAt: l.createdAt,
          evento: l.evento,
          tag: eventTag(l.evento),
          produto: l.produto,
          _fromLead: true,
          _leadId: l.id,
        }
      })
      const legacyCarts = (cartsData || []).filter((c) => {
        const key = c.telefone || c.phone || c.email || c.id
        return key && !leadKeys.has(key)
      }).map((c) => ({
        ...c,
        evento: 'abandoned_cart',
        tag: 'Carrinho Abandonado',
        _fromLead: false,
      }))
      const merged = [...fromLeads, ...legacyCarts].sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
        const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
        return tb - ta
      })
      setCarts(merged)
      setEvolutionConfig(evolution || null)
      const g = evolution?.grupos
      const gruposArray = Array.isArray(g) ? g : (g && typeof g === 'object' && Array.isArray(g.grupos) ? g.grupos : Array.isArray(g?.groups) ? g.groups : [])
      setGrupos(gruposArray)
      setLoading(false)
    })
  }, [user?.uid])

  const filtered = useMemo(() => {
    let list = carts
    if (filtroNome.trim()) {
      const q = filtroNome.toLowerCase()
      list = list.filter(
        (c) =>
          (c.nome || c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.telefone || c.phone || c.numero || '').toString().includes(filtroNome)
      )
    }
    if (filtroDataInicio || filtroDataFim) {
      list = list.filter((c) => {
        const raw = c.createdAt ?? c.data ?? c.created
        let date = null
        if (raw?.toDate) date = raw.toDate()
        else if (raw?.seconds) date = new Date(raw.seconds * 1000)
        else if (typeof raw === 'string') date = parseISO(raw)
        else if (raw instanceof Date) date = raw
        if (!date) return true
        if (filtroDataInicio && date < new Date(filtroDataInicio)) return false
        if (filtroDataFim && date > new Date(filtroDataFim + 'T23:59:59')) return false
        return true
      })
    }
    if (apenasNaoEnviados) list = list.filter((c) => !c.remarketingEnviado)
    if (filtroTag) list = list.filter((c) => c.tag === filtroTag)
    return list
  }, [carts, filtroNome, filtroDataInicio, filtroDataFim, apenasNaoEnviados, filtroTag])

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((c) => c.id)))
  }

  const selectedCarts = useMemo(
    () => filtered.filter((c) => selectedIds.has(c.id)),
    [filtered, selectedIds]
  )

  const handleEnviar = async () => {
    if (!user?.uid || selectedCarts.length === 0 || !mensagem.trim()) {
      toast.error('Selecione pelo menos um contato e escreva a mensagem.')
      return
    }
    setEnviando(true)
    setMsg({ type: '', text: '' })
    try {
      const evolution = await getEvolutionConfig(user.uid)
      const contatos = selectedCarts.map((c) => ({
        id: c.id,
        nome: c.nome ?? c.name,
        telefone: c.telefone ?? c.phone ?? c.numero,
        email: c.email,
        ...c,
      }))
      await enviarRemarketing(contatos, mensagem.trim(), evolution)
      for (const cart of selectedCarts) {
        if (cart._fromLead && cart._leadId) {
          await updateLeadStatus(user.uid, cart._leadId, { status: 'enviado', mensagemEnviada: mensagem.trim() })
        } else {
          await updateAbandonedCartRemarketingSent(user.uid, cart.id, mensagem.trim())
        }
      }
      await addRemarketingLog(user.uid, {
        contatos: contatos.length,
        mensagem: mensagem.trim(),
        ids: selectedCarts.map((c) => c.id),
      })
      setCarts((prev) =>
        prev.map((c) =>
          selectedIds.has(c.id) ? { ...c, remarketingEnviado: true, mensagemEnviada: mensagem.trim() } : c
        )
      )
      setSelectedIds(new Set())
      setMensagem('')
      toast.success(`Remarketing enviado para ${selectedCarts.length} contato(s).`)
    } catch (err) {
      toast.error(err.message || 'Erro ao enviar remarketing')
    } finally {
      setEnviando(false)
    }
  }

  const toggleGrupo = (id) => {
    setSelectedGrupoIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllGrupos = () => {
    const list = gruposFiltrados
    const allSelected = list.length > 0 && list.every((g) => selectedGrupoIds.has(g.id))
    if (allSelected) {
      const next = new Set(selectedGrupoIds)
      list.forEach((g) => next.delete(g.id))
      setSelectedGrupoIds(next)
    } else {
      const next = new Set(selectedGrupoIds)
      list.forEach((g) => next.add(g.id))
      setSelectedGrupoIds(next)
    }
  }

  const selectedGrupos = useMemo(
    () => grupos.filter((g) => selectedGrupoIds.has(g.id)),
    [grupos, selectedGrupoIds]
  )

  const handleEnviarParaGrupos = async () => {
    if (selectedGrupos.length === 0 || !mensagemGrupos.trim()) {
      toast.error('Selecione pelo menos um grupo e escreva a mensagem.')
      return
    }
    setEnviandoGrupos(true)
    setMsg({ type: '', text: '' })
    try {
      const evolutionAtual = await getEvolutionConfig(user.uid)
      if (!evolutionAtual?.nomeInstancia) {
        toast.error('Nenhuma instância conectada. Vá em Integrações, crie e conecte sua instância do WhatsApp.')
        return
      }
      await enviarMensagemParaGrupos(selectedGrupos, mensagemGrupos.trim(), evolutionAtual)
      toast.success(`Mensagem enviada para ${selectedGrupos.length} grupo(s).`)
      setMensagemGrupos('')
      setSelectedGrupoIds(new Set())
    } catch (err) {
      toast.error(err.message || 'Erro ao enviar para grupos')
    } finally {
      setEnviandoGrupos(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Remarketing</h1>
        <p className="text-gray-500 mt-1">Todos os leads do Kiwify (carrinho abandonado, compra aprovada, etc.). Filtre por tag e envie a mensagem.</p>
      </div>

      {msg.text && (
        <div
          className={`
            flex items-center gap-2 p-4 rounded-xl border
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-surface-200 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[120px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={filtroNome}
                  onChange={(e) => setFiltroNome(e.target.value)}
                  placeholder="Nome, e-mail ou telefone"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                />
              </div>
              <input
                type="date"
                value={filtroDataInicio}
                onChange={(e) => setFiltroDataInicio(e.target.value)}
                className="px-3 py-2 rounded-lg border border-surface-200 text-sm"
              />
              <input
                type="date"
                value={filtroDataFim}
                onChange={(e) => setFiltroDataFim(e.target.value)}
                className="px-3 py-2 rounded-lg border border-surface-200 text-sm"
              />
              <div className="flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-gray-400 shrink-0" />
                <select
                  value={filtroTag}
                  onChange={(e) => setFiltroTag(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                >
                  <option value="">Todos os eventos</option>
                  {KIWIFY_EVENTS.map((e) => (
                    <option key={e.id} value={e.label}>{e.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apenasNaoEnviados}
                  onChange={(e) => setApenasNaoEnviados(e.target.checked)}
                  className="rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                />
                Apenas não enviados
              </label>
              <button
                type="button"
                onClick={selectAll}
                className="text-sm font-medium text-primary-600 hover:underline"
              >
                {selectedIds.size === filtered.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>
            <div className="max-h-[400px] overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  Nenhum lead encontrado ou os filtros não retornaram resultados.
                </div>
              ) : (
                <ul className="divide-y divide-surface-200">
                  {filtered.map((cart, index) => (
                    <li
                      key={cart.id ? `${cart.id}-${index}` : `row-${index}`}
                      className="flex items-center gap-3 p-4 hover:bg-surface-50 cursor-pointer"
                      onClick={() => toggleSelect(cart.id)}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSelect(cart.id)
                        }}
                        className="shrink-0 text-gray-400 hover:text-primary-500"
                      >
                        {cart.remarketingEnviado ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        ) : selectedIds.has(cart.id) ? (
                          <CheckCircle2 className="w-5 h-5 text-primary-500" />
                        ) : (
                          <Circle className="w-5 h-5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">
                          {cart.nome || cart.name || cart.email || 'Sem nome'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {cart.telefone || cart.phone || cart.numero || '—'} · {cart.email || '—'}
                        </p>
                        {cart.tag && (
                          <span className="inline-flex items-center mt-1 text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                            {cart.tag}
                          </span>
                        )}
                      </div>
                      {cart.remarketingEnviado && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
                          Enviado
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-3">Mensagem de remarketing</h3>
            <MessageEditor
              value={mensagem}
              onChange={setMensagem}
              placeholder="Olá {nome}, você deixou itens no carrinho. Posso te ajudar?"
            />
            <p className="text-xs text-gray-500 mt-2">
              Use *texto* para negrito e _texto_ para itálico no WhatsApp.
            </p>
            <button
              onClick={handleEnviar}
              disabled={enviando || selectedCarts.length === 0 || !mensagem.trim()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviando ? 'Enviando...' : `Enviar para ${selectedCarts.length} contato(s)`}
            </button>
          </div>
        </div>
      </div>

      {/* Enviar para grupos do WhatsApp */}
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-surface-200 bg-surface-50/50 flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">Enviar para grupos do WhatsApp</h2>
        </div>
        <div className="p-6 space-y-4">
          {grupos.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum grupo salvo. Vá em Integrações, conecte o WhatsApp e clique em Puxar grupos.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={filtroGrupos}
                    onChange={(e) => setFiltroGrupos(e.target.value)}
                    placeholder="Filtrar por nome ou ID do grupo"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-600">
                    {gruposFiltrados.length} de {grupos.length} grupo(s)
                  </p>
                  <button
                    type="button"
                    onClick={selectAllGrupos}
                    className="text-sm font-medium text-primary-600 hover:underline"
                  >
                    {gruposFiltrados.length > 0 && gruposFiltrados.every((g) => selectedGrupoIds.has(g.id))
                      ? 'Desmarcar todos'
                      : 'Selecionar todos'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-64 overflow-auto">
                {gruposFiltrados.map((g, index) => (
                  <button
                    key={g.id ? `${g.id}-${index}` : `grupo-${index}`}
                    type="button"
                    onClick={() => toggleGrupo(g.id)}
                    className={`
                      p-3 rounded-xl border text-left transition text-sm
                      ${selectedGrupoIds.has(g.id)
                        ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                        : 'border-surface-200 bg-white hover:bg-surface-50'}
                    `}
                  >
                    <div className="flex items-start gap-2">
                      {selectedGrupoIds.has(g.id) ? (
                        <CheckCircle2 className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-800 truncate">{g.nome ?? g.name ?? g.subject ?? 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{g.id}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem para os grupos</label>
                <MessageEditor
                  value={mensagemGrupos}
                  onChange={setMensagemGrupos}
                  placeholder="Digite a mensagem que será enviada para os grupos selecionados..."
                />
              </div>
              <button
                onClick={handleEnviarParaGrupos}
                disabled={enviandoGrupos || selectedGrupos.length === 0 || !mensagemGrupos.trim() || !evolutionConfig?.nomeInstancia}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
              >
                {enviandoGrupos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {enviandoGrupos ? 'Enviando...' : `Enviar para ${selectedGrupos.length} grupo(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

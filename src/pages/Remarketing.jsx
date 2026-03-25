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
  Tag,
  ChevronLeft,
  ChevronRight,
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
  const [filtroTag, setFiltroTag] = useState('')
  const [paginaContatos, setPaginaContatos] = useState(1)

  const CONTATOS_POR_PAGINA = 10

  const eventTag = (eventoId) => {
    if (!eventoId || eventoId === 'unknown' || eventoId === 'false') return 'Outro'
    return KIWIFY_EVENTS.find((e) => e.id === eventoId)?.label ?? eventoId
  }

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([
      getAbandonedCarts(user.uid),
      getLeads(user.uid),
    ]).then(([cartsData, leadsData]) => {
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

  useEffect(() => {
    setPaginaContatos(1)
  }, [filtroNome, filtroDataInicio, filtroDataFim, apenasNaoEnviados, filtroTag])

  const totalPaginasContatos = Math.max(1, Math.ceil(filtered.length / CONTATOS_POR_PAGINA))
  const paginaContatosAtual = Math.min(paginaContatos, totalPaginasContatos)
  const filteredPagina = useMemo(
    () => filtered.slice((paginaContatosAtual - 1) * CONTATOS_POR_PAGINA, paginaContatosAtual * CONTATOS_POR_PAGINA),
    [filtered, paginaContatosAtual]
  )

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
    const TIMEOUT_MS = 20000
    const idsToMark = new Set(selectedIds)
    const msgTrim = mensagem.trim()
    let timeoutId = setTimeout(() => {
      setEnviando(false)
      setCarts((prev) =>
        prev.map((c) => (idsToMark.has(c.id) ? { ...c, remarketingEnviado: true, mensagemEnviada: msgTrim } : c))
      )
      setSelectedIds(new Set())
      setMensagem('')
      toast.success(`Enviado para ${idsToMark.size} contato(s). Você pode continuar usando a página.`)
    }, TIMEOUT_MS)
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
      clearTimeout(timeoutId)
      timeoutId = null
      // Atualiza a UI primeiro para a tag "Enviado" aparecer na hora
      setCarts((prev) =>
        prev.map((c) =>
          selectedIds.has(c.id) ? { ...c, remarketingEnviado: true, mensagemEnviada: mensagem.trim() } : c
        )
      )
      setSelectedIds(new Set())
      setMensagem('')
      toast.success(`Remarketing enviado para ${selectedCarts.length} contato(s).`)
      // Persiste no Firestore em seguida (se falhar, a tag já apareceu na tela)
      for (const cart of selectedCarts) {
        try {
          if (cart._fromLead && cart._leadId) {
            await updateLeadStatus(user.uid, cart._leadId, { status: 'enviado', mensagemEnviada: mensagem.trim() })
          } else {
            await updateAbandonedCartRemarketingSent(user.uid, cart.id, mensagem.trim())
          }
        } catch (e) {
          console.warn('Erro ao atualizar status do lead no Firestore:', e)
        }
      }
      try {
        await addRemarketingLog(user.uid, {
          contatos: contatos.length,
          mensagem: mensagem.trim(),
          ids: selectedCarts.map((c) => c.id),
        })
      } catch (e) {
        console.warn('Erro ao salvar log de remarketing:', e)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      toast.error(err.message || 'Erro ao enviar remarketing')
    } finally {
      setEnviando(false)
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
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Remarketing</h1>
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

      {/* Mensagem de remarketing — em cima */}
      <div className="bg-white rounded-2xl border border-surface-200 shadow-card p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-stone-800 mb-3">Mensagem de remarketing</h3>
        <MessageEditor
          value={mensagem}
          onChange={setMensagem}
          placeholder="Olá {nome}, você deixou itens no carrinho. Posso te ajudar?"
          showNomeButton
        />
        <p className="text-xs text-stone-500 mt-2">
          Use *texto* para negrito e _texto_ para itálico no WhatsApp.
        </p>
        <button
          onClick={handleEnviar}
          disabled={enviando || selectedCarts.length === 0 || !mensagem.trim()}
          className="btn-primary mt-4 w-full py-3 min-h-[48px] touch-manipulation"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {enviando ? 'Enviando...' : `Enviar para ${selectedCarts.length} contato(s)`}
        </button>
      </div>

      {/* Lista de contatos — abaixo da mensagem, 10 por página */}
      <div className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-surface-200 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
          <div className="relative w-full sm:flex-1 sm:min-w-[140px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={filtroNome}
              onChange={(e) => setFiltroNome(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              className="w-full pl-10 pr-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
            />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
            <input
              type="date"
              value={filtroDataInicio}
              onChange={(e) => setFiltroDataInicio(e.target.value)}
              className="px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
            />
            <input
              type="date"
              value={filtroDataFim}
              onChange={(e) => setFiltroDataFim(e.target.value)}
              className="px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Tag className="w-4 h-4 text-stone-400 shrink-0" />
              <select
                value={filtroTag}
                onChange={(e) => setFiltroTag(e.target.value)}
                className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">Todos os eventos</option>
                {KIWIFY_EVENTS.map((e) => (
                  <option key={e.id} value={e.label}>{e.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer min-h-[44px] py-1">
              <input
                type="checkbox"
                checked={apenasNaoEnviados}
                onChange={(e) => setApenasNaoEnviados(e.target.checked)}
                className="rounded border-surface-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
              />
              Apenas não enviados
            </label>
            <button
              type="button"
              onClick={selectAll}
              className="text-sm font-medium text-primary-600 hover:underline py-2 touch-manipulation"
            >
              {selectedIds.size === filtered.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          </div>
        </div>
        <div className="min-h-[200px]">
          {filtered.length === 0 ? (
            <div className="p-6 sm:p-8 text-center text-stone-500 text-sm">
              Nenhum lead encontrado ou os filtros não retornaram resultados.
            </div>
          ) : (
            <ul className="divide-y divide-surface-200">
              {filteredPagina.map((cart, index) => (
                <li
                  key={cart.id ? `${cart.id}-${index}` : `row-${index}`}
                  className="flex items-center gap-3 p-3 sm:p-4 min-h-[56px] hover:bg-surface-50 active:bg-surface-100 cursor-pointer touch-manipulation"
                  onClick={() => toggleSelect(cart.id)}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSelect(cart.id)
                    }}
                    className="shrink-0 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center -m-1 rounded-lg text-stone-400 hover:text-primary-500 active:bg-primary-50"
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
                    <p className="font-medium text-stone-800 truncate">
                      {cart.nome || cart.name || cart.email || 'Sem nome'}
                    </p>
                    <p className="text-sm text-stone-500 truncate">
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
        {filtered.length > CONTATOS_POR_PAGINA && (
          <div className="px-4 py-3 sm:py-4 border-t border-surface-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
            <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">
              Página {paginaContatosAtual} de {totalPaginasContatos} · {filtered.length} contato(s)
            </p>
            <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
              <button
                type="button"
                onClick={() => setPaginaContatos((p) => Math.max(1, p - 1))}
                disabled={paginaContatosAtual <= 1}
                className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
              >
                <ChevronLeft className="w-4 h-4" />
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPaginaContatos((p) => Math.min(totalPaginasContatos, p + 1))}
                disabled={paginaContatosAtual >= totalPaginasContatos}
                className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
              >
                Próxima
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

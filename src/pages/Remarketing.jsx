import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
  getDisparos,
  iniciarRemarketingWA,
  deleteDisparo,
  getDisparoFalhas,
} from '../lib/firestore'
import MessageEditor from '../components/MessageEditor'
import useMidiaWhatsApp from '../hooks/useMidiaWhatsApp'
import TemplatePicker from '../components/TemplatePicker'
import Select from '../components/Select'
import toast from 'react-hot-toast'
import { KIWIFY_EVENTS } from '../lib/constants'
import {
  MessageCircle,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Tag,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Filter,
  CheckSquare,
  History,
  Trash2,
  Image as ImageLucide,
  AudioLines,
} from 'lucide-react'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import StatCard from '../components/StatCard'
import CollapsibleSearch from '../components/CollapsibleSearch'
import AudioPlayer from '../components/AudioPlayer'
import WhatsAppIcon from '../components/WhatsAppIcon'
import { useConfirm } from '../components/ConfirmDialog'

const HIST_STATUS = { enviando: 'bg-blue-100 text-blue-700', concluido: 'bg-green-100 text-green-700', finalizado: 'bg-green-100 text-green-700', cancelado: 'bg-red-100 text-red-700', erro: 'bg-red-100 text-red-700' }
const HIST_STATUS_LABEL = { enviando: 'Enviando', concluido: 'Concluído', finalizado: 'Finalizado', cancelado: 'Cancelado', erro: 'Erro' }
const ITEMS_HIST = 5
const fmtDataHist = (ts) => {
  if (!ts) return '-'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
/** Traduz o motivo técnico da falha pra algo que qualquer pessoa entende. */
const erroAmigavel = (motivo, detalhe) => {
  const m = (String(motivo || '') + ' ' + String(detalhe || '')).toLowerCase()
  if (/whats|exist|inval|not.?found|nao.?exist|numero|number|no.?wa|sem.?whats/.test(m)) return 'Número inválido ou sem WhatsApp'
  if (/block|spam|ban|recus/.test(m)) return 'Número bloqueou ou recusou o envio'
  if (/timeout|time.?out|indispon|offline/.test(m)) return 'WhatsApp indisponível no momento'
  return 'Não foi possível entregar (número inválido)'
}

export default function Remarketing() {
  const [user] = useAuthState(auth)
  const [carts, setCarts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [mensagem, setMensagem] = useState('')
  const editorRef = useRef(null)
  const midia = useMidiaWhatsApp(user?.uid)
  const confirm = useConfirm()
  const [progresso, setProgresso] = useState(null) // { disparoId, total, enviados, falhas, status }
  const [historico, setHistorico] = useState([])
  const [histOpen, setHistOpen] = useState(false)
  const [expandedHist, setExpandedHist] = useState(null)
  const [histPagina, setHistPagina] = useState(1)
  const [falhasPorDisparo, setFalhasPorDisparo] = useState({}) // disparoId -> [{telefone, motivo, ...}]

  const toggleHistExpand = async (item) => {
    if (expandedHist === item.disparoId) { setExpandedHist(null); return }
    setExpandedHist(item.disparoId)
    if ((item.falhas || 0) > 0 && !falhasPorDisparo[item.disparoId]) {
      try {
        const fs = await getDisparoFalhas(user.uid, item.disparoId)
        setFalhasPorDisparo((p) => ({ ...p, [item.disparoId]: fs }))
      } catch (_) { setFalhasPorDisparo((p) => ({ ...p, [item.disparoId]: [] })) }
    }
  }

  const carregarHistorico = useCallback(async () => {
    if (!user?.uid) return
    try {
      const list = await getDisparos(user.uid)
      setHistorico(list.filter((d) => d.origem === 'remarketing'))
    } catch (_) {}
  }, [user?.uid])
  useEffect(() => { carregarHistorico() }, [carregarHistorico])

  // Enquanto houver envio em andamento, atualiza o progresso (X/total) + o histórico a cada 15s.
  useEffect(() => {
    if (!user?.uid || !progresso || progresso.status !== 'enviando') return
    const id = setInterval(async () => {
      try {
        const list = await getDisparos(user.uid)
        setHistorico(list.filter((d) => d.origem === 'remarketing'))
        const d = list.find((x) => x.disparoId === progresso.disparoId)
        if (d) setProgresso({ disparoId: d.disparoId, total: d.total, enviados: d.enviados ?? 0, falhas: d.falhas ?? 0, status: d.status || 'enviando' })
      } catch (_) {}
    }, 15000)
    return () => clearInterval(id)
  }, [user?.uid, progresso?.disparoId, progresso?.status])

  const totalPagHist = Math.max(1, Math.ceil(historico.length / ITEMS_HIST))
  const pagHist = Math.min(histPagina, totalPagHist)
  const historicoPagina = historico.slice((pagHist - 1) * ITEMS_HIST, pagHist * ITEMS_HIST)
  const excluirHist = async (disparoId, nome) => {
    if (!(await confirm({ title: 'Excluir do histórico?', message: `Remover "${nome}" do histórico de remarketing?`, confirmLabel: 'Excluir', danger: true }))) return
    try {
      await deleteDisparo(user.uid, disparoId)
      setHistorico((prev) => prev.filter((i) => i.disparoId !== disparoId))
      toast.success('Removido do histórico.')
    } catch (e) { toast.error(e.message || 'Erro ao excluir.') }
  }
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

  const resumo = useMemo(() => {
    const total = carts.length
    const enviados = carts.filter((c) => c.remarketingEnviado).length
    return { total, enviados, pendentes: Math.max(0, total - enviados) }
  }, [carts])

  const handleEnviar = async () => {
    if (!user?.uid || selectedCarts.length === 0 || !mensagem.trim()) {
      toast.error('Selecione pelo menos um contato e escreva a mensagem.')
      return
    }
    setEnviando(true)
    setMsg({ type: '', text: '' })
    const idsToMark = new Set(selectedIds)
    const msgTrim = mensagem.trim()
    const cartsEnviados = selectedCarts
    try {
      const evolution = await getEvolutionConfig(user.uid)
      const sessao = evolution?.nomeInstancia || ''
      if (!sessao) { toast.error('Conecte uma instância de WhatsApp antes de enviar.'); setEnviando(false); return }
      const contatos = cartsEnviados.map((c) => ({
        nome: c.nome ?? c.name ?? '',
        telefone: c.telefone ?? c.phone ?? c.numero ?? '',
        produto: c.produto ?? c.nome_produto ?? '',
        email: c.email ?? '',
      }))
      // Envio em lotes de 50 pelo backend (mesma máquina do disparador, via WF1).
      const r = await iniciarRemarketingWA({ sessao, mensagem: msgTrim, imagemUrl: midia.img?.src || null, audioUrl: midia.audio?.url || null, contatos })

      // Marca como enviado (fila iniciada) e mostra progresso.
      setCarts((prev) => prev.map((c) => (idsToMark.has(c.id) ? { ...c, remarketingEnviado: true, mensagemEnviada: msgTrim } : c)))
      setSelectedIds(new Set())
      setMensagem('')
      midia.clear()
      setProgresso({ disparoId: r.disparoId, total: r.total, enviados: 0, falhas: 0, status: 'enviando' })
      carregarHistorico()
      toast.success(`Remarketing iniciado: ${r.total} contato(s).`)

      // Persiste status dos leads/carts + log (em segundo plano; a tag já apareceu).
      for (const cart of cartsEnviados) {
        try {
          if (cart._fromLead && cart._leadId) await updateLeadStatus(user.uid, cart._leadId, { status: 'enviado', mensagemEnviada: msgTrim })
          else await updateAbandonedCartRemarketingSent(user.uid, cart.id, msgTrim)
        } catch (e) { console.warn('status lead:', e) }
      }
      try { await addRemarketingLog(user.uid, { contatos: contatos.length, mensagem: msgTrim, ids: cartsEnviados.map((c) => c.id) }) } catch (e) { console.warn('log remarketing:', e) }
    } catch (err) {
      const code = err?.message || ''
      if (code.includes('instancia_ocupada')) toast.error('Essa instância já tem um envio em andamento. Espere terminar pra iniciar outro.')
      else toast.error(err.message || 'Erro ao enviar remarketing')
    } finally {
      setEnviando(false)
    }
  }

  if (loading) {
    return <PageLoader className="flex-1 min-h-0 py-10" />
  }

  return (
    <PageShell
      badge="WhatsApp · Remarketing"
      title="Remarketing"
      right={
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[280px] sm:max-w-none sm:w-auto">
          <StatCard label="Total" value={resumo.total} icon={Users} color="blue" />
          <StatCard label="Enviados" value={resumo.enviados} icon={CheckCircle2} color="green" />
          <StatCard label="Selecionados" value={selectedCarts.length} icon={CheckSquare} color="purple" />
        </div>
      }
    >
      {msg.text && (
        <div
          className={`
            shrink-0 flex items-center gap-2 p-3 rounded-xl border text-sm
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="line-clamp-2">{msg.text}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2 min-w-0 lg:h-[calc(100dvh-20rem)] lg:min-h-[360px]">
        <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg h-[min(42dvh,320px)] lg:h-auto lg:min-h-0 overflow-hidden">
          <div className="relative flex flex-col flex-1 min-h-0">
            <MessageEditor
              ref={editorRef}
              fillHeight
              className="flex-1 min-h-0"
              textareaClassName="pb-16"
              value={mensagem}
              onChange={setMensagem}
              placeholder="Olá {nome_cliente}, você deixou itens no carrinho. Posso te ajudar?"
              showChaves
              showCheckout
              checkoutIconOnly
              rows={4}
              toolbarBeforeEmoji={<TemplatePicker onPick={setMensagem} iconOnly label="Template" />}
              toolbarExtra={midia.toolbarExtra}
            />

            {/* Prévia dos anexos: flutuante no canto inferior esquerdo */}
            {midia.previews && <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2 max-w-[70%]">{midia.previews}</div>}

            {/* Botão enviar: ícone flutuante no canto inferior direito (igual ao Disparo) */}
            <button
              onClick={handleEnviar}
              disabled={enviando || selectedCarts.length === 0 || !mensagem.trim()}
              title={enviando ? 'Enviando…' : `Enviar para ${selectedCarts.length} contato(s)`}
              className={`absolute bottom-3 right-3 z-20 h-11 w-11 flex items-center justify-center rounded-xl shadow-sm transition-colors ${
                enviando
                  ? 'bg-primary-50 text-primary-600'
                  : 'bg-surface-100 text-stone-500 hover:bg-primary-600 hover:text-white disabled:opacity-40 disabled:hover:bg-surface-100 disabled:hover:text-stone-500'
              }`}
            >
              {enviando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>

        </aside>

        <div className="app-panel rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col flex-1 min-h-0 min-w-0">
        <div className="px-3 sm:px-4 py-1.5 min-h-[56px] flex items-center border-b border-surface-200 shrink-0">
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="flex items-center gap-2 text-stone-700 shrink-0">
              <Users className="w-4 h-4" />
              <p className="text-sm font-semibold">Lista de contatos</p>
            </div>
            <div className="flex items-center gap-2 ml-auto min-w-0 justify-end">
              <CollapsibleSearch value={filtroNome} onChange={setFiltroNome} placeholder="Nome, e-mail ou telefone" />
              <Select
                value={filtroTag}
                onChange={setFiltroTag}
                compact
                title="Filtrar por evento"
                className="w-28 sm:w-32 shrink-0"
                options={[{ value: '', label: 'Eventos' }, ...KIWIFY_EVENTS.map((e) => ({ value: e.label, label: e.label }))]}
              />
              <Select
                searchable={false}
                title="Filtros e seleção"
                value={apenasNaoEnviados ? 'naoenviados' : ''}
                onChange={(v) => {
                  if (v === 'todos') selectAll()
                  else if (v === 'naoenviados') setApenasNaoEnviados((x) => !x)
                }}
                options={[
                  { value: 'todos', label: selectedIds.size === filtered.length && filtered.length > 0 ? 'Desmarcar todos' : 'Selecionar todos' },
                  { value: 'naoenviados', label: apenasNaoEnviados ? 'Mostrar todos os contatos' : 'Apenas não enviados' },
                ]}
                trigger={
                  <button type="button" title="Filtros e seleção" className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:border-primary-300 text-sm text-stone-600 shrink-0 transition-colors">
                    <Filter className="w-4 h-4" />
                    <span className="hidden sm:inline">Filtros</span>
                  </button>
                }
              />
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft">
          {filtered.length === 0 ? (
            <div className="p-6 sm:p-8 text-center text-stone-500 text-sm">
              Nenhum lead encontrado ou os filtros não retornaram resultados.
            </div>
          ) : (
            <ul className="divide-y divide-surface-200">
              {filteredPagina.map((cart, index) => {
                const isSelected = selectedIds.has(cart.id)
                return (
                <li
                  key={cart.id ? `${cart.id}-${index}` : `row-${index}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleSelect(cart.id)
                    }
                  }}
                  className={`
                    flex px-2 sm:px-4 py-3 sm:py-3.5 min-h-[56px] cursor-pointer touch-manipulation
                    transition-colors duration-150
                    ${isSelected
                      ? 'bg-primary-50/95 ring-1 ring-inset ring-primary-300/70 shadow-sm'
                      : 'hover:bg-surface-50/90 active:bg-surface-100/90'
                    }
                  `}
                  onClick={() => toggleSelect(cart.id)}
                >
                  <div className="flex items-start sm:items-center gap-3 w-full min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSelect(cart.id)
                      }}
                      className={`
                        shrink-0 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center -m-1 rounded-lg touch-manipulation
                        ${isSelected ? 'text-primary-600 bg-primary-100/60' : 'text-stone-400 hover:text-primary-500 hover:bg-primary-50/50'}
                      `}
                      aria-pressed={isSelected}
                      aria-label={isSelected ? 'Desmarcar contato' : 'Selecionar contato'}
                    >
                      {cart.remarketingEnviado ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : isSelected ? (
                        <CheckCircle2 className="w-5 h-5 text-primary-600" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-x-4 md:gap-y-1 flex-1 min-w-0 items-start md:items-center w-full">
                      <div className="md:col-span-5 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="font-semibold text-stone-800 truncate">
                            {cart.nome || cart.name || cart.email || 'Sem nome'}
                          </p>
                          {cart.remarketingEnviado && (
                            <span className="text-[11px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
                              Enviado
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="md:col-span-3 text-sm text-stone-600 tabular-nums md:text-right md:justify-self-end truncate">
                        {(cart.telefone || cart.phone || cart.numero || '—').toString()}
                      </p>
                      <div className="md:col-span-4 flex md:justify-end min-w-0">
                        {cart.tag ? (
                          <span className="inline-flex items-center max-w-full text-xs font-medium bg-primary-100/80 text-primary-800 px-2.5 py-1 rounded-full truncate">
                            {cart.tag}
                          </span>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
                )
              })}
            </ul>
          )}
        </div>
        {filtered.length > CONTATOS_POR_PAGINA && (
          <div className="shrink-0 px-3 py-2.5 border-t border-surface-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2">
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

      {historico.length > 0 && (
        <Panel title="Histórico" icon={History} noPadding collapsible open={histOpen} onToggle={() => setHistOpen((v) => !v)} className="shrink-0 mt-4">
          <div className="divide-y divide-surface-100">
            {historicoPagina.map((item) => {
              const aberto = expandedHist === item.disparoId
              const enviados = item.enviados ?? 0
              const falhas = item.falhas ?? 0
              const status = item.status || 'enviando'
              return (
                <div key={item.disparoId}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-4">
                    <button onClick={() => toggleHistExpand(item)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">{item.nomeDisparo}</p>
                        <p className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap">
                          <span>{fmtDataHist(item.createdAt)}</span>
                          {item.sessao && (
                            <span className="inline-flex items-center gap-1 text-stone-600 max-w-[160px]">
                              <span className="text-stone-300">·</span>
                              <WhatsAppIcon className="w-3 h-3 text-green-600 shrink-0" />
                              <span className="truncate">{item.sessao}</span>
                            </span>
                          )}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      {item.imagemUrl && <ImageLucide className="w-3.5 h-3.5 text-stone-400 shrink-0" />}
                      {item.audioUrl && <AudioLines className="w-3.5 h-3.5 text-stone-400 shrink-0" />}
                      <span className="text-xs text-stone-600">{enviados}/<span className={falhas > 0 ? 'text-red-500 font-semibold' : ''}>{item.total}</span> enviados</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${HIST_STATUS[status] || 'bg-stone-100 text-stone-600'}`}>{HIST_STATUS_LABEL[status] || status}</span>
                      <button onClick={() => excluirHist(item.disparoId, item.nomeDisparo)} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="px-4 pb-4 space-y-3">
                      <div className="text-xs text-stone-500 p-3 bg-surface-50 rounded-xl space-y-1">
                        <p className="text-stone-700 font-medium">Mensagem enviada:</p>
                        <p className="whitespace-pre-wrap break-words">{item.mensagem || '—'}</p>
                      </div>
                      {falhas > 0 && (
                        <div className="text-xs p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 space-y-1.5">
                          <p className="font-medium">{falhas} não {falhas > 1 ? 'foram entregues' : 'foi entregue'}:</p>
                          {!falhasPorDisparo[item.disparoId] ? (
                            <p className="text-red-400">Carregando…</p>
                          ) : falhasPorDisparo[item.disparoId].length === 0 ? (
                            <p className="text-red-500">Não foi possível entregar (número inválido).</p>
                          ) : (
                            falhasPorDisparo[item.disparoId].slice(0, 30).map((f, i) => (
                              <p key={i} className="flex items-center gap-2 flex-wrap">
                                <span className="tabular-nums text-red-600/90 font-medium">{f.telefone || '—'}</span>
                                <span className="text-red-300">·</span>
                                <span>{erroAmigavel(f.motivo, f.detalhe)}</span>
                              </p>
                            ))
                          )}
                        </div>
                      )}
                      {(item.imagemUrl || item.audioUrl) && (
                        <div className="flex flex-wrap items-center gap-3">
                          {item.imagemUrl && <img src={item.imagemUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-surface-200" />}
                          {item.audioUrl && <AudioPlayer src={item.audioUrl} className="w-[320px] max-w-full" />}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {totalPagHist > 1 && (
            <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-600">Página {pagHist} de {totalPagHist} · {historico.length} envio(s)</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setHistPagina((p) => Math.max(1, p - 1))} disabled={pagHist <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setHistPagina((p) => Math.min(totalPagHist, p + 1))} disabled={pagHist >= totalPagHist} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Panel>
      )}
      {midia.popups}
    </PageShell>
  )
}

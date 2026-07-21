import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import { getLeads, updateLeadStatus } from '../../lib/firestore'
import MessageEditor from '../../components/MessageEditor'
import MelhorarPlano from '../../components/MelhorarPlano'
import Select from '../../components/Select'
import toast from 'react-hot-toast'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../../lib/constants'
import { usePlano } from '../../lib/PlanoContext'
import { Send, CheckCircle2, Circle, Loader2, AlertCircle, ChevronLeft, ChevronRight, Users, Filter, CheckSquare } from 'lucide-react'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import StatCard from '../../components/StatCard'
import CollapsibleSearch from '../../components/CollapsibleSearch'

/** Normaliza pra E.164 (espelho do backend). Rejeita BR (+55) salvo permitirBR (conta própria/API). */
function normalizarE164Internacional(raw, permitirBR) {
  let s = String(raw || '').trim()
  const temMais = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false }
  if (!temMais && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return { ok: false, br: true }
  if (d.length < 8 || d.length > 15) return { ok: false }
  return { ok: true, e164: '+' + d }
}

export default function SmsRemarketing() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = ['api', 'brl'].includes(canalParam) ? canalParam : 'eua'
  const { temFeature, limiteDe } = usePlano()
  const podeSms = temFeature('smsDisparos') && (canal === 'api' || canal === 'brl' || limiteDe('smsMes') > 0)

  const [carts, setCarts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [mensagem, setMensagem] = useState('')
  const editorRef = useRef(null)
  const [filtroNome, setFiltroNome] = useState('')
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
    setLoading(true)
    getLeads(user.uid).then((leadsData) => {
      // EUA: só internacional (sem BR). API (conta própria): qualquer país.
      const list = (leadsData || []).map((l) => {
        const norm = normalizarE164Internacional(l.telefone, canal === 'api' || canal === 'brl')
        if (!norm.ok) return null
        // Canal BR só mostra +55; EUA já exclui BR (permitirBR false acima).
        if (canal === 'brl' && !String(norm.e164).replace(/\D/g, '').startsWith('55')) return null
        return {
          id: `lead_${l.id}`,
          nome: l.nome,
          email: l.email,
          telefone: norm.e164,
          // "Já enviei" é por canal (legado global = eua, pra não perder o histórico antigo).
          remarketingEnviado: l[`smsRemarketingEnviado_${canal}`] === true || (canal === 'eua' && l.smsRemarketingEnviado === true),
          createdAt: l.createdAt,
          evento: l.evento,
          tag: eventTag(l.evento),
          produto: l.produto,
          _leadId: l.id,
        }
      }).filter(Boolean).sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
        const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
        return tb - ta
      })
      setCarts(list)
      setLoading(false)
    })
  }, [user?.uid, canal])

  const filtered = useMemo(() => {
    let list = carts
    if (filtroNome.trim()) {
      const q = filtroNome.toLowerCase()
      list = list.filter((c) => (c.nome || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.telefone || '').includes(filtroNome))
    }
    if (apenasNaoEnviados) list = list.filter((c) => !c.remarketingEnviado)
    if (filtroTag) list = list.filter((c) => c.tag === filtroTag)
    return list
  }, [carts, filtroNome, apenasNaoEnviados, filtroTag])

  useEffect(() => { setPaginaContatos(1) }, [filtroNome, apenasNaoEnviados, filtroTag])

  const totalPaginasContatos = Math.max(1, Math.ceil(filtered.length / CONTATOS_POR_PAGINA))
  const paginaContatosAtual = Math.min(paginaContatos, totalPaginasContatos)
  const filteredPagina = useMemo(
    () => filtered.slice((paginaContatosAtual - 1) * CONTATOS_POR_PAGINA, paginaContatosAtual * CONTATOS_POR_PAGINA),
    [filtered, paginaContatosAtual]
  )

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((c) => c.id)))
  }
  const selectedCarts = useMemo(() => filtered.filter((c) => selectedIds.has(c.id)), [filtered, selectedIds])

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
    const selecionados = [...selectedCarts]
    try {
      const sendBulk = httpsCallable(functions, 'sendBulkSMS')
      await sendBulk({
        mensagem: mensagem.trim(),
        nomeDisparo: `Remarketing SMS ${new Date().toLocaleDateString('pt-BR')}`,
        recipients: selecionados.map((c) => ({ telefone: c.telefone, nome: c.nome })),
        loteSize: 50,
        intervaloMin: 5,
        canal,
      })
      // Marca como enviado na UI e persiste a flag por lead
      const ids = new Set(selecionados.map((c) => c.id))
      setCarts((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, remarketingEnviado: true } : c)))
      setSelectedIds(new Set())
      setMensagem('')
      toast.success(`Remarketing SMS enviado para ${selecionados.length} contato(s).`)
      for (const c of selecionados) {
        try { await updateLeadStatus(user.uid, c._leadId, { [`smsRemarketingEnviado_${canal}`]: true }) }
        catch (e) { console.warn('Erro ao marcar lead:', e) }
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao enviar remarketing')
    } finally {
      setEnviando(false)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      fill
      badge={`SMS · Remarketing · ${canal === 'api' ? "API's" : canal === 'brl' ? 'Brasil' : 'EUA'}`}
      right={
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[280px] sm:max-w-none sm:w-auto">
          <StatCard label="Total" value={resumo.total} icon={Users} color="blue" />
          <StatCard label="Enviados" value={resumo.enviados} icon={CheckCircle2} color="green" />
          <StatCard label="Selecionados" value={selectedCarts.length} icon={CheckSquare} color="purple" />
        </div>
      }
    >
      {!podeSms && (
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1">Seu plano não inclui SMS. Faça upgrade para disparar SMS.</span>
          <MelhorarPlano label="Ver planos" className="shrink-0" />
        </div>
      )}
      {msg.text && (
        <div className={`shrink-0 flex items-center gap-2 p-3 rounded-xl border text-sm ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''} ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}`}>
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="line-clamp-2">{msg.text}</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-2 overflow-hidden min-w-0">
        <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg h-[min(42dvh,320px)] lg:h-auto lg:min-h-0 overflow-hidden">
          <div className="relative flex flex-col flex-1 min-h-0">
            <MessageEditor
              ref={editorRef}
              fillHeight
              className="flex-1 min-h-0"
              textareaClassName="pb-16"
              value={mensagem}
              onChange={setMensagem}
              placeholder={'Autsend: hey {nome}, still interested in {nome_produto}? Reply STOP to opt out.'}
              rows={4}
              showChaves
              chavesVars={TEMPLATE_VARIABLES.filter((v) => v.key === '{nome_cliente}' || v.key === '{nome_produto}')}
            />

            {/* Botão enviar: ícone flutuante no canto inferior direito */}
            <button
              onClick={handleEnviar}
              disabled={enviando || !podeSms || selectedCarts.length === 0 || !mensagem.trim()}
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
          <p className="text-[11px] text-stone-400 shrink-0 mt-2">{canal === 'brl' ? 'Só números do Brasil (+55). Acentos removidos automaticamente.' : canal === 'api' ? 'Qualquer país. Acentos removidos automaticamente.' : 'Só números internacionais (sem Brasil). Acentos removidos automaticamente.'}</p>
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
                Nenhum lead internacional encontrado. O SMS só atende números fora do Brasil.
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
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(cart.id) } }}
                      className={`flex px-2 sm:px-4 py-3 sm:py-3.5 min-h-[56px] cursor-pointer touch-manipulation transition-colors duration-150 ${isSelected ? 'bg-primary-50/95 ring-1 ring-inset ring-primary-300/70 shadow-sm' : 'hover:bg-surface-50/90 active:bg-surface-100/90'}`}
                      onClick={() => toggleSelect(cart.id)}
                    >
                      <div className="flex items-start sm:items-center gap-3 w-full min-w-0">
                        <button type="button" onClick={(e) => { e.stopPropagation(); toggleSelect(cart.id) }} className={`shrink-0 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center -m-1 rounded-lg touch-manipulation ${isSelected ? 'text-primary-600 bg-primary-100/60' : 'text-stone-400 hover:text-primary-500 hover:bg-primary-50/50'}`} aria-pressed={isSelected} aria-label={isSelected ? 'Desmarcar contato' : 'Selecionar contato'}>
                          {cart.remarketingEnviado ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : isSelected ? <CheckCircle2 className="w-5 h-5 text-primary-600" /> : <Circle className="w-5 h-5" />}
                        </button>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-x-4 md:gap-y-1 flex-1 min-w-0 items-start md:items-center w-full">
                          <div className="md:col-span-5 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="font-semibold text-stone-800 truncate">{cart.nome || cart.email || 'Sem nome'}</p>
                              {cart.remarketingEnviado && <span className="text-[11px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">Enviado</span>}
                            </div>
                          </div>
                          <p className="md:col-span-3 text-sm text-stone-600 tabular-nums md:text-right md:justify-self-end truncate">{cart.telefone || '—'}</p>
                          <div className="md:col-span-4 flex md:justify-end min-w-0">
                            {cart.tag ? <span className="inline-flex items-center max-w-full text-xs font-medium bg-primary-100/80 text-primary-800 px-2.5 py-1 rounded-full truncate">{cart.tag}</span> : <span className="text-xs text-stone-400">—</span>}
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
              <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">Página {paginaContatosAtual} de {totalPaginasContatos} · {filtered.length} contato(s)</p>
              <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
                <button type="button" onClick={() => setPaginaContatos((p) => Math.max(1, p - 1))} disabled={paginaContatosAtual <= 1} className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial">
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <button type="button" onClick={() => setPaginaContatos((p) => Math.min(totalPaginasContatos, p + 1))} disabled={paginaContatosAtual >= totalPaginasContatos} className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial">
                  Próxima <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}

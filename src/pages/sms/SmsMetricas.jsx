import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../../lib/firebase'
import { getLeads, getProductGroups, getSmsLogs, getSmsMensagens, getFunnelSends, getSmsDisparos } from '../../lib/firestore'
import { canonicalEvento } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { Send, RefreshCw, ShoppingBag, TrendingDown, DollarSign, Search, X, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'

const ESTORNO_EVENTS = new Set(['order_status.chargeback', 'order_status.refund'])
const isEstorno = (ev) => ESTORNO_EVENTS.has(canonicalEvento(ev))
const isCompra = (ev) => canonicalEvento(ev) === 'order_status.purchase_approved'
const normTel = (t) => (t || '').replace(/\D/g, '')

function parseValorNum(valor) {
  if (valor == null || valor === '') return null
  const s = String(valor).trim()
  if (/^\d+$/.test(s)) return Number(s) / 100
  const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return isNaN(n) ? null : n
}
function formatMoeda(n, moeda) {
  const cur = (moeda || 'BRL').toUpperCase()
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur }).format(n) } catch { return `${cur} ${Number(n).toFixed(2)}` }
}
const formatDate = (ts) => {
  if (!ts) return '-'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
const ms = (c) => (c?.toMillis ? c.toMillis() : c?.seconds ? c.seconds * 1000 : (c ? new Date(c).getTime() : 0))

function StatCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90',
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90',
    violet: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90',
    red: 'from-rose-50 to-red-50/80 text-red-700 border-red-100/90',
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 sm:p-5 shadow-sm ${colors[color] || colors.blue}`}>
      {Icon && <Icon className="pointer-events-none absolute -right-4 -bottom-5 w-28 h-28 opacity-[0.14]" strokeWidth={1.5} />}
      <div className="relative min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-55">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1.5 tabular-nums break-words leading-tight">{value}</p>
        {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

const TIPO_LABEL = {
  comprou: { label: 'Comprou', cls: 'bg-emerald-100 text-emerald-700' },
  refund: { label: 'Reembolso', cls: 'bg-orange-100 text-orange-700' },
  chargeback: { label: 'Chargeback', cls: 'bg-red-100 text-red-700' },
}

export default function SmsMetricas() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = ['api', 'brl'].includes(canalParam) ? canalParam : 'eua'
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [grupos, setGrupos] = useState([])
  const [smsLogs, setSmsLogs] = useState([])
  const [smsMensagens, setSmsMensagens] = useState([])
  const [funnelSends, setFunnelSends] = useState([])
  const [grupoFiltro, setGrupoFiltro] = useState('')
  const [fTexto, setFTexto] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [sortKey, setSortKey] = useState('quando')
  const [sortDir, setSortDir] = useState('desc')
  const [pagina, setPagina] = useState(1)

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [ld, gs, logs, mens, sends, disp] = await Promise.all([
      getLeads(user.uid), getProductGroups(user.uid), getSmsLogs(user.uid, canal), getSmsMensagens(user.uid), getFunnelSends(user.uid), getSmsDisparos(user.uid, canal),
    ])
    const dispIds = new Set(disp.map((d) => d.id))
    setLeads(ld); setGrupos(gs); setSmsLogs(logs)
    setSmsMensagens(mens.filter((m) => dispIds.has(m.disparoId)))
    setFunnelSends(sends.filter((s) => s.canal === 'sms' && (s.smsCanal || 'eua') === canal))
    setLoading(false)
  }
  useEffect(() => { carregar() }, [user?.uid, canal])

  const grupoSel = useMemo(() => grupos.find((g) => g.id === grupoFiltro) || null, [grupos, grupoFiltro])
  const produtosGrupo = useMemo(() => new Set(grupoSel?.produtos || []), [grupoSel])

  // Telefones que receberam SMS (disparos em massa + automações/reenvio + funil de SMS).
  const telefonesMsg = useMemo(() => {
    const set = new Set()
    for (const m of smsMensagens) { const t = normTel(m.to); if (t) set.add(t) }
    for (const l of smsLogs) { if (l.status === 'enviado') { const t = normTel(l.telefone); if (t) set.add(t) } }
    for (const s of funnelSends) { if (s.status === 'enviado') { const t = normTel(s.contato?.telefone); if (t) set.add(t) } }
    return set
  }, [smsMensagens, smsLogs, funnelSends])

  const purchaseMap = useMemo(() => {
    const m = new Map()
    // Só conta COMPRA APROVADA — não carrinho abandonado/lead (que também trazem valor).
    for (const l of leads) { if (!isCompra(l.evento) || !l.valor) continue; const p = normTel(l.telefone); if (!p) continue; if (!m.has(p)) m.set(p, { valor: l.valor, moeda: l.moeda }) }
    return m
  }, [leads])
  const estornoMap = useMemo(() => {
    const m = new Map()
    for (const l of leads) { if (!isEstorno(l.evento)) continue; const p = normTel(l.telefone); const n = parseValorNum(l.valor); if (!p) continue; const cur = m.get(p) || { valor: 0, moeda: l.moeda || 'BRL' }; if (n != null) cur.valor += n; if (l.moeda) cur.moeda = l.moeda; m.set(p, cur) }
    return m
  }, [leads])

  const stats = useMemo(() => {
    let enviados
    if (grupoSel) {
      enviados = new Set(leads.filter((l) => l.produto && produtosGrupo.has(l.produto) && telefonesMsg.has(normTel(l.telefone))).map((l) => normTel(l.telefone)).filter(Boolean)).size
    } else {
      enviados = telefonesMsg.size
    }
    return { enviados }
  }, [grupoSel, leads, produtosGrupo, telefonesMsg])

  const atrib = useMemo(() => {
    let bruto = 0, compras = 0, estorno = 0, estornoQtd = 0, moeda = 'BRL'
    if (grupoSel) {
      const seen = new Set()
      for (const l of leads) {
        const p = normTel(l.telefone)
        if (!l.produto || !produtosGrupo.has(l.produto) || !telefonesMsg.has(p) || !l.valor) continue
        const n = parseValorNum(l.valor); if (n == null) continue
        if (l.moeda) moeda = l.moeda
        if (isEstorno(l.evento)) { estorno += n; estornoQtd++; continue }
        if (isCompra(l.evento)) { if (seen.has(p)) continue; seen.add(p); bruto += n; compras++ }
      }
      return { receita: bruto - estorno, bruto, estorno, estornoQtd, compras, moeda }
    }
    purchaseMap.forEach((info, p) => { if (!telefonesMsg.has(p)) return; const n = parseValorNum(info.valor); if (n != null) { bruto += n; compras++; if (info.moeda) moeda = info.moeda } })
    estornoMap.forEach((info, p) => { if (!telefonesMsg.has(p)) return; estorno += info.valor; estornoQtd++; if (info.moeda) moeda = info.moeda })
    return { receita: bruto - estorno, bruto, estorno, estornoQtd, compras, moeda }
  }, [grupoSel, leads, produtosGrupo, telefonesMsg, purchaseMap, estornoMap])

  const atividadeBase = useMemo(() => {
    const rows = []
    for (const l of leads) {
      const p = normTel(l.telefone)
      if (!p || !telefonesMsg.has(p)) continue
      if (grupoSel && !(l.produto && produtosGrupo.has(l.produto))) continue
      if (isEstorno(l.evento)) rows.push({ id: 'e_' + l.id, nome: l.nome, telefone: l.telefone, tipo: canonicalEvento(l.evento) === 'order_status.chargeback' ? 'chargeback' : 'refund', produto: l.produto, valorNum: parseValorNum(l.valor), moeda: l.moeda, createdAt: l.createdAt })
      else if (isCompra(l.evento) && l.valor) rows.push({ id: 'c_' + l.id, nome: l.nome, telefone: l.telefone, tipo: 'comprou', produto: l.produto, valorNum: parseValorNum(l.valor), moeda: l.moeda, createdAt: l.createdAt })
    }
    return rows
  }, [leads, telefonesMsg, grupoSel, produtosGrupo])

  const atividadeFiltrada = useMemo(() => {
    let list = atividadeBase
    if (fTexto.trim()) { const q = fTexto.toLowerCase(); list = list.filter((e) => (e.nome || '').toLowerCase().includes(q) || (e.telefone || '').includes(q) || (e.produto || '').toLowerCase().includes(q)) }
    const val = (e) => {
      switch (sortKey) {
        case 'contato': return (e.nome || e.telefone || '').toLowerCase()
        case 'acao': return e.tipo || ''
        case 'produto': return (e.produto || '').toLowerCase()
        case 'valor': return e.tipo === 'comprou' ? (e.valorNum || 0) : -(e.valorNum || 0)
        default: return ms(e.createdAt)
      }
    }
    return [...list].sort((a, b) => { const va = val(a), vb = val(b); if (va < vb) return sortDir === 'asc' ? -1 : 1; if (va > vb) return sortDir === 'asc' ? 1 : -1; return 0 })
  }, [atividadeBase, fTexto, sortKey, sortDir])

  useEffect(() => { setPagina(1) }, [fTexto, sortKey, sortDir, grupoFiltro])
  const toggleSort = (key) => { if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(key); setSortDir('asc') } }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const POR_PAGINA = 10
  const totalPaginas = Math.max(1, Math.ceil(atividadeFiltrada.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const atividadePagina = atividadeFiltrada.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)
  const COLS = [['contato', 'Contato'], ['acao', 'Ação'], ['produto', 'Produto'], ['valor', 'Valor'], ['quando', 'Quando']]
  const semDados = telefonesMsg.size === 0

  return (
    <PageShell
      badge={`SMS · Métricas · ${canal === 'api' ? "API's" : canal === 'brl' ? 'Brasil' : 'EUA'}`}
      right={
        <div className="flex flex-wrap gap-2 items-center">
          {grupos.length > 0 && (
            <Select value={grupoFiltro} onChange={setGrupoFiltro} className="w-full sm:w-52" withThumb options={[{ value: '', label: 'Todos os produtos' }, ...grupos.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))]} />
          )}
          <button onClick={carregar} className="btn-secondary text-sm min-h-[44px]"><RefreshCw className="w-4 h-4" /> Atualizar</button>
        </div>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-1">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard label="Enviados" value={stats.enviados} sub="contatos alcançados" icon={Send} color="green" />
          <StatCard label="Compras atribuídas" value={atrib.compras} icon={ShoppingBag} color="blue" />
        </div>
      </aside>

      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-3">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard label="Receita atribuída (líquida)" icon={DollarSign} value={formatMoeda(atrib.receita, atrib.moeda)} sub={atrib.estorno > 0 ? `${atrib.compras} compra(s) · bruto ${formatMoeda(atrib.bruto, atrib.moeda)}` : `${atrib.compras} compra(s)`} color="green" />
          <StatCard label="Estornos" value={atrib.estorno > 0 ? `- ${formatMoeda(atrib.estorno, atrib.moeda)}` : formatMoeda(0, atrib.moeda)} sub={`${atrib.estornoQtd} estorno(s)`} icon={TrendingDown} color="red" />
        </div>
      </aside>

      <div className="flex-1 min-w-0 lg:order-2 flex flex-col gap-4 sm:gap-5">
        {semDados && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            Ainda não há dados. Dispare SMS (Remarketing, Disparos ou Funil). Quando um contato que recebeu SMS comprar em qualquer webhook, a receita aparece aqui.
          </div>
        )}

        <Panel
          title="Atividade recente"
          icon={MessageSquare}
          noPadding
          right={
            <div className="flex items-center gap-1 shrink-0">
              <AnimatePresence initial={false}>
                {buscaAberta && (
                  <motion.div key="busca" initial={{ width: 0, opacity: 0 }} animate={{ width: '11rem', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                    <input value={fTexto} onChange={(e) => setFTexto(e.target.value)} autoFocus placeholder="Contato ou produto" className="w-44 h-7 px-3 rounded-lg border border-surface-200 text-sm outline-none focus:outline-none focus:ring-0" />
                  </motion.div>
                )}
              </AnimatePresence>
              <button type="button" onClick={() => { if (buscaAberta) setFTexto(''); setBuscaAberta((v) => !v) }} title={buscaAberta ? 'Fechar busca' : 'Buscar'} className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0">
                {buscaAberta ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            {atividadeFiltrada.length === 0 ? (
              <p className="p-6 text-sm text-stone-400 text-center">Nenhuma compra/estorno de quem recebeu SMS ainda.</p>
            ) : (
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-surface-100 text-left text-stone-500">
                    {COLS.map(([key, label]) => (
                      <th key={key} onClick={() => toggleSort(key)} className="px-4 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                        {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {atividadePagina.map((e) => {
                    const t = TIPO_LABEL[e.tipo] || { label: e.tipo, cls: 'bg-stone-100 text-stone-600' }
                    const isEst = e.tipo === 'chargeback' || e.tipo === 'refund'
                    return (
                      <tr key={e.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-stone-800 truncate max-w-[180px]">{e.nome || 'Sem nome'}</div>
                          <div className="text-xs text-stone-400 font-mono truncate max-w-[180px]">{e.telefone || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${t.cls}`}>{t.label}</span></td>
                        <td className="px-4 py-2.5 text-xs text-stone-600 truncate max-w-[160px]" title={e.produto || ''}>{e.produto || '—'}</td>
                        {isEst ? (
                          <td className="px-4 py-2.5 text-sm font-semibold text-red-600 whitespace-nowrap">{e.valorNum != null ? `- ${formatMoeda(e.valorNum, e.moeda)}` : '—'}</td>
                        ) : (
                          <td className="px-4 py-2.5 text-sm font-semibold text-emerald-700 whitespace-nowrap">{e.valorNum != null ? formatMoeda(e.valorNum, e.moeda) : '—'}</td>
                        )}
                        <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{formatDate(e.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {atividadeFiltrada.length > POR_PAGINA && (
            <div className="px-4 py-3 border-t border-surface-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-stone-600">Página {paginaAtual} de {totalPaginas} · {atividadeFiltrada.length} registro(s)</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1} className="flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /> Anterior</button>
                <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas} className="flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-50">Próxima <ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Panel>
      </div>
      </div>
    </PageShell>
  )
}

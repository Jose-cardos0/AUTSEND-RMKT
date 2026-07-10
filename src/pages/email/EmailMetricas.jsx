import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../../lib/firebase'
import { getEmailDisparos, getEmailEvents, getEmailLogs, getLeads, getProductGroups } from '../../lib/firestore'
import { canonicalEvento } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { Send, Eye, MousePointerClick, Percent, RefreshCw, Link2, BarChart3, Mail, Search, ChevronLeft, ChevronRight, TrendingDown, DollarSign, X } from 'lucide-react'

// Eventos que representam devolução de dinheiro (descontam da receita).
const ESTORNO_EVENTS = new Set(['order_status.chargeback', 'order_status.refund'])
const isEstorno = (ev) => ESTORNO_EVENTS.has(canonicalEvento(ev))

/** Interpreta o valor da compra: inteiro puro = centavos; senão tenta ler o número formatado. */
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
function formatValor(valor, moeda) {
  const n = parseValorNum(valor)
  if (n == null) return valor ? String(valor) : null
  return formatMoeda(n, moeda)
}

function StatCard({ label, value, sub, sub2, icon: Icon, color }) {
  const colors = {
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90',
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90',
    violet: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90',
    amber: 'from-amber-50 to-orange-50/70 text-amber-800 border-amber-100/90',
    red: 'from-rose-50 to-red-50/80 text-red-700 border-red-100/90',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 sm:p-5 shadow-sm ${colors[color] || colors.blue}`}
    >
      {Icon && (
        <Icon className="pointer-events-none absolute -right-4 -bottom-5 w-28 h-28 opacity-[0.14]" strokeWidth={1.5} />
      )}
      <div className="relative min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-55">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1.5 tabular-nums break-words leading-tight">{value}</p>
        {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
        {sub2 && <p className="text-[10px] opacity-55 mt-0.5">{sub2}</p>}
      </div>
    </motion.div>
  )
}

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

const formatDate = (ts) => {
  if (!ts) return '-'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const TIPO_LABEL = {
  opened: { label: 'Abriu', cls: 'bg-blue-100 text-blue-700' },
  clicked: { label: 'Clicou', cls: 'bg-violet-100 text-violet-700' },
  delivered: { label: 'Entregue', cls: 'bg-green-100 text-green-700' },
  bounced: { label: 'Bounce', cls: 'bg-red-100 text-red-700' },
  complained: { label: 'Spam', cls: 'bg-red-100 text-red-700' },
  chargeback: { label: 'Chargeback', cls: 'bg-red-100 text-red-700' },
  refund: { label: 'Reembolso', cls: 'bg-orange-100 text-orange-700' },
}

export default function EmailMetricas() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [disparos, setDisparos] = useState([])
  const [events, setEvents] = useState([])
  const [logs, setLogs] = useState([])
  const [leads, setLeads] = useState([])
  const [grupos, setGrupos] = useState([])
  const [grupoFiltro, setGrupoFiltro] = useState('')

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [d, e, l, ld, gs] = await Promise.all([
      getEmailDisparos(user.uid),
      getEmailEvents(user.uid),
      getEmailLogs(user.uid),
      getLeads(user.uid),
      getProductGroups(user.uid),
    ])
    setDisparos(d)
    setEvents(e)
    setLogs(l)
    setLeads(ld)
    setGrupos(gs)
    setLoading(false)
  }

  useEffect(() => { carregar() }, [user?.uid])

  const [fTexto, setFTexto] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [sortKey, setSortKey] = useState('quando')
  const [sortDir, setSortDir] = useState('desc')
  const [pagina, setPagina] = useState(1)
  const [pDisp, setPDisp] = useState(1)
  // Painéis "Desempenho por disparo" e "Links mais clicados": dropdown compartilhado, começa fechado.
  const [paineisAbertos, setPaineisAbertos] = useState(false)

  // ── Filtro por grupo de produto ──
  const grupoSel = useMemo(() => grupos.find((g) => g.id === grupoFiltro) || null, [grupos, grupoFiltro])
  const produtosGrupo = useMemo(() => new Set(grupoSel?.produtos || []), [grupoSel])
  const emailsGrupo = useMemo(() => {
    if (!grupoSel) return null
    const s = new Set()
    leads.forEach((l) => { if (l.produto && produtosGrupo.has(l.produto) && l.email) s.add(l.email.toLowerCase()) })
    return s
  }, [leads, grupoSel, produtosGrupo])
  const eventosF = useMemo(
    () => (emailsGrupo ? events.filter((e) => emailsGrupo.has((e.email || '').toLowerCase())) : events),
    [events, emailsGrupo]
  )

  const stats = useMemo(() => {
    const opened = new Set(eventosF.filter((e) => e.tipo === 'opened' && e.email).map((e) => (e.email || '').toLowerCase())).size
    const clicked = new Set(eventosF.filter((e) => e.tipo === 'clicked' && e.email).map((e) => (e.email || '').toLowerCase())).size
    if (grupoSel) {
      const enviados = new Set(
        leads.filter((l) => l.produto && produtosGrupo.has(l.produto) && l.status === 'enviado' && l.email).map((l) => l.email.toLowerCase())
      ).size
      return { enviados, opened, clicked }
    }
    const enviadosDisparo = disparos.reduce((s, d) => s + (d.enviados || 0), 0)
    const enviadosAuto = logs.filter((l) => l.status === 'enviado').length
    return { enviados: enviadosDisparo + enviadosAuto, opened, clicked }
  }, [eventosF, grupoSel, leads, produtosGrupo, disparos, logs])

  // e-mail (minúsculo) → compra { valor, moeda } — leads já vêm ordenados do mais recente
  const purchaseMap = useMemo(() => {
    const m = new Map()
    for (const l of leads) {
      const email = (l.email || '').toLowerCase().trim()
      if (!email || !l.valor || isEstorno(l.evento)) continue
      if (!m.has(email)) m.set(email, { valor: l.valor, moeda: l.moeda, evento: l.evento })
    }
    return m
  }, [leads])

  // e-mail (minúsculo) → estornos { valor (soma), moeda } (chargeback + reembolso)
  const estornoMap = useMemo(() => {
    const m = new Map()
    for (const l of leads) {
      if (!isEstorno(l.evento)) continue
      const email = (l.email || '').toLowerCase().trim()
      const n = parseValorNum(l.valor)
      if (!email || n == null) continue
      const cur = m.get(email) || { valor: 0, moeda: l.moeda || 'BRL' }
      cur.valor += n
      if (l.moeda) cur.moeda = l.moeda
      m.set(email, cur)
    }
    return m
  }, [leads])

  // e-mail (minúsculo) → produto (lead mais recente com produto vence)
  const produtoMap = useMemo(() => {
    const m = new Map()
    for (const l of leads) {
      const email = (l.email || '').toLowerCase().trim()
      if (!email || !l.produto || m.has(email)) continue
      m.set(email, l.produto)
    }
    return m
  }, [leads])

  const atrib = useMemo(() => {
    let bruto = 0
    let compras = 0
    let estorno = 0
    let estornoQtd = 0
    let moeda = 'BRL'
    if (grupoSel) {
      const seen = new Set()
      for (const l of leads) {
        const email = (l.email || '').toLowerCase()
        if (!l.produto || !produtosGrupo.has(l.produto) || !l.valor) continue
        const n = parseValorNum(l.valor)
        if (n == null) continue
        if (l.moeda) moeda = l.moeda
        if (isEstorno(l.evento)) { estorno += n; estornoQtd++; continue }
        if (seen.has(email)) continue
        seen.add(email); bruto += n; compras++
      }
      return { receita: bruto - estorno, bruto, estorno, estornoQtd, compras, moeda }
    }
    const emailedSet = new Set(events.map((e) => (e.email || '').toLowerCase()).filter(Boolean))
    purchaseMap.forEach((info, email) => {
      if (!emailedSet.has(email)) return
      const n = parseValorNum(info.valor)
      if (n != null) { bruto += n; compras++; if (info.moeda) moeda = info.moeda }
    })
    estornoMap.forEach((info, email) => {
      if (!emailedSet.has(email)) return
      estorno += info.valor; estornoQtd++; if (info.moeda) moeda = info.moeda
    })
    return { receita: bruto - estorno, bruto, estorno, estornoQtd, compras, moeda }
  }, [grupoSel, leads, produtosGrupo, purchaseMap, estornoMap, events])

  const disparosComMetrica = useMemo(() => {
    return disparos.map((d) => {
      const evs = events.filter((e) => e.disparoId === d.id)
      const op = new Set(evs.filter((e) => e.tipo === 'opened').map((e) => e.email)).size
      const cl = new Set(evs.filter((e) => e.tipo === 'clicked').map((e) => e.email)).size
      return { ...d, op, cl }
    })
  }, [disparos, events])

  const topLinks = useMemo(() => {
    const m = {}
    eventosF.filter((e) => e.tipo === 'clicked' && e.link).forEach((e) => { m[e.link] = (m[e.link] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [eventosF])

  // Estornos (chargeback/reembolso) viram linhas de atividade, vindas dos leads
  const estornoAtividade = useMemo(() => {
    return leads
      .filter((l) => isEstorno(l.evento) && l.email)
      .filter((l) => !grupoSel || (l.produto && produtosGrupo.has(l.produto)))
      .map((l) => ({
        id: `estorno_${l.id}`,
        email: l.email,
        tipo: canonicalEvento(l.evento) === 'order_status.chargeback' ? 'chargeback' : 'refund',
        link: '',
        createdAt: l.createdAt,
        valorEstorno: parseValorNum(l.valor),
        moeda: l.moeda,
        produtoEstorno: l.produto,
      }))
  }, [leads, grupoSel, produtosGrupo])

  // Agrupa aberturas/cliques repetidos do mesmo contato (o cliente de e-mail recarrega o pixel
  // várias vezes) numa linha só, com contador ×N e a data mais recente.
  const atividadeBase = useMemo(() => {
    const ms = (c) => (c?.toMillis ? c.toMillis() : c?.seconds ? c.seconds * 1000 : 0)
    const grupos = new Map()
    for (const e of eventosF) {
      if (e.tipo !== 'opened' && e.tipo !== 'clicked') continue
      const key = `${(e.email || '').toLowerCase()}|${e.tipo}|${e.link || ''}`
      const g = grupos.get(key)
      const t = ms(e.createdAt)
      if (!g) {
        grupos.set(key, { ...e, count: 1, _ms: t })
      } else {
        g.count++
        if (t > g._ms) { g._ms = t; g.createdAt = e.createdAt; g.id = e.id }
      }
    }
    return [...grupos.values(), ...estornoAtividade]
  }, [eventosF, estornoAtividade])

  const atividadeFiltrada = useMemo(() => {
    let list = atividadeBase
    if (fTexto.trim()) {
      const q = fTexto.toLowerCase()
      list = list.filter((e) => (e.email || '').toLowerCase().includes(q) || (e.link || '').toLowerCase().includes(q))
    }
    const val = (e) => {
      switch (sortKey) {
        case 'contato': return (e.email || '').toLowerCase()
        case 'acao': return e.tipo || ''
        case 'link': return (e.link || '').toLowerCase()
        case 'produto': return (e.produtoEstorno || produtoMap.get((e.email || '').toLowerCase()) || '').toLowerCase()
        case 'valor': {
          if (e.tipo === 'chargeback' || e.tipo === 'refund') return -(e.valorEstorno || 0)
          const info = purchaseMap.get((e.email || '').toLowerCase()); return info ? (parseValorNum(info.valor) || 0) : -1
        }
        default: { const c = e.createdAt; return c?.toMillis ? c.toMillis() : (c?.seconds ? c.seconds * 1000 : 0) }
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [atividadeBase, fTexto, sortKey, sortDir, purchaseMap, produtoMap])

  useEffect(() => { setPagina(1) }, [fTexto, sortKey, sortDir, grupoFiltro])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const semDados = events.length === 0 && disparos.length === 0
  const POR_PAGINA = 10
  const totalPaginas = Math.max(1, Math.ceil(atividadeFiltrada.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const atividadePagina = atividadeFiltrada.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)
  const COLS = [['contato', 'Contato'], ['acao', 'Ação'], ['link', 'Link'], ['produto', 'Produto'], ['valor', 'Valor'], ['quando', 'Quando']]
  const DISP_POR_PAGINA = 5
  const totalPagDisp = Math.max(1, Math.ceil(disparosComMetrica.length / DISP_POR_PAGINA))
  const pagDispAtual = Math.min(pDisp, totalPagDisp)
  const disparosPagina = disparosComMetrica.slice((pagDispAtual - 1) * DISP_POR_PAGINA, pagDispAtual * DISP_POR_PAGINA)

  return (
    <PageShell
      badge="E-mail · Métricas"
      title="Dashboard de E-mail"
      right={
        <div className="flex flex-wrap gap-2 items-center">
          {grupos.length > 0 && (
            <Select
              value={grupoFiltro}
              onChange={setGrupoFiltro}
              className="w-full sm:w-52"
              withThumb
              options={[{ value: '', label: 'Todos os produtos' }, ...grupos.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))]}
            />
          )}
          <button onClick={carregar} className="btn-secondary text-sm min-h-[44px]">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6">
      {/* KPIs — 3 cards à esquerda (sticky) */}
      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-1">
        <div className="lg:sticky lg:top-24 grid grid-cols-3 lg:grid-cols-1 gap-3">
          <StatCard label="Enviados" value={stats.enviados} icon={Send} color="blue" />
          <StatCard label="Aberturas únicas" value={stats.opened} sub={`Taxa: ${pct(stats.opened, stats.enviados)}`} icon={Eye} color="blue" />
          <StatCard label="Cliques únicos" value={stats.clicked} sub={`Taxa: ${pct(stats.clicked, stats.enviados)}`} icon={MousePointerClick} color="violet" />
        </div>
      </aside>

      {/* KPIs — 3 cards à direita (sticky) */}
      <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-3">
        <div className="lg:sticky lg:top-24 grid grid-cols-3 lg:grid-cols-1 gap-3">
          <StatCard label="CTR (clique/abertura)" value={pct(stats.clicked, stats.opened)} icon={Percent} color="amber" />
          <StatCard
            label="Receita atribuída (líquida)"
            icon={DollarSign}
            value={formatMoeda(atrib.receita, atrib.moeda)}
            sub={atrib.estorno > 0 ? `${atrib.compras} compra(s) · bruto ${formatMoeda(atrib.bruto, atrib.moeda)}` : `${atrib.compras} compra(s)`}
            color="green"
          />
          <StatCard
            label="Estornos"
            value={atrib.estorno > 0 ? `- ${formatMoeda(atrib.estorno, atrib.moeda)}` : formatMoeda(0, atrib.moeda)}
            sub={`${atrib.estornoQtd} estorno(s)`}
            sub2="(chargeback + reemb.)"
            icon={TrendingDown}
            color="red"
          />
        </div>
      </aside>

      {/* Conteúdo — meio */}
      <div className="flex-1 min-w-0 lg:order-2 flex flex-col gap-4 sm:gap-5">
      {semDados && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Ainda não há dados. Envie um disparo e, com o rastreamento ligado no Resend, as aberturas e cliques aparecem aqui.
        </div>
      )}

      <div className="order-2 flex flex-col lg:flex-row gap-3">
        {/* Por disparo */}
        <Panel title="Desempenho por disparo" icon={BarChart3} noPadding className="flex-1" collapsible open={paineisAbertos} onToggle={() => setPaineisAbertos((v) => !v)}>
          <div className="overflow-x-auto">
            {disparosComMetrica.length === 0 ? (
              <p className="p-6 text-sm text-stone-400 text-center">Nenhum disparo ainda.</p>
            ) : (
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="border-b border-surface-100 text-left text-stone-500">
                    <th className="px-4 py-2.5 font-medium text-xs">Disparo</th>
                    <th className="px-4 py-2.5 font-medium text-xs">Enviados</th>
                    <th className="px-4 py-2.5 font-medium text-xs">Aberturas</th>
                    <th className="px-4 py-2.5 font-medium text-xs">Cliques</th>
                  </tr>
                </thead>
                <tbody>
                  {disparosPagina.map((d) => (
                    <tr key={d.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-stone-800 truncate max-w-[160px]">{d.nomeDisparo}</div>
                        <div className="text-xs text-stone-400">{formatDate(d.createdAt)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-stone-600 tabular-nums">{d.enviados || 0}</td>
                      <td className="px-4 py-2.5 tabular-nums"><span className="text-blue-600 font-medium">{d.op}</span> <span className="text-xs text-stone-400">({pct(d.op, d.enviados)})</span></td>
                      <td className="px-4 py-2.5 tabular-nums"><span className="text-violet-600 font-medium">{d.cl}</span> <span className="text-xs text-stone-400">({pct(d.cl, d.enviados)})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {disparosComMetrica.length > DISP_POR_PAGINA && (
            <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-600">Página {pagDispAtual} de {totalPagDisp}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPDisp((p) => Math.max(1, p - 1))} disabled={pagDispAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPDisp((p) => Math.min(totalPagDisp, p + 1))} disabled={pagDispAtual >= totalPagDisp} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Panel>

        {/* Top links */}
        <Panel title="Links mais clicados" icon={Link2} className="lg:w-80 shrink-0" collapsible open={paineisAbertos} onToggle={() => setPaineisAbertos((v) => !v)}>
          {topLinks.length === 0 ? (
            <p className="text-sm text-stone-400">Nenhum clique registrado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {topLinks.map(([link, count]) => (
                <li key={link} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-stone-600 truncate min-w-0" title={link}>{link}</span>
                  <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Eventos recentes */}
      <Panel
        title="Atividade recente"
        icon={Mail}
        noPadding
        className="order-1"
        right={
          <div className="flex items-center gap-1 shrink-0">
            <AnimatePresence initial={false}>
              {buscaAberta && (
                <motion.div
                  key="busca"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: '11rem', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <input
                    value={fTexto}
                    onChange={(e) => setFTexto(e.target.value)}
                    autoFocus
                    placeholder="Contato ou link"
                    className="w-44 h-7 px-3 rounded-lg border border-surface-200 text-sm outline-none focus:outline-none focus:ring-0"
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={() => { if (buscaAberta) setFTexto(''); setBuscaAberta((v) => !v) }}
              title={buscaAberta ? 'Fechar busca' : 'Buscar'}
              className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
            >
              {buscaAberta ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          {atividadeFiltrada.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">Nenhuma atividade encontrada.</p>
          ) : (
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  {COLS.map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className="px-4 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-stone-700 whitespace-nowrap"
                    >
                      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {atividadePagina.map((e) => {
                  const t = TIPO_LABEL[e.tipo] || { label: e.tipo, cls: 'bg-stone-100 text-stone-600' }
                  const isEst = e.tipo === 'chargeback' || e.tipo === 'refund'
                  const info = purchaseMap.get((e.email || '').toLowerCase())
                  const prod = e.produtoEstorno || produtoMap.get((e.email || '').toLowerCase())
                  return (
                    <tr key={e.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                      <td className="px-4 py-2.5 text-stone-700 truncate max-w-[180px]">{e.email || '-'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${t.cls}`}>{t.label}</span>
                        {e.count > 1 && <span className="ml-1.5 text-xs font-semibold text-stone-500" title={`${e.count} vezes`}>×{e.count}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 truncate max-w-[200px]" title={e.link || ''}>{e.link || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-600 truncate max-w-[140px]" title={prod || ''}>{prod || '—'}</td>
                      {isEst ? (
                        <td className="px-4 py-2.5 text-sm font-semibold text-red-600 whitespace-nowrap">{e.valorEstorno != null ? `- ${formatMoeda(e.valorEstorno, e.moeda)}` : '—'}</td>
                      ) : (
                        <td className="px-4 py-2.5 text-sm font-semibold text-emerald-700 whitespace-nowrap">{info ? (formatValor(info.valor, info.moeda) || '—') : '—'}</td>
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

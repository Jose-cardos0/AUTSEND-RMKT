import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../../lib/firebase'
import { getEmailDisparos, getEmailEvents, getEmailLogs, getLeads } from '../../lib/firestore'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Send, Eye, MousePointerClick, Percent, RefreshCw, Link2, BarChart3, Mail, DollarSign } from 'lucide-react'

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

function StatCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90',
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90',
    violet: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90',
    amber: 'from-amber-50 to-orange-50/70 text-amber-800 border-amber-100/90',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-gradient-to-br p-4 sm:p-5 shadow-sm ${colors[color] || colors.blue}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-55">{label}</p>
          <p className="text-2xl sm:text-3xl font-bold mt-1.5 tabular-nums">{value}</p>
          {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center ring-1 ring-white/80 shrink-0">
          <Icon className="w-5 h-5 opacity-70" />
        </div>
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
}

export default function EmailMetricas() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [disparos, setDisparos] = useState([])
  const [events, setEvents] = useState([])
  const [logs, setLogs] = useState([])
  const [leads, setLeads] = useState([])

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [d, e, l, ld] = await Promise.all([
      getEmailDisparos(user.uid),
      getEmailEvents(user.uid),
      getEmailLogs(user.uid),
      getLeads(user.uid),
    ])
    setDisparos(d)
    setEvents(e)
    setLogs(l)
    setLeads(ld)
    setLoading(false)
  }

  useEffect(() => { carregar() }, [user?.uid])

  const stats = useMemo(() => {
    const enviadosDisparo = disparos.reduce((s, d) => s + (d.enviados || 0), 0)
    const enviadosAuto = logs.filter((l) => l.status === 'enviado').length
    const enviados = enviadosDisparo + enviadosAuto
    const opened = new Set(events.filter((e) => e.tipo === 'opened' && e.email).map((e) => e.email))
    const clicked = new Set(events.filter((e) => e.tipo === 'clicked' && e.email).map((e) => e.email))
    return { enviados, opened: opened.size, clicked: clicked.size }
  }, [disparos, events, logs])

  // e-mail (minúsculo) → compra { valor, moeda } — leads já vêm ordenados do mais recente
  const purchaseMap = useMemo(() => {
    const m = new Map()
    for (const l of leads) {
      const email = (l.email || '').toLowerCase().trim()
      if (!email || !l.valor) continue
      if (!m.has(email)) m.set(email, { valor: l.valor, moeda: l.moeda, evento: l.evento })
    }
    return m
  }, [leads])

  const atrib = useMemo(() => {
    const emailedSet = new Set(events.map((e) => (e.email || '').toLowerCase()).filter(Boolean))
    let receita = 0
    let compras = 0
    let moeda = 'BRL'
    purchaseMap.forEach((info, email) => {
      if (!emailedSet.has(email)) return
      const n = parseValorNum(info.valor)
      if (n != null) { receita += n; compras++; if (info.moeda) moeda = info.moeda }
    })
    return { receita, compras, moeda }
  }, [purchaseMap, events])

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
    events.filter((e) => e.tipo === 'clicked' && e.link).forEach((e) => { m[e.link] = (m[e.link] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [events])

  const recentes = useMemo(() => events.filter((e) => e.tipo === 'opened' || e.tipo === 'clicked').slice(0, 30), [events])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const semDados = events.length === 0 && disparos.length === 0

  return (
    <PageShell
      badge="E-mail · Métricas"
      title="Dashboard de E-mail"
      subtitle="Aberturas, cliques e desempenho dos seus envios (dados do rastreamento do Resend)."
      right={
        <button onClick={carregar} className="btn-secondary text-sm min-h-[44px]">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      }
    >
      <div className="space-y-4 sm:space-y-5">
      {semDados && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Ainda não há dados. Envie um disparo e, com o rastreamento ligado no Resend, as aberturas e cliques aparecem aqui.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Enviados" value={stats.enviados} icon={Send} color="blue" />
        <StatCard label="Aberturas únicas" value={stats.opened} sub={`Taxa: ${pct(stats.opened, stats.enviados)}`} icon={Eye} color="blue" />
        <StatCard label="Cliques únicos" value={stats.clicked} sub={`Taxa: ${pct(stats.clicked, stats.enviados)}`} icon={MousePointerClick} color="violet" />
        <StatCard label="CTR (clique/abertura)" value={pct(stats.clicked, stats.opened)} icon={Percent} color="amber" />
        <StatCard label="Receita atribuída" value={formatMoeda(atrib.receita, atrib.moeda)} sub={`${atrib.compras} compra(s)`} icon={DollarSign} color="green" />
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        {/* Por disparo */}
        <Panel title="Desempenho por disparo" icon={BarChart3} noPadding className="flex-1">
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
                  {disparosComMetrica.map((d) => (
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
        </Panel>

        {/* Top links */}
        <Panel title="Links mais clicados" icon={Link2} className="lg:w-80 shrink-0">
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
      <Panel title="Atividade recente" icon={Mail} noPadding>
        <div className="overflow-x-auto">
          {recentes.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">Nenhuma abertura ou clique ainda.</p>
          ) : (
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  <th className="px-4 py-2.5 font-medium text-xs">Contato</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Ação</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Link</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Valor</th>
                  <th className="px-4 py-2.5 font-medium text-xs">Quando</th>
                </tr>
              </thead>
              <tbody>
                {recentes.map((e) => {
                  const t = TIPO_LABEL[e.tipo] || { label: e.tipo, cls: 'bg-stone-100 text-stone-600' }
                  return (
                    <tr key={e.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                      <td className="px-4 py-2.5 text-stone-700 truncate max-w-[180px]">{e.email || '-'}</td>
                      <td className="px-4 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${t.cls}`}>{t.label}</span></td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 truncate max-w-[200px]" title={e.link || ''}>{e.link || '—'}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-emerald-700 whitespace-nowrap">
                        {(() => { const info = purchaseMap.get((e.email || '').toLowerCase()); return info ? (formatValor(info.valor, info.moeda) || '—') : '—' })()}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{formatDate(e.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
      </div>
    </PageShell>
  )
}

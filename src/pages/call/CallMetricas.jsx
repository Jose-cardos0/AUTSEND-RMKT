import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../../lib/firebase'
import { getCallLogs } from '../../lib/firestore'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Phone, PhoneCall, Clock, DollarSign, RefreshCw } from 'lucide-react'

const PRECO_MIN = 1.5
const fmtDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
const fmtDur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60); const r = s % 60; return m ? `${m}m ${r}s` : `${r}s` }

function StatCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90',
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90',
    violet: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90',
    amber: 'from-amber-50 to-orange-50/80 text-amber-700 border-amber-100/90',
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 sm:p-5 shadow-sm ${colors[color] || colors.blue}`}>
      {Icon && <Icon className="pointer-events-none absolute -right-4 -bottom-5 w-24 h-24 opacity-[0.14]" strokeWidth={1.5} />}
      <div className="relative min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-55">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

export default function CallMetricas() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState([])

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    setLogs(await getCallLogs(user.uid, canal))
    setLoading(false)
  }
  useEffect(() => { carregar() }, [user?.uid, canal])

  const stats = useMemo(() => {
    let total = logs.length, atendidas = 0, segundos = 0, custoSeg = 0
    for (const l of logs) {
      if (l.status === 'atendida') atendidas++
      segundos += Number(l.segundos) || 0
      // custo cobrado do cliente = tudo que saiu de crédito+cota (não conta BYO/própria)
      if (!l.contaPropria) custoSeg += (Number(l.creditoConsumidoSeg) || 0) + (Number(l.cotaConsumidaSeg) || 0)
    }
    return { total, atendidas, segundos, custo: (custoSeg / 60) * PRECO_MIN }
  }, [logs])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge={`Call · Métricas · ${canal === 'api' ? "API's" : 'EUA'}`}
      right={<button onClick={carregar} className="btn-secondary text-sm min-h-[44px]"><RefreshCw className="w-4 h-4" /> Atualizar</button>}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Ligações" value={stats.total} sub="no total" icon={Phone} color="blue" />
        <StatCard label="Atendidas" value={stats.atendidas} sub={stats.total ? `${Math.round((stats.atendidas / stats.total) * 100)}% de atendimento` : '—'} icon={PhoneCall} color="green" />
        <StatCard label="Tempo falado" value={fmtDur(stats.segundos)} sub="soma das ligações" icon={Clock} color="violet" />
        <StatCard label="Custo" value={`R$ ${stats.custo.toFixed(2).replace('.', ',')}`} sub="minutos consumidos" icon={DollarSign} color="amber" />
      </div>

      <Panel title="Ligações recentes" icon={PhoneCall} noPadding className="mt-4">
        <div className="overflow-x-auto">
          {logs.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">Nenhuma ligação ainda. Vá em Campanha e ligue pros seus contatos.</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  {['Contato', 'Produto', 'Status', 'Duração', 'Quando'].map((h) => <th key={h} className="px-4 py-2.5 font-medium text-xs">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 100).map((l) => (
                  <tr key={l.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                    <td className="px-4 py-2.5"><div className="font-medium text-stone-800 truncate max-w-[160px]">{l.nome || 'Sem nome'}</div><div className="text-xs text-stone-400 font-mono">{l.telefone || '—'}</div></td>
                    <td className="px-4 py-2.5 text-xs text-stone-600 truncate max-w-[140px]">{l.produto || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${l.status === 'atendida' ? 'bg-emerald-100 text-emerald-700' : l.status === 'erro' ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-500'}`} title={l.status === 'erro' ? l.erroMsg : undefined}>
                        {l.status === 'atendida' ? 'Atendida' : l.status === 'erro' ? 'Erro' : 'Não atendida'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-stone-600 tabular-nums">{fmtDur(l.segundos)}</td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </PageShell>
  )
}

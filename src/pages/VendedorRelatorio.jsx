import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import * as echarts from 'echarts'
import { auth } from '../lib/firebase'
import { getVendedorRelatorio } from '../lib/firestore'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import StatCard from '../components/StatCard'
import Select from '../components/Select'
import EChart from '../components/EChart'
import DateRangePicker from '../components/DateRangePicker'
import { Users, ShoppingBag, CheckCircle2, Cpu, BarChart3, RefreshCw, Rocket, Package } from 'lucide-react'

const C = { primary: '#7c3aed', blue: '#3b82f6', green: '#10b981' }
const PALETA = ['#7c3aed', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#f43f5e']
const fmt = (n) => (n ?? 0).toLocaleString('pt-BR')
const areaGrad = (cor) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: cor + '4d' }, { offset: 1, color: cor + '00' }])
const TT = { backgroundColor: 'rgba(255,255,255,0.98)', borderColor: '#e7e5e4', borderWidth: 1, padding: [8, 12], textStyle: { color: '#44403c', fontSize: 12 }, extraCssText: 'border-radius:12px;box-shadow:0 8px 24px -6px rgba(0,0,0,0.15)' }

export default function VendedorRelatorio() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [data, setData] = useState(null)
  const [sel, setSel] = useState('')
  const [periodo, setPeriodo] = useState(null) // { de, ate } | null (tudo)

  const carregar = () => {
    if (!user?.uid) return
    setCarregando(true)
    getVendedorRelatorio({ de: periodo?.de, ate: periodo?.ate }).then(setData).catch(() => setData(null)).finally(() => { setLoading(false); setCarregando(false) })
  }
  useEffect(() => { carregar() }, [user?.uid, periodo])

  const vendedores = data?.vendedores || []
  const serie = data?.serie || []
  const foco = sel ? vendedores.filter((v) => v.atendenteId === sel) : vendedores
  const kpi = foco.reduce((a, v) => ({ pessoas: a.pessoas + v.pessoas, ic: a.ic + v.ic, vendas: a.vendas + v.vendas, tokens: a.tokens + v.tokens }), { pessoas: 0, ic: 0, vendas: 0, tokens: 0 })

  const lineOption = useMemo(() => ({
    animationDuration: 1100, animationEasing: 'cubicOut',
    color: [C.primary, C.blue, C.green],
    tooltip: { trigger: 'axis', ...TT, axisPointer: { type: 'line', lineStyle: { color: '#d6d3d1', type: 'dashed' } } },
    legend: { data: ['Pessoas', 'Checkout', 'Vendas'], bottom: 0, icon: 'roundRect', itemWidth: 11, itemHeight: 11, itemGap: 18, textStyle: { color: '#78716c', fontSize: 12 } },
    grid: { left: 34, right: 20, top: 18, bottom: 46 },
    xAxis: { type: 'category', boundaryGap: false, data: serie.map((s) => String(s.dia).slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#a8a29e', fontSize: 11 } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f5f5f4' } }, axisLabel: { color: '#a8a29e', fontSize: 11 } },
    series: [
      { name: 'Pessoas', type: 'line', smooth: true, showSymbol: false, symbolSize: 8, data: serie.map((s) => s.pessoas), lineStyle: { width: 3 }, areaStyle: { color: areaGrad(C.primary) } },
      { name: 'Checkout', type: 'line', smooth: true, showSymbol: false, symbolSize: 7, data: serie.map((s) => s.ic), lineStyle: { width: 2.5 } },
      { name: 'Vendas', type: 'line', smooth: true, showSymbol: false, symbolSize: 7, data: serie.map((s) => s.vendas), lineStyle: { width: 2.5 } },
    ],
  }), [serie])

  const funnelOption = useMemo(() => ({
    animationDuration: 1100, animationEasing: 'cubicOut',
    tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b>', ...TT },
    series: [{
      type: 'funnel', left: '16%', right: '16%', top: 16, bottom: 16, minSize: '18%', maxSize: '100%', gap: 3, sort: 'descending', funnelAlign: 'center',
      label: { position: 'right', color: '#78716c', fontSize: 13, fontWeight: 700, formatter: (p) => fmt(p.value) },
      labelLine: { length: 12, lineStyle: { color: '#e7e5e4', width: 1 } },
      itemStyle: { borderWidth: 0 },
      emphasis: { label: { color: '#7c3aed' }, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(124,58,237,0.25)' } },
      data: [
        { value: kpi.pessoas, name: 'Falaram', itemStyle: { color: '#c4b5fd' } },
        { value: kpi.ic, name: 'Chegaram no checkout', itemStyle: { color: '#9575ec' } },
        { value: kpi.vendas, name: 'Compraram', itemStyle: { color: '#6d28d9' } },
      ],
    }],
  }), [kpi.pessoas, kpi.ic, kpi.vendas])

  const pieData = vendedores.filter((v) => v.pessoas > 0).map((v) => ({ value: v.pessoas, name: v.nome }))
  const pieOption = useMemo(() => ({
    animationDuration: 1100, animationEasing: 'cubicOut',
    color: PALETA,
    title: { text: fmt(kpi.pessoas), subtext: 'pessoas', left: 'center', top: '34%', textStyle: { fontSize: 24, fontWeight: 'bold', color: '#44403c' }, subtextStyle: { fontSize: 11, color: '#a8a29e' } },
    tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> ({d}%)', ...TT },
    legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { color: '#78716c', fontSize: 11 }, type: 'scroll' },
    series: [{
      type: 'pie', radius: ['54%', '78%'], center: ['50%', '42%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 3 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.14)' } },
      data: pieData,
    }],
  }), [vendedores, kpi.pessoas])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const semDados = vendedores.length === 0 || kpi.pessoas === 0

  return (
    <PageShell
      badge="Comercial · Relatório"
      title="Relatório de vendedores"
      right={
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={sel} onChange={setSel} compact withThumb title="Filtrar por vendedor" className="w-40 sm:w-48 shrink-0"
            options={[{ value: '', label: 'Todos os vendedores' }, ...vendedores.map((v) => ({ value: v.atendenteId, label: v.nome, image: v.grupoImagem }))]} />
          <DateRangePicker value={periodo} onChange={setPeriodo} />
          <button onClick={carregar} disabled={carregando} title="Atualizar" className="btn-secondary min-h-[38px] px-3 shrink-0"><RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} /></button>
        </div>
      }
    >
      <div className="flex flex-col lg:flex-row gap-3">
        {/* KPIs — coluna à direita no desktop (igual Email Métricas); em cima no mobile */}
        <aside className="lg:w-60 xl:w-64 shrink-0 order-1 lg:order-2">
          <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-2 sm:gap-3">
            <StatCard label="Pessoas atendidas" value={fmt(kpi.pessoas)} icon={Users} color="blue" />
            <StatCard label="Chegaram no checkout" value={fmt(kpi.ic)} icon={ShoppingBag} color="amber" />
            <StatCard label="Vendas" value={fmt(kpi.vendas)} icon={CheckCircle2} color="green" />
            <StatCard label="Tokens consumidos (mês)" value={fmt(kpi.tokens)} icon={Cpu} color="purple" />
          </div>
        </aside>

        <div className="flex-1 min-w-0 order-2 lg:order-1 space-y-3 sm:space-y-4">
        {semDados ? (
          <Panel>
            <div className="flex flex-col items-center justify-center text-center gap-3 py-14">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><BarChart3 className="w-7 h-7" /></span>
              <h2 className="text-lg font-semibold text-stone-800">Ainda sem dados</h2>
              <p className="text-sm text-stone-500 max-w-md leading-relaxed">Assim que os leads começarem a conversar com seus vendedores, os números e gráficos aparecem aqui. Ative um vendedor em <Link to="/atendentes" className="text-primary-600 underline font-medium">Vendedores</Link>.</p>
            </div>
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Panel title="Conversas por dia" icon={BarChart3} className="lg:col-span-2">
                <EChart option={lineOption} height={300} />
              </Panel>
              <Panel title="Funil (onde as pessoas param)">
                <EChart option={funnelOption} height={300} />
              </Panel>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Panel title="Pessoas por vendedor">
                <EChart option={pieOption} height={300} />
              </Panel>
              <Panel title="Por vendedor" icon={Rocket} className="lg:col-span-2" noPadding>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 border-b border-surface-100">
                        <th className="px-4 py-2.5 font-semibold">Vendedor</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Pessoas</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Checkout</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Vendas</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Conv.</th>
                        <th className="px-4 py-2.5 font-semibold text-right">Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {vendedores.map((v) => (
                        <tr key={v.atendenteId} className="hover:bg-surface-50/60">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {v.grupoImagem
                                ? <img src={v.grupoImagem} alt="" className="w-8 h-8 rounded-lg object-contain shrink-0" />
                                : <span className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-stone-400" /></span>}
                              <div className="min-w-0">
                                <p className="font-medium text-stone-800 truncate flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.ativo ? 'bg-emerald-500' : 'bg-stone-300'}`} />{v.nome}</p>
                                {v.grupoNome && <p className="text-[11px] text-stone-400 truncate">{v.grupoNome}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">{fmt(v.pessoas)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-blue-600">{fmt(v.ic)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{fmt(v.vendas)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">{v.conversaoVenda}%</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-stone-500">{fmt(v.tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </>
        )}
        </div>
      </div>
    </PageShell>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { emailPreviewDoc } from '../lib/emailPreview'
import { useAuthState } from 'react-firebase-hooks/auth'
import { signInWithCustomToken } from 'firebase/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import { adminListClientes, adminGetClienteDetalhe, adminUpdateCliente, adminSetKillSwitch, healthDoCliente, STATUS_INFO, admin2faStatus, admin2faSetup, admin2faConfirm, admin2faVerify, admin2faDisable, adminImpersonar, adminGetKiwifyConfig, adminSetKiwifyConfig, adminStripePlanos, adminReembolsarCliente, adminSetRiscoConta, adminSetInstanciaBloqueada, adminGetClienteCredito, adminGetClienteGastos, adminGetClienteConectados, adminResetTermos, adminGetSecurityReport, adminRunSecurityScan, adminMarkSecuritySeen, ADMIN_EMAIL } from '../lib/admin'
import { PLANOS, PLANO_ORDEM, planoEfetivo, LIMITE_LABELS } from '../lib/plans'

// Limites editáveis no admin (espelho do whitelist do backend adminUpdateCliente).
const LIMITE_FIELDS = ['emailsMes', 'smsMes', 'instancias', 'trackers', 'dominios', 'iaMes']
import PageShell from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import Select from '../components/Select'
import CollapsibleSearch from '../components/CollapsibleSearch'
import { useConfirm } from '../components/ConfirmDialog'
import {
  Users, ShieldCheck, ShieldAlert, Pause, Ban, CheckCircle2, Power, RefreshCw, Filter,
  X, ChevronLeft, ChevronRight, ChevronDown, Loader2, Mail, TrendingDown, AlertTriangle, Save, KeyRound, Smartphone, Lock, LogIn, Crown, ShoppingBag, FileText, Eye, ExternalLink, Wallet, Receipt, Plug, Send, ArrowUpDown, ArrowUp, ArrowDown, ShieldAlert as ShieldAlertIcon, Skull,
} from 'lucide-react'

const POR_PAGINA = 12
const HEALTH = {
  green: { dot: 'bg-emerald-500', label: 'Saudável', cls: 'text-emerald-600' },
  yellow: { dot: 'bg-amber-500', label: 'Atenção', cls: 'text-amber-600' },
  red: { dot: 'bg-rose-500', label: 'Risco', cls: 'text-rose-600' },
}
const fmtNum = (n) => (Number(n) || 0).toLocaleString('pt-BR')
const fmtBRL = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// Rótulo + cor de cada tipo de movimento no histórico de crédito.
const MOV_META = {
  credito_sms: { label: 'Créditos SMS', cls: 'text-blue-600' },
  credito_email: { label: 'Créditos e-mail', cls: 'text-rose-600' },
  credito_call: { label: 'Minutos ligação', cls: 'text-emerald-600' },
  instancia: { label: 'Instância WhatsApp', cls: 'text-emerald-700' },
  numero: { label: 'Número SMS', cls: 'text-indigo-600' },
  plano: { label: 'Plano', cls: 'text-primary-700' },
  reembolso: { label: 'Reembolso', cls: 'text-rose-600' },
  chargeback: { label: 'Chargeback', cls: 'text-rose-700' },
  cancelamento: { label: 'Cancelamento', cls: 'text-stone-500' },
  ajuste: { label: 'Ajuste admin', cls: 'text-amber-600' },
}
const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR') }
const fmtDateMs = (ms) => { if (!ms) return '—'; const d = new Date(ms); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }

function StatCard({ icon: Icon, label, value, tint = 'stone', onClick, active }) {
  const tints = { stone: 'text-stone-400', emerald: 'text-emerald-500', amber: 'text-amber-500', rose: 'text-rose-500', sky: 'text-sky-500', violet: 'text-violet-500' }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden app-panel rounded-2xl p-4 text-left w-full transition ${onClick ? 'hover:ring-2 hover:ring-primary-200 cursor-pointer' : 'cursor-default'} ${active ? 'ring-2 ring-primary-400' : ''}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-2xl font-bold text-stone-800 tabular-nums mt-1">{value}</p>
      <Icon className={`pointer-events-none absolute -right-3 -bottom-4 w-20 h-20 opacity-[0.12] ${tints[tint]}`} strokeWidth={1.5} />
    </button>
  )
}

// Sua própria conta admin: aparece na lista, mas é somente leitura (não dá pra banir/mexer).
const ehAdminCliente = (c) => (c?.email || '').toLowerCase() === (ADMIN_EMAIL || '').toLowerCase()

const NIVEL_META = {
  critico: { label: 'CRÍTICO', cls: 'bg-rose-100 text-rose-700 border-rose-300', dot: 'bg-rose-500', icon: Skull },
  alto: { label: 'ALTO', cls: 'bg-orange-100 text-orange-700 border-orange-300', dot: 'bg-orange-500', icon: ShieldAlertIcon },
  medio: { label: 'MÉDIO', cls: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'bg-amber-500', icon: AlertTriangle },
}

// Página LOGS SECURITY: fiscalização de risco (financeiro/jurídico/abuso) por cliente.
function SecurityView({ report, carregando, onScan, onAbrirCliente }) {
  const alertas = report?.alertas || []
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <ShieldAlertIcon className="w-4 h-4 text-rose-600" /> Logs Security — fiscalização de risco
        </span>
        <div className="flex items-center gap-3">
          {report?.geradoEmMs ? <span className="text-[11px] text-stone-400">Última análise: {fmtDateMs(report.geradoEmMs)}</span> : null}
          <button onClick={onScan} disabled={carregando} className="text-xs font-medium text-primary-600 hover:underline inline-flex items-center gap-1 disabled:opacity-50">
            {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Rodar análise agora
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2 text-center"><span className="block text-2xl font-bold text-rose-700 tabular-nums">{report?.criticos ?? 0}</span><span className="block text-[10px] uppercase text-rose-700/70">Críticos</span></div>
        <div className="rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-center"><span className="block text-2xl font-bold text-orange-700 tabular-nums">{report?.altos ?? 0}</span><span className="block text-[10px] uppercase text-orange-700/70">Altos</span></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2 text-center"><span className="block text-2xl font-bold text-amber-700 tabular-nums">{report?.medios ?? 0}</span><span className="block text-[10px] uppercase text-amber-700/70">Médios</span></div>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {carregando && alertas.length === 0 ? (
          <p className="text-xs text-stone-400 py-8 text-center">Analisando clientes…</p>
        ) : alertas.length === 0 ? (
          <p className="text-sm text-emerald-600 py-8 text-center flex items-center justify-center gap-2"><ShieldCheck className="w-5 h-5" /> Nenhum cliente em risco no momento. Tudo limpo.</p>
        ) : alertas.map((a) => {
          const m = NIVEL_META[a.nivel] || NIVEL_META.medio
          const Icon = m.icon
          return (
            <button key={a.uid} onClick={() => onAbrirCliente(a.uid)} className={`w-full text-left rounded-xl border p-3 hover:ring-2 hover:ring-primary-200 transition ${m.cls}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="font-semibold text-stone-800 truncate">{a.nome || a.email || a.uid}</span>
                  <span className="text-[11px] text-stone-500 truncate hidden sm:inline">{a.email}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/70 capitalize">{a.plano}</span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label} · {a.score}</span>
                </span>
              </div>
              <ul className="text-[11px] text-stone-600 space-y-0.5 list-disc list-inside">
                {(a.motivos || []).map((mo, i) => <li key={i}>{mo}</li>)}
              </ul>
              <p className="text-[10px] text-stone-500 mt-1.5">Mês: custo {fmtBRL(a.custoMes)} · receita {fmtBRL(a.receitaMes)} · <span className={a.receitaMes - a.custoMes < 0 ? 'text-rose-600 font-semibold' : ''}>lucro {fmtBRL(a.receitaMes - a.custoMes)}</span></p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Admin() {
  const [user] = useAuthState(auth)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState([])
  const [enviosPausados, setEnviosPausados] = useState(false)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [sortBy, setSortBy] = useState(null) // coluna de ordenação
  const [sortDir, setSortDir] = useState('asc')
  const [view, setView] = useState('clientes') // 'clientes' | 'security'
  const [secReport, setSecReport] = useState(null)
  const [carregandoSec, setCarregandoSec] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [sel, setSel] = useState(null) // cliente aberto
  const [detalhe, setDetalhe] = useState(null) // { tenant, disparos, leadsCount, reclamacoes }
  const [carregandoDet, setCarregandoDet] = useState(false)
  const [detTab, setDetTab] = useState('disparos') // 'disparos' | 'reclamacoes' | 'whatsapp' | 'templates' | 'credito'
  const [detPage, setDetPage] = useState(1)
  const [credito, setCredito] = useState(null) // histórico financeiro do cliente (lazy)
  const [carregandoCredito, setCarregandoCredito] = useState(false)
  const [gastos, setGastos] = useState(null) // CRM de margem (lazy)
  const [carregandoGastos, setCarregandoGastos] = useState(false)
  const [conectados, setConectados] = useState(null) // inventário de recursos conectados (lazy)
  const [carregandoConectados, setCarregandoConectados] = useState(false)
  const [reenviandoTermo, setReenviandoTermo] = useState(false)
  const [instExp, setInstExp] = useState('') // instância expandida
  const [hoverTpl, setHoverTpl] = useState(null) // template de e-mail em hover (preview)
  const [hoverRect, setHoverRect] = useState(null)
  const [form, setForm] = useState({ plano: 'free', notas: '', limites: { trackers: 0, instancias: 0, emailsMes: 0, smsMes: 0, dominios: 0, iaMes: 0 } })
  const [salvando, setSalvando] = useState(false)
  const [impersonando, setImpersonando] = useState(false)
  const [togglingKill, setTogglingKill] = useState(false)
  // 2FA
  const [check2fa, setCheck2fa] = useState(true)
  const [enrolled2fa, setEnrolled2fa] = useState(false)
  const [verificado2fa, setVerificado2fa] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [verificando2fa, setVerificando2fa] = useState(false)
  const [showSeg, setShowSeg] = useState(false)
  // Onboarding Stripe
  const [showKiwify, setShowKiwify] = useState(false)
  const [kiwifyCfg, setKiwifyCfg] = useState(null)
  const [savingKiwify, setSavingKiwify] = useState(false)
  const [stripePlanos, setStripePlanos] = useState([])
  const [reembolsando, setReembolsando] = useState(false)
  const [riscoLoading, setRiscoLoading] = useState(false)
  const [setupData, setSetupData] = useState(null)
  const [segCode, setSegCode] = useState('')
  const [segBusy, setSegBusy] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    admin2faStatus()
      .then((r) => {
        setEnrolled2fa(r.enrolled)
        if (!r.enrolled || sessionStorage.getItem('sendlyAdmin2fa') === '1') setVerificado2fa(true)
      })
      .catch(() => setVerificado2fa(true))
      .finally(() => setCheck2fa(false))
  }, [user?.uid])

  const verificar2fa = async () => {
    setVerificando2fa(true)
    try {
      await admin2faVerify(codigo)
      sessionStorage.setItem('sendlyAdmin2fa', '1')
      setVerificado2fa(true); setCodigo('')
    } catch (e) { toast.error(e.message || 'Código inválido.') } finally { setVerificando2fa(false) }
  }

  const iniciarSetup = async () => {
    setSegBusy(true)
    try { setSetupData(await admin2faSetup()) } catch (e) { toast.error(e.message || 'Erro.') } finally { setSegBusy(false) }
  }
  const confirmarSetup = async () => {
    setSegBusy(true)
    try {
      await admin2faConfirm(segCode)
      toast.success('2FA ativado! 🔒')
      sessionStorage.setItem('sendlyAdmin2fa', '1')
      setEnrolled2fa(true); setVerificado2fa(true); setSetupData(null); setSegCode(''); setShowSeg(false)
    } catch (e) { toast.error(e.message || 'Código inválido.') } finally { setSegBusy(false) }
  }
  const desativar2fa = async () => {
    setSegBusy(true)
    try {
      await admin2faDisable(segCode)
      toast.success('2FA desativado.')
      setEnrolled2fa(false); setSegCode(''); setShowSeg(false)
    } catch (e) { toast.error(e.message || 'Código inválido.') } finally { setSegBusy(false) }
  }

  const carregar = () => {
    setLoading(true); setErro('')
    adminListClientes()
      .then((r) => { setClientes(r.clientes || []); setEnviosPausados(!!r.enviosPausados) })
      .catch((e) => setErro(e.message || 'Erro ao carregar clientes.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [user?.uid])

  // Relatório de segurança (bolinha vermelha + página Logs Security).
  const carregarSec = (scan = false) => {
    setCarregandoSec(true)
    const p = scan ? adminRunSecurityScan().then(() => adminGetSecurityReport()) : adminGetSecurityReport()
    p.then((r) => setSecReport(r)).catch(() => {}).finally(() => setCarregandoSec(false))
  }
  useEffect(() => { if (user?.uid) adminGetSecurityReport().then(setSecReport).catch(() => {}) }, [user?.uid])

  const abrirSecurity = () => {
    setView('security')
    if (!secReport || secReport.geradoEmMs == null) carregarSec(false)
    adminMarkSecuritySeen().then(() => setSecReport((r) => (r ? { ...r, naoVisto: false } : r))).catch(() => {})
  }

  const stats = useMemo(() => {
    const total = clientes.length
    const aprovados = clientes.filter((c) => c.status === 'approved').length
    const pendentes = clientes.filter((c) => c.status === 'pending').length
    const travados = clientes.filter((c) => c.status === 'paused' || c.status === 'banned').length
    const risco = clientes.filter((c) => healthDoCliente(c) === 'red').length
    const porPlano = { free: 0, inicial: 0, padrao: 0, pro: 0 }
    clientes.forEach((c) => { const p = c.plano || 'free'; if (porPlano[p] != null) porPlano[p]++ })
    return { total, aprovados, pendentes, travados, risco, porPlano }
  }, [clientes])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(col === 'consumoMes' || col === 'complaintRate' || col === 'ultimoLogin' ? 'desc' : 'asc') }
  }

  const filtrados = useMemo(() => {
    let list = clientes
    const q = busca.trim().toLowerCase()
    if (q) list = list.filter((c) => (c.email || '').toLowerCase().includes(q) || (c.nome || '').toLowerCase().includes(q))
    if (filtro === 'pending' || filtro === 'approved' || filtro === 'paused' || filtro === 'banned') list = list.filter((c) => c.status === filtro)
    else if (filtro === 'risco') list = list.filter((c) => healthDoCliente(c) === 'red')
    else if (['free', 'inicial', 'padrao', 'pro'].includes(filtro)) list = list.filter((c) => (c.plano || 'free') === filtro)
    if (sortBy) {
      const HR = { green: 0, yellow: 1, red: 2 }
      const val = (c) => {
        switch (sortBy) {
          case 'nome': return (c.nome || c.email || '').toLowerCase()
          case 'status': return c.status || ''
          case 'plano': return PLANO_ORDEM.indexOf(c.plano || 'free')
          case 'consumoMes': return Number(c.consumoMes) || 0
          case 'saude': return HR[healthDoCliente(c)] || 0
          case 'complaintRate': return Number(c.complaintRate) || 0
          case 'ultimoLogin': return c.ultimoLogin ? new Date(c.ultimoLogin).getTime() : 0
          default: return 0
        }
      }
      list = [...list].sort((a, b) => { const va = val(a), vb = val(b); if (va < vb) return sortDir === 'asc' ? -1 : 1; if (va > vb) return sortDir === 'asc' ? 1 : -1; return 0 })
    }
    return list
  }, [clientes, busca, filtro, sortBy, sortDir])
  useEffect(() => { setPagina(1) }, [busca, filtro, sortBy, sortDir])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const pageItems = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  const carregarCredito = async (uid) => {
    setCarregandoCredito(true)
    try { setCredito(await adminGetClienteCredito(uid)) }
    catch (e) { toast.error(e?.message || 'Erro ao carregar o histórico de crédito.') }
    finally { setCarregandoCredito(false) }
  }

  const abrirTabCredito = () => {
    setDetTab('credito'); setDetPage(1)
    if (!credito && sel?.uid) carregarCredito(sel.uid)
  }

  const carregarGastos = async (uid) => {
    setCarregandoGastos(true)
    try { setGastos(await adminGetClienteGastos(uid)) }
    catch (e) { toast.error(e?.message || 'Erro ao carregar os gastos.') }
    finally { setCarregandoGastos(false) }
  }

  const abrirTabGastos = () => {
    setDetTab('gastos'); setDetPage(1)
    if (!gastos && sel?.uid) carregarGastos(sel.uid)
  }

  const carregarConectados = async (uid) => {
    setCarregandoConectados(true)
    try { setConectados(await adminGetClienteConectados(uid)) }
    catch (e) { toast.error(e?.message || 'Erro ao carregar conectados.') }
    finally { setCarregandoConectados(false) }
  }

  const abrirTabConectados = () => {
    setDetTab('conectados'); setDetPage(1)
    if (!conectados && sel?.uid) carregarConectados(sel.uid)
  }

  const reenviarTermo = async () => {
    if (!sel?.uid) return
    if (!(await confirm({ title: 'Reenviar Termo de Uso?', message: `O cliente "${sel.nome || sel.email}" vai precisar ACEITAR o termo de novo no próximo acesso pra continuar usando o app.`, confirmLabel: 'Reenviar termo' }))) return
    setReenviandoTermo(true)
    try {
      await adminResetTermos(sel.uid)
      setDetalhe((d) => d ? { ...d, tenant: { ...d.tenant, termos: { ...(d.tenant?.termos || {}), aceito: false } } } : d)
      toast.success('Termo reenviado. O cliente vai reaceitar no próximo acesso.')
    } catch (e) { toast.error(e?.message || 'Erro ao reenviar o termo.') } finally { setReenviandoTermo(false) }
  }

  const abrir = async (c) => {
    setSel(c); setDetalhe(null); setCredito(null); setGastos(null); setConectados(null); setCarregandoDet(true); setDetTab('disparos'); setDetPage(1)
    const ef = planoEfetivo({ plano: c.plano || 'free' })
    setForm({ plano: c.plano || 'free', notas: c.notas || '', limites: { ...ef.limites } })
    try {
      const det = await adminGetClienteDetalhe(c.uid)
      setDetalhe(det)
      const ef2 = planoEfetivo(det.tenant || { plano: c.plano })
      setForm((f) => ({ ...f, plano: det.tenant?.plano || f.plano, notas: det.tenant?.notas ?? f.notas, limites: { ...ef2.limites } }))
    } catch { /* ignore */ } finally { setCarregandoDet(false) }
  }

  const impersonar = async (c) => {
    if (!(await confirm({ title: 'Entrar como este cliente?', message: `Você vai logar como "${c.nome || c.email}". Pra voltar a ser admin, é só sair e logar de novo.`, confirmLabel: 'Entrar como cliente' }))) return
    setImpersonando(true)
    try {
      const { token } = await adminImpersonar(c.uid)
      await signInWithCustomToken(auth, token)
      toast.success('Logado como o cliente. Saia pra voltar a ser admin.')
      navigate('/integracoes')
    } catch (e) { toast.error(e.message || 'Erro ao entrar como cliente.') } finally { setImpersonando(false) }
  }

  const aplicarStatus = async (c, status, labelAcao) => {
    if ((status === 'banned' || status === 'paused') && !(await confirm({ title: `${labelAcao} cliente?`, message: `${labelAcao} "${c.nome || c.email}"? Ele ${status === 'banned' ? 'não poderá mais enviar' : 'fica sem enviar até você reativar'}.`, confirmLabel: labelAcao, danger: true }))) return
    try {
      await adminUpdateCliente(c.uid, { status })
      setClientes((prev) => prev.map((x) => (x.uid === c.uid ? { ...x, status } : x)))
      if (sel?.uid === c.uid) setSel((x) => ({ ...x, status }))
      toast.success(`${c.nome || c.email}: ${STATUS_INFO[status].label}.`)
    } catch (e) { toast.error(e.message || 'Erro.') }
  }

  const salvarPerfil = async () => {
    if (!sel) return
    setSalvando(true)
    try {
      // Só vira OVERRIDE o limite que difere do padrão do plano — assim o cliente herda o plano
      // (e acompanha mudanças futuras nos limites). O que ficar igual ao plano não é salvo.
      const planoDef = PLANOS[form.plano]?.limites || {}
      const limitesOverride = {}
      for (const k of LIMITE_FIELDS) {
        const v = Number(form.limites[k])
        if (Number.isFinite(v) && v !== Number(planoDef[k] ?? 0)) limitesOverride[k] = v
      }
      const patch = { plano: form.plano, notas: form.notas, overrides: { limites: limitesOverride } }
      await adminUpdateCliente(sel.uid, patch)
      setClientes((prev) => prev.map((x) => (x.uid === sel.uid ? { ...x, plano: form.plano, notas: form.notas } : x)))
      toast.success('Cliente atualizado.')
    } catch (e) { toast.error(e.message || 'Erro ao salvar.') } finally { setSalvando(false) }
  }

  const toggleKill = async () => {
    const novo = !enviosPausados
    if (novo && !(await confirm({ title: 'Pausar TODOS os envios?', message: 'Isso trava o envio de e-mail de TODOS os clientes até você religar. Use em emergência.', confirmLabel: 'Pausar tudo', danger: true }))) return
    setTogglingKill(true)
    try { await adminSetKillSwitch(novo); setEnviosPausados(novo); toast.success(novo ? 'Envios pausados globalmente.' : 'Envios religados.') }
    catch (e) { toast.error(e.message || 'Erro.') } finally { setTogglingKill(false) }
  }

  const abrirKiwify = async () => {
    setShowKiwify(true); setKiwifyCfg(null); setStripePlanos([])
    try { const c = await adminGetKiwifyConfig(); setKiwifyCfg(c) } catch (e) { toast.error(e.message || 'Erro ao carregar config') }
    try { const r = await adminStripePlanos(); setStripePlanos(r.planos || []) } catch (_) {}
  }
  // Abre o template de e-mail numa nova aba (HTML renderizado)
  const abrirTemplate = (t) => {
    const doc = t.inlined || emailPreviewDoc(t) || t.html || ''
    if (!doc) { toast('Template sem conteúdo.', { icon: 'ℹ️' }); return }
    try {
      const blob = new Blob([doc], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (_) { toast.error('Não consegui abrir o template.') }
  }

  const toggleInstancia = async (inst) => {
    if (!sel) return
    const nova = !inst.bloqueada
    try {
      await adminSetInstanciaBloqueada(sel.uid, inst.id, nova)
      setDetalhe((d) => ({ ...d, instances: (d.instances || []).map((x) => (x.id === inst.id ? { ...x, bloqueada: nova } : x)) }))
      toast.success(nova ? 'Instância desativada.' : 'Instância reativada.')
    } catch (e) { toast.error(e.message || 'Erro ao alterar instância.') }
  }

  const salvarKiwify = async () => {
    if (!kiwifyCfg) return
    setSavingKiwify(true)
    try {
      await adminSetKiwifyConfig({ fromEmail: kiwifyCfg.fromEmail, fromName: kiwifyCfg.fromName, appUrl: kiwifyCfg.appUrl })
      toast.success('Onboarding salvo.')
      setShowKiwify(false)
    } catch (e) { toast.error(e.message || 'Erro ao salvar') } finally { setSavingKiwify(false) }
  }

  const handleReembolsar = async (c) => {
    if (!c?.uid) return
    if (!(await confirm({ title: 'Reembolsar e voltar pro Free?', message: `Reembolsa a assinatura vigente de "${c.nome || c.email}" na Stripe, cancela a renovação e volta a conta pro Free (desativa as funções dos planos pagos). Não afeta meses já usados.`, confirmLabel: 'Reembolsar', danger: true }))) return
    setReembolsando(true)
    try {
      const r = await adminReembolsarCliente(c.uid)
      if (r.reembolsado) toast.success(`Reembolsado${r.valor != null ? ` R$ ${Number(r.valor).toFixed(2)}` : ''} · conta voltou pro Free.`)
      else toast(`Conta voltou pro Free. Reembolso não feito: ${r.motivo || 'sem pagamento'}.`, { icon: '⚠️' })
      setClientes((prev) => prev.map((x) => (x.uid === c.uid ? { ...x, plano: 'free' } : x)))
      setSel((x) => (x && x.uid === c.uid ? { ...x, plano: 'free' } : x))
      setForm((f) => ({ ...f, plano: 'free', limites: { ...PLANOS.free.limites } }))
      setDetalhe((d) => (d ? { ...d, tenant: { ...(d.tenant || {}), plano: 'free' } } : d))
    } catch (e) { toast.error(e.message || 'Erro ao reembolsar') } finally { setReembolsando(false) }
  }

  const handleRisco = async (c, acao) => {
    if (!c?.uid) return
    if (acao === 'play' && !(await confirm({ title: 'Retomar e assumir o risco?', message: `A conta de "${c.nome || c.email}" foi pausada automaticamente por reclamação/bounce (regra de spam). Ao retomar, você assume o risco: os envios voltam ao normal, mas o sistema continua medindo reclamação/bounce.`, confirmLabel: 'Retomar (assumir risco)' }))) return
    setRiscoLoading(true)
    try {
      const r = await adminSetRiscoConta(c.uid, acao)
      setClientes((prev) => prev.map((x) => (x.uid === c.uid ? { ...x, risco: r.risco } : x)))
      setSel((x) => (x && x.uid === c.uid ? { ...x, risco: r.risco } : x))
      toast.success(acao === 'play' ? 'Conta retomada (risco assumido).' : acao === 'pausar' ? 'Conta pausada.' : 'Voltou ao automático.')
    } catch (e) { toast.error(e.message || 'Erro no setor de risco') } finally { setRiscoLoading(false) }
  }

  if (check2fa) return <PageLoader className="flex-1 min-h-0 py-10" label="Verificando acesso…" />

  if (enrolled2fa && !verificado2fa) return (
    <PageShell badge="Admin · Segurança" title="Verificação em 2 etapas">
      <div className="max-w-sm mx-auto app-panel rounded-2xl p-6 text-center mt-6">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-3"><Lock className="w-6 h-6" /></span>
        <p className="text-sm text-stone-600 mb-4">Digite o código de 6 dígitos do seu app autenticador (Google Authenticator).</p>
        <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter' && !verificando2fa && codigo.length === 6) verificar2fa() }} inputMode="numeric" placeholder="000000" autoFocus className="w-full text-center tracking-[0.4em] font-mono text-xl px-3 py-3 rounded-xl border border-surface-200 outline-none focus:border-primary-400 mb-3" />
        <button onClick={verificar2fa} disabled={verificando2fa || codigo.length !== 6} className="btn-primary w-full min-h-[44px] touch-manipulation">{verificando2fa ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Entrar</button>
      </div>
    </PageShell>
  )

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" label="Carregando clientes…" />

  if (erro) return (
    <PageShell badge="Admin · Torre de comando" title="Torre de comando">
      <div className="app-panel rounded-2xl p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-3" />
        <p className="text-sm text-stone-600 max-w-md mx-auto">{erro}</p>
        <p className="text-xs text-stone-400 mt-2">Se você acabou de subir as funções, aguarde o deploy. Acesso só para o administrador.</p>
      </div>
    </PageShell>
  )

  const StatusBadge = ({ status }) => { const s = STATUS_INFO[status] || STATUS_INFO.approved; return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>{s.label}</span> }
  const Health = ({ c }) => { const h = HEALTH[healthDoCliente(c)]; return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${h.cls}`}><span className={`w-2 h-2 rounded-full ${h.dot}`} /> {h.label}</span> }

  return (
    <PageShell
      badge="Admin · Torre de comando"
      title="Clientes"
      right={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={() => (view === 'security' ? setView('clientes') : abrirSecurity())} className={`relative inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-3.5 min-h-[44px] border transition-colors ${view === 'security' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-surface-200 bg-white text-stone-600 hover:border-rose-300 hover:text-rose-600'}`} title="Fiscalização de risco dos clientes">
            <ShieldAlertIcon className="w-4 h-4" /> {view === 'security' ? 'Ver clientes' : 'Logs Security'}
            {secReport?.naoVisto && view !== 'security' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white animate-pulse" />}
          </button>
          <button onClick={abrirKiwify} className="inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-3.5 min-h-[44px] border border-surface-200 bg-white text-stone-600 hover:border-primary-300 hover:text-primary-600 transition-colors" title="Onboarding Stripe (planos + e-mail de boas-vindas)">
            <ShoppingBag className="w-4 h-4" /> Stripe
          </button>
          <button onClick={() => { setSetupData(null); setSegCode(''); setShowSeg(true) }} className={`inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-3.5 min-h-[44px] border transition-colors ${enrolled2fa ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-surface-200 bg-white text-stone-600 hover:border-primary-300 hover:text-primary-600'}`} title="Segurança / 2FA">
            <KeyRound className="w-4 h-4" /> {enrolled2fa ? '2FA ativo' : '2FA'}
          </button>
          <button onClick={toggleKill} disabled={togglingKill} className={`inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-3.5 min-h-[44px] transition-colors ${enviosPausados ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-white border border-surface-200 text-stone-600 hover:border-rose-300 hover:text-rose-600'}`}>
            {togglingKill ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            {enviosPausados ? 'Envios PAUSADOS — religar' : 'Kill switch'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 sm:gap-5">
      {enviosPausados && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Todos os envios estão pausados pela plataforma (kill switch ligado).
        </div>
      )}

      {view === 'security' ? (
        <SecurityView report={secReport} carregando={carregandoSec} onScan={() => carregarSec(true)} onAbrirCliente={(uid) => { const c = clientes.find((x) => x.uid === uid); if (c) abrir(c) }} />
      ) : (
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Lateral esquerda */}
      <aside className="lg:w-40 xl:w-44 shrink-0 lg:order-1">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard icon={Users} label="Clientes" value={fmtNum(stats.total)} tint="stone" onClick={() => setFiltro('todos')} active={filtro === 'todos'} />
          <StatCard icon={ShieldCheck} label="Aprovados" value={fmtNum(stats.aprovados)} tint="emerald" onClick={() => setFiltro('approved')} active={filtro === 'approved'} />
          <StatCard icon={Crown} label="Free" value={fmtNum(stats.porPlano.free)} tint="stone" onClick={() => setFiltro('free')} active={filtro === 'free'} />
          <StatCard icon={Crown} label="Padrão" value={fmtNum(stats.porPlano.padrao)} tint="sky" onClick={() => setFiltro('padrao')} active={filtro === 'padrao'} />
          <StatCard icon={Crown} label="Pro" value={fmtNum(stats.porPlano.pro)} tint="violet" onClick={() => setFiltro('pro')} active={filtro === 'pro'} />
        </div>
      </aside>
      {/* Lateral direita */}
      <aside className="lg:w-40 xl:w-44 shrink-0 lg:order-3">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard icon={Crown} label="Inicial" value={fmtNum(stats.porPlano.inicial)} tint="emerald" onClick={() => setFiltro('inicial')} active={filtro === 'inicial'} />
          <StatCard icon={Pause} label="Pausados / banidos" value={fmtNum(stats.travados)} tint="amber" onClick={() => setFiltro('paused')} active={filtro === 'paused'} />
          <StatCard icon={TrendingDown} label="Em risco" value={fmtNum(stats.risco)} tint="rose" onClick={() => setFiltro('risco')} active={filtro === 'risco'} />
        </div>
      </aside>

      {/* Meio: tabela */}
      <div className="flex-1 min-w-0 lg:order-2">
      <div className="app-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-surface-100 flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2 text-sm font-semibold text-stone-800 min-w-0"><Users className="w-4 h-4 text-primary-600 shrink-0" /> <span className="truncate">Todos os clientes <span className="text-stone-400 font-normal">({filtrados.length})</span></span></span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={carregar} className="text-xs text-primary-600 hover:underline flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Atualizar</button>
            <Select
              value={filtro}
              onChange={setFiltro}
              searchable={false}
              title="Filtrar clientes"
              trigger={<span className="relative p-1.5 text-stone-500 hover:text-primary-600 inline-flex" title="Filtrar"><Filter className="w-4 h-4" />{filtro !== 'todos' && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary-500" />}</span>}
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'pending', label: 'Pendentes' },
                { value: 'approved', label: 'Aprovados' },
                { value: 'paused', label: 'Pausados' },
                { value: 'banned', label: 'Banidos' },
                { value: 'risco', label: 'Em risco' },
              ]}
            />
            <CollapsibleSearch value={busca} onChange={setBusca} placeholder="Nome ou e-mail" />
          </div>
        </div>

        <div className="overflow-x-auto">
          {filtrados.length === 0 ? (
            <p className="p-8 text-sm text-stone-400 text-center">Nenhum cliente {busca || filtro !== 'todos' ? 'com esses filtros' : 'ainda'}.</p>
          ) : (
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  {[['Cliente', 'nome'], ['Status', 'status'], ['Plano', 'plano'], ['Uso do mês', 'consumoMes'], ['Saúde', 'saude'], ['Reclamação', 'complaintRate'], ['Último acesso', 'ultimoLogin'], ['', '']].map(([h, key], i) => (
                    <th key={i} className="px-4 py-2.5 font-medium text-xs whitespace-nowrap">
                      {key ? (
                        <button onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-stone-700 ${sortBy === key ? 'text-primary-600' : ''}`}>
                          {h} {sortBy === key ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                        </button>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.uid} onClick={() => abrir(c)} className="border-b border-surface-50 hover:bg-surface-50/70 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-stone-800 truncate max-w-[200px]">{c.nome || 'Sem nome'}</div>
                      <div className="text-xs text-stone-400 truncate max-w-[200px]">{c.email || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-2.5 text-stone-600 truncate max-w-[120px]">{PLANOS[c.plano]?.nome || 'Free'}</td>
                    <td className="px-4 py-2.5 text-stone-600 tabular-nums whitespace-nowrap">{fmtNum(c.consumoMes)}{c.cotaMensal ? <span className="text-stone-400"> / {fmtNum(c.cotaMensal)}</span> : ''}</td>
                    <td className="px-4 py-2.5"><Health c={c} /></td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap"><span className={Number(c.complaintRate) >= 0.1 ? 'text-rose-600 font-semibold' : 'text-stone-500'}>{(Number(c.complaintRate) || 0).toFixed(2)}%</span></td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDate(c.ultimoLogin)}</td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {ehAdminCliente(c) ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600" title="Sua conta admin — somente leitura"><Lock className="w-3.5 h-3.5" /> Admin</span>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          {c.status !== 'approved' && <button onClick={() => aplicarStatus(c, 'approved', 'Aprovar')} className="p-1.5 rounded-lg text-stone-400 hover:bg-emerald-50 hover:text-emerald-600" title="Aprovar"><CheckCircle2 className="w-4 h-4" /></button>}
                          {c.status !== 'paused' && c.status !== 'banned' && <button onClick={() => aplicarStatus(c, 'paused', 'Pausar')} className="p-1.5 rounded-lg text-stone-400 hover:bg-orange-50 hover:text-orange-600" title="Pausar"><Pause className="w-4 h-4" /></button>}
                          {c.status !== 'banned' && <button onClick={() => aplicarStatus(c, 'banned', 'Banir')} className="p-1.5 rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600" title="Banir"><Ban className="w-4 h-4" /></button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filtrados.length > POR_PAGINA && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Página {paginaAtual} de {totalPaginas} · {filtrados.length} cliente(s)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
      </div>{/* fim do meio */}
      </div>
      )}
      </div>{/* fim do wrapper */}

      {/* Perfil do cliente */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSel(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-[90vw] max-w-[90vw] h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-4 sm:p-5 border-b border-surface-100">
              <p className="text-sm font-medium text-stone-700 truncate flex-1 min-w-0">{sel.email}</p>
              <div className="flex items-center gap-2 shrink-0"><StatusBadge status={sel.status} /> <Health c={sel} /></div>
              <button onClick={() => setSel(null)} className="p-1 text-stone-400 hover:text-stone-600 shrink-0"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto scroll-y-soft flex-1">
              <div className="grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5 lg:items-start">
                {/* ─── Coluna esquerda: controles ─── */}
                <div className="space-y-4">
                  {/* Métricas (sempre visível) */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-3 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Bounce</p><p className="text-sm font-bold text-stone-700 tabular-nums mt-0.5">{(Number(sel.bounceRate) || 0).toFixed(1)}%</p></div>
                    <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-3 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Reclamação</p><p className={`text-sm font-bold tabular-nums mt-0.5 ${Number(sel.complaintRate) >= 0.1 ? 'text-rose-600' : 'text-stone-700'}`}>{(Number(sel.complaintRate) || 0).toFixed(2)}%</p></div>
                    <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-3 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Leads</p><p className="text-sm font-bold text-stone-700 tabular-nums mt-0.5">{carregandoDet ? '…' : fmtNum(detalhe?.leadsCount)}</p></div>
                  </div>

                  {ehAdminCliente(sel) ? (
                    <div className="rounded-xl border border-primary-200 bg-primary-50/50 text-primary-700 text-xs px-3 py-3 flex items-start gap-2">
                      <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Sua conta admin — <strong>somente leitura</strong>. Você acompanha os dados (reclamações, disparos, templates…), mas não pode banir, pausar nem alterar nada dela.</span>
                    </div>
                  ) : (
                    <>
                      {/* Ações de status */}
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => aplicarStatus(sel, 'approved', 'Aprovar')} disabled={sel.status === 'approved'} className="flex flex-col items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50/60 text-emerald-700 py-2.5 text-xs font-semibold disabled:opacity-40"><CheckCircle2 className="w-4 h-4" /> Aprovar</button>
                        <button onClick={() => aplicarStatus(sel, 'paused', 'Pausar')} disabled={sel.status === 'paused'} className="flex flex-col items-center gap-1 rounded-xl border border-orange-200 bg-orange-50/60 text-orange-700 py-2.5 text-xs font-semibold disabled:opacity-40"><Pause className="w-4 h-4" /> Pausar</button>
                        <button onClick={() => aplicarStatus(sel, 'banned', 'Banir')} disabled={sel.status === 'banned'} className="flex flex-col items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/60 text-rose-700 py-2.5 text-xs font-semibold disabled:opacity-40"><Ban className="w-4 h-4" /> Banir</button>
                      </div>

                      {/* Setor de Risco (auto-pause por reclamação/bounce) */}
                      {(() => {
                        const r = sel.risco || {}
                        const override = !!r.override
                        const pausadoAuto = r.status === 'pausado' && !override
                        if (pausadoAuto) {
                          return (
                            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 space-y-2">
                              <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" /> Pausada pelo Setor de Risco</p>
                              <p className="text-[11px] text-rose-600/90">Motivo: <strong>{r.motivo || 'reclamação/bounce acima do limite'}</strong> (regra de spam). O cliente vê só &quot;Em Análise&quot;.</p>
                              <button onClick={() => handleRisco(sel, 'play')} disabled={riscoLoading} className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 py-2 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50">
                                {riscoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Retomar (assumir risco)
                              </button>
                            </div>
                          )
                        }
                        if (override) {
                          return (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                              <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Risco assumido por você</p>
                              <p className="text-[11px] text-amber-600/90">Envios ativos e continua medindo reclamação/bounce, mas <strong>não pausa sozinho</strong>.</p>
                              <button onClick={() => handleRisco(sel, 'auto')} disabled={riscoLoading} className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white text-stone-600 py-2 text-xs font-semibold hover:bg-stone-50 disabled:opacity-50">
                                {riscoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Voltar ao automático
                              </button>
                            </div>
                          )
                        }
                        return (
                          <button onClick={() => handleRisco(sel, 'pausar')} disabled={riscoLoading} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-surface-200 bg-surface-50/60 text-stone-500 py-2 text-xs font-semibold hover:bg-surface-100 disabled:opacity-50">
                            {riscoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />} Pausar por risco (manual)
                          </button>
                        )
                      })()}

                      {/* Entrar como cliente */}
                      <button onClick={() => impersonar(sel)} disabled={impersonando} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50/60 text-primary-700 hover:bg-primary-100 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50">
                        {impersonando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Entrar como este cliente
                      </button>

                      {/* Plano */}
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1.5 flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> Plano</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {PLANO_ORDEM.map((k) => (
                            <button key={k} onClick={() => setForm((f) => ({ ...f, plano: k, limites: { ...PLANOS[k].limites } }))} className={`rounded-xl border-2 py-2 text-sm font-semibold transition ${form.plano === k ? 'border-primary-500 bg-primary-50/60 text-primary-700' : 'border-surface-200 text-stone-600 hover:border-primary-300'}`}>{PLANOS[k].nome}</button>
                          ))}
                        </div>
                      </div>

                      {/* Limites — só o que diferir do plano vira override; o resto herda. */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-medium text-stone-600">Limites <span className="font-normal text-stone-400">(igual ao plano = herda)</span></label>
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, limites: { ...f.limites, ...PLANOS[f.plano].limites } }))}
                            className="text-[11px] font-medium text-primary-600 hover:text-primary-700"
                          >
                            ↺ Usar limites do plano
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {LIMITE_FIELDS.map((k) => {
                            const padrao = Number(PLANOS[form.plano]?.limites?.[k] ?? 0)
                            const customizado = Number(form.limites[k]) !== padrao
                            return (
                              <div key={k}>
                                <span className="block text-[11px] text-stone-500 mb-0.5">
                                  {LIMITE_LABELS[k]}
                                  {customizado && <span className="ml-1 text-amber-600" title={`Padrão do plano: ${padrao}`}>• custom</span>}
                                </span>
                                <input type="number" min={0} value={form.limites[k] ?? 0} onChange={(e) => setForm((f) => ({ ...f, limites: { ...f.limites, [k]: e.target.value } }))} className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300 tabular-nums" />
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div><label className="block text-xs font-medium text-stone-600 mb-1">Nota interna</label><textarea value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} rows={2} placeholder="Anotações sobre o cliente…" className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300 resize-y" /></div>

                      {/* Termo de Uso */}
                      <div className="rounded-xl border border-surface-200 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-stone-600">Termo de Uso</span>
                          {detalhe?.tenant?.termos?.aceito
                            ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Aceito</span>
                            : <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Pendente</span>}
                        </div>
                        {detalhe?.tenant?.termos?.aceito && (() => {
                          const t = detalhe.tenant.termos
                          const dt = t.aceitoEm?.toDate ? t.aceitoEm.toDate() : t.aceitoEm?.seconds ? new Date(t.aceitoEm.seconds * 1000) : (t.aceitoEm ? new Date(t.aceitoEm) : null)
                          return (
                            <div className="text-[11px] text-stone-500 space-y-0.5">
                              {dt && <p>Em: {dt.toLocaleString('pt-BR')} · v{t.versao || '1'}</p>}
                              <p>IP: <span className="font-mono">{t.ip || '—'}</span></p>
                              <p>Nome: {t.nome || '—'}</p>
                              <p>Doc: {t.documento || '—'}</p>
                              <p>Local: {t.geo?.negado ? <span className="text-amber-600">negado</span> : (t.geo?.lat != null
                                ? <a className="text-primary-600 hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${t.geo.lat},${t.geo.lng}`}>{Number(t.geo.lat).toFixed(4)}, {Number(t.geo.lng).toFixed(4)}</a>
                                : '—')}</p>
                            </div>
                          )
                        })()}
                        <button
                          onClick={reenviarTermo}
                          disabled={reenviandoTermo}
                          className="w-full mt-1 inline-flex items-center justify-center gap-2 text-xs font-semibold rounded-lg px-3 min-h-[38px] border border-amber-200 bg-amber-50/60 text-amber-700 hover:bg-amber-100/60 transition-colors disabled:opacity-50"
                        >
                          {reenviandoTermo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Reenviar termo (obrigar a reaceitar)
                        </button>
                      </div>

                      {/* Reembolso */}
                      {sel?.plano && sel.plano !== 'free' && (
                        <button onClick={() => handleReembolsar(sel)} disabled={reembolsando} className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl px-3.5 min-h-[44px] border border-red-200 bg-red-50/60 text-red-600 hover:bg-red-100/60 transition-colors disabled:opacity-50">
                          {reembolsando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          Reembolsar assinatura vigente → Free
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* ─── Coluna direita: relatórios com abas ─── */}
                <div className="rounded-2xl border border-surface-200 bg-surface-50/40 p-3 flex flex-col lg:min-h-[calc(90vh-9rem)]">
                  <div className="flex flex-wrap gap-0.5 rounded-xl bg-surface-100 p-0.5 self-start mb-3">
                    {[['credito', 'Crédito', Wallet], ['gastos', 'Gastos', Receipt], ['conectados', 'Conectados', Plug], ['disparos', 'Disparos', Mail], ['reclamacoes', 'Reclamações', AlertTriangle], ['whatsapp', 'WhatsApp', Smartphone], ['templates', 'Templates', FileText]].map(([k, lbl, Icon]) => (
                      <button key={k} onClick={() => { if (k === 'credito') abrirTabCredito(); else if (k === 'gastos') abrirTabGastos(); else if (k === 'conectados') abrirTabConectados(); else { setDetTab(k); setDetPage(1) } }} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${detTab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                        <span className="inline-flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {lbl}</span>
                      </button>
                    ))}
                  </div>

                  {carregandoDet ? (
                    <p className="text-xs text-stone-400 py-8 text-center">Carregando…</p>
                  ) : detTab === 'credito' ? (
                    carregandoCredito ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Carregando histórico…</p>
                    ) : !credito ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Sem dados.</p>
                    ) : (
                      <div className="space-y-3">
                        {/* Resumo em tabela (Excel-like) */}
                        <div className="overflow-x-auto rounded-xl border border-surface-200">
                          <table className="w-full text-xs whitespace-nowrap">
                            <thead className="bg-surface-100 text-stone-500">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium">Total gasto</th>
                                <th className="text-left px-3 py-2 font-medium">Reemb./CB</th>
                                <th className="text-left px-3 py-2 font-medium">Plano</th>
                                <th className="text-left px-3 py-2 font-medium">Inst. extras</th>
                                <th className="text-left px-3 py-2 font-medium">Créd. e-mail</th>
                                <th className="text-left px-3 py-2 font-medium">Créd. SMS</th>
                                <th className="text-left px-3 py-2 font-medium">Créd. min</th>
                                <th className="text-left px-3 py-2 font-medium">E-mails env.</th>
                                <th className="text-left px-3 py-2 font-medium">SMS env.</th>
                                <th className="text-left px-3 py-2 font-medium">Min lig.</th>
                                <th className="text-left px-3 py-2 font-medium">Usos IA</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t border-surface-100 tabular-nums">
                                <td className="px-3 py-2 font-semibold text-emerald-700">{fmtBRL(credito.totalGasto)}</td>
                                <td className="px-3 py-2 font-semibold text-rose-600">{fmtBRL(credito.totalReembolsado)}</td>
                                <td className="px-3 py-2 capitalize text-stone-700">{credito.plano}</td>
                                <td className="px-3 py-2 text-stone-700">{credito.saldos.instanciasExtras}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.saldos.emailCreditos)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.saldos.smsCreditos)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.saldos.callMin)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.uso.emailsEnviados)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.uso.smsEnviados)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.uso.ligacaoMin)}</td>
                                <td className="px-3 py-2 text-stone-700">{fmtNum(credito.uso.iaUsadosTotal)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {credito.overrides && Object.keys(credito.overrides).length > 0 && (
                          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">⚠ Limites custom (override) neste cliente: {Object.entries(credito.overrides).map(([k, v]) => `${k}=${v}`).join(', ')}</p>
                        )}

                        {/* Tabela de movimentações (Excel-like) */}
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Movimentações ({credito.movimentos.length})</p>
                          {credito.movimentos.length === 0 ? (
                            <p className="text-xs text-stone-400 py-4 text-center">Nenhuma compra registrada ainda.</p>
                          ) : (
                            <div className="rounded-xl border border-surface-200 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-surface-100 text-stone-500">
                                  <tr>
                                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Data</th>
                                    <th className="text-left px-3 py-2 font-medium">Movimento</th>
                                    <th className="text-right px-3 py-2 font-medium">Qtd</th>
                                    <th className="text-right px-3 py-2 font-medium">Valor</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {credito.movimentos.map((m, i) => {
                                    const meta = MOV_META[m.tipo] || { label: m.tipo, cls: 'text-stone-600' }
                                    return (
                                      <tr key={i} className="border-t border-surface-100">
                                        <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{fmtDateMs(m.emMs)}</td>
                                        <td className="px-3 py-2"><span className={`font-semibold ${meta.cls}`}>{meta.label}</span>{m.descricao && <span className="block text-[10px] text-stone-400">{m.descricao}</span>}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-stone-500">{m.quantidade ?? '—'}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${(m.valor || 0) < 0 ? 'text-rose-600' : 'text-stone-700'}`}>{m.valor != null ? fmtBRL(m.valor) : '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ) : detTab === 'gastos' ? (
                    carregandoGastos ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Calculando custos…</p>
                    ) : !gastos ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Sem dados.</p>
                    ) : (() => {
                      const a = gastos.mesAtual || {}
                      const gm = (gastos.meses || []).slice(0, 6).reverse()
                      const maxV = Math.max(1, ...gm.map((m) => Math.max(m.custoTotal, m.receita)))
                      return (
                        <div className="space-y-3">
                          {/* Mês atual: custo x receita x lucro */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2"><span className="block text-[10px] uppercase tracking-wide text-rose-700/70">Custo/mês (nós)</span><span className="block text-sm font-bold text-rose-700 tabular-nums">{fmtBRL(a.custoTotal)}</span></div>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2"><span className="block text-[10px] uppercase tracking-wide text-emerald-700/70">Receita/mês</span><span className="block text-sm font-bold text-emerald-700 tabular-nums">{fmtBRL(a.receita)}</span></div>
                            <div className={`rounded-xl border px-3 py-2 ${a.lucro >= 0 ? 'border-primary-200 bg-primary-50/50' : 'border-amber-200 bg-amber-50/50'}`}><span className="block text-[10px] uppercase tracking-wide text-stone-500">Lucro/mês</span><span className={`block text-sm font-bold tabular-nums ${a.lucro >= 0 ? 'text-primary-700' : 'text-amber-700'}`}>{fmtBRL(a.lucro)}</span></div>
                          </div>

                          {/* Gráfico custo (vermelho) x receita (verde) por mês */}
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Custo × Receita por mês</p>
                            <div className="rounded-xl border border-surface-200 bg-white p-3">
                              <div className="flex items-end justify-around gap-2 h-32">
                                {gm.length === 0 ? <p className="text-xs text-stone-400 m-auto">Sem histórico ainda.</p> : gm.map((m) => (
                                  <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                                    <div className="w-full flex items-end justify-center gap-1 h-full">
                                      <div className="w-1/2 max-w-[16px] bg-rose-400 rounded-t" style={{ height: `${(m.custoTotal / maxV) * 100}%` }} title={`Custo ${fmtBRL(m.custoTotal)}`} />
                                      <div className="w-1/2 max-w-[16px] bg-emerald-400 rounded-t" style={{ height: `${(m.receita / maxV) * 100}%` }} title={`Receita ${fmtBRL(m.receita)}`} />
                                    </div>
                                    <span className="text-[10px] text-stone-400 tabular-nums">{m.mes.slice(5)}/{m.mes.slice(2, 4)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-stone-500">
                                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400" /> Custo</span>
                                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Receita</span>
                              </div>
                            </div>
                          </div>

                          {/* Breakdown do mês atual por ferramenta */}
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Custo do mês por ferramenta</p>
                            <div className="overflow-x-auto rounded-xl border border-surface-200">
                              <table className="w-full text-xs whitespace-nowrap">
                                <thead className="bg-surface-100 text-stone-500"><tr>
                                  <th className="text-left px-3 py-2 font-medium">Resend (e-mail)</th>
                                  <th className="text-left px-3 py-2 font-medium">Telnyx (SMS)</th>
                                  <th className="text-left px-3 py-2 font-medium">Telnyx (ligação)</th>
                                  <th className="text-left px-3 py-2 font-medium">Grok (IA)</th>
                                  <th className="text-left px-3 py-2 font-medium">Instâncias ({gastos.instanciasQtd})</th>
                                </tr></thead>
                                <tbody><tr className="border-t border-surface-100 tabular-nums text-stone-700">
                                  <td className="px-3 py-2">{fmtBRL(a.custoResend)}</td>
                                  <td className="px-3 py-2">{fmtBRL(a.custoSms)}</td>
                                  <td className="px-3 py-2">{fmtBRL(a.custoCall)}</td>
                                  <td className="px-3 py-2">{fmtBRL(a.custoGrok)}</td>
                                  <td className="px-3 py-2">{fmtBRL(a.custoInst)}</td>
                                </tr></tbody>
                              </table>
                            </div>
                          </div>

                          {/* Histórico mensal (Excel-like) */}
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Histórico mensal</p>
                            <div className="overflow-x-auto rounded-xl border border-surface-200">
                              <table className="w-full text-xs whitespace-nowrap">
                                <thead className="bg-surface-100 text-stone-500"><tr>
                                  <th className="text-left px-3 py-2 font-medium">Mês</th>
                                  <th className="text-right px-3 py-2 font-medium">E-mails</th>
                                  <th className="text-right px-3 py-2 font-medium">SMS</th>
                                  <th className="text-right px-3 py-2 font-medium">Min lig.</th>
                                  <th className="text-right px-3 py-2 font-medium">IA</th>
                                  <th className="text-right px-3 py-2 font-medium">Custo</th>
                                  <th className="text-right px-3 py-2 font-medium">Receita</th>
                                  <th className="text-right px-3 py-2 font-medium">Lucro</th>
                                </tr></thead>
                                <tbody>
                                  {(gastos.meses || []).length === 0 ? (
                                    <tr><td colSpan={8} className="px-3 py-4 text-center text-stone-400">Sem movimentação ainda.</td></tr>
                                  ) : gastos.meses.map((m) => (
                                    <tr key={m.mes} className="border-t border-surface-100 tabular-nums">
                                      <td className="px-3 py-2 text-stone-600">{m.mes}</td>
                                      <td className="px-3 py-2 text-right text-stone-500">{fmtNum(m.emails)}</td>
                                      <td className="px-3 py-2 text-right text-stone-500">{fmtNum(m.sms)}</td>
                                      <td className="px-3 py-2 text-right text-stone-500">{fmtNum(m.callMin)}</td>
                                      <td className="px-3 py-2 text-right text-stone-500">{fmtNum(m.ia)}</td>
                                      <td className="px-3 py-2 text-right text-rose-600 font-medium">{fmtBRL(m.custoTotal)}</td>
                                      <td className="px-3 py-2 text-right text-emerald-700 font-medium">{fmtBRL(m.receita)}</td>
                                      <td className={`px-3 py-2 text-right font-semibold ${m.lucro >= 0 ? 'text-primary-700' : 'text-amber-700'}`}>{fmtBRL(m.lucro)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <p className="text-[10px] text-stone-400">Custos estimados por uso: e-mail {fmtBRL(gastos.custos.email)} · SMS {fmtBRL(gastos.custos.sms)} · min ligação {fmtBRL(gastos.custos.callMin)} · IA {fmtBRL(gastos.custos.ia)} · instância {fmtBRL(gastos.custos.instanciaMes)}/mês. Ajuste conforme suas faturas reais. Custo de instância só entra no mês atual.</p>
                        </div>
                      )
                    })()
                  ) : detTab === 'conectados' ? (
                    carregandoConectados ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Carregando conectados…</p>
                    ) : !conectados ? (
                      <p className="text-xs text-stone-400 py-8 text-center">Sem dados.</p>
                    ) : (() => {
                      const secoes = [
                        { t: 'Domínios de e-mail (nossa conta Resend)', arr: conectados.dominios, linha: (d) => d.nome, tag: (d) => d.status },
                        { t: 'Instâncias WhatsApp', arr: conectados.instancias, linha: (d) => `${d.nome}${d.numero ? ` · ${d.numero}` : ''}`, tag: (d) => (d.conectado ? 'conectado' : 'offline') },
                        { t: 'Chips SMS (nossa conta)', arr: conectados.chips, linha: (d) => d.numero, tag: (d) => `${d.status}${d.principal ? ' · principal' : ''}${d.voz ? ' · voz' : ''}` },
                        { t: 'Telnyx API (conta do cliente / BYO)', arr: conectados.telnyxApi, linha: (d) => `${d.nome}${d.from ? ` · ${d.from}` : ''}`, tag: (d) => (d.principal ? 'principal' : '') },
                        { t: 'Resend API (conta do cliente / BYO)', arr: conectados.resendApi, linha: (d) => `${d.nome}${d.from ? ` · ${d.from}` : ''}`, tag: (d) => (d.principal ? 'principal' : '') },
                        { t: 'Trackers', arr: conectados.trackers, linha: (d) => `${d.nome}${d.loja ? ` · ${d.loja}` : ''}`, tag: (d) => d.status },
                      ]
                      return (
                        <div className="space-y-3">
                          {/* Contadores */}
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                            {[['Domínios', conectados.dominios.length], ['Instâncias', conectados.instancias.length], ['Chips SMS', conectados.chips.length], ['Telnyx API', conectados.telnyxApi.length], ['Resend API', conectados.resendApi.length], ['Trackers', conectados.trackers.length]].map(([lbl, n]) => (
                              <div key={lbl} className="rounded-xl border border-surface-200 bg-white px-2 py-2"><span className="block text-lg font-bold text-stone-800 tabular-nums">{n}</span><span className="block text-[10px] text-stone-400">{lbl}</span></div>
                            ))}
                          </div>
                          {/* Listas por tipo */}
                          {secoes.map((s) => (
                            <div key={s.t}>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">{s.t} ({s.arr.length})</p>
                              {s.arr.length === 0 ? (
                                <p className="text-xs text-stone-400">Nenhum.</p>
                              ) : (
                                <div className="space-y-1">
                                  {s.arr.map((d, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs">
                                      <span className="min-w-0 truncate text-stone-700">{s.linha(d)}</span>
                                      {s.tag(d) && <span className="shrink-0 text-[10px] text-stone-400">{s.tag(d)}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })()
                  ) : detTab === 'whatsapp' ? (
                    <div className="space-y-2">
                      <p className="text-xs text-stone-500">Instâncias de WhatsApp: <strong className="text-stone-700">{(detalhe?.instances || []).length}</strong></p>
                      {(detalhe?.instances || []).length === 0 ? (
                        <p className="text-xs text-stone-400 py-6 text-center">Sem instâncias conectadas.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
                        {(detalhe.instances).map((inst) => {
                          const exp = instExp === inst.id
                          return (
                            <div key={inst.id} className={`rounded-xl border overflow-hidden ${inst.bloqueada ? 'border-rose-200 bg-rose-50/50' : 'border-surface-200 bg-white'}`}>
                              <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <button onClick={() => setInstExp(exp ? '' : inst.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                                  <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${exp ? 'rotate-180' : ''}`} />
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium text-stone-800 truncate">{inst.nome}</span>
                                    <span className="block text-[11px] text-stone-400 truncate">{inst.numero || '—'} · {inst.conectado ? 'Conectado' : 'Offline'}{inst.bloqueada ? ' · DESATIVADA' : ''}</span>
                                  </span>
                                </button>
                                {!ehAdminCliente(sel) && (
                                  <button onClick={() => toggleInstancia(inst)} className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${inst.bloqueada ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>
                                    {inst.bloqueada ? 'Reativar' : 'Desativar'}
                                  </button>
                                )}
                              </div>
                              {exp && (
                                <div className="border-t border-surface-100 p-2.5 bg-surface-50/40">
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Disparos de WhatsApp ({(detalhe?.waDisparos || []).length})</p>
                                  {(detalhe?.waDisparos || []).length === 0 ? (
                                    <p className="text-xs text-stone-400">Nenhum disparo registrado.</p>
                                  ) : (
                                    <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-y-soft">
                                      {detalhe.waDisparos.map((d) => (
                                        <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs">
                                          <span className="min-w-0"><span className="block font-medium text-stone-800 truncate">{d.nome}</span><span className="block text-[10px] text-stone-400">{fmtDateMs(d.createdAt)}{d.status ? ` · ${d.status}` : ''}</span></span>
                                          <span className="text-stone-500 shrink-0 tabular-nums">{d.enviados}/{d.total}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        </div>
                      )}
                    </div>
                  ) : detTab === 'templates' ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">WhatsApp ({(detalhe?.msgTemplates || []).length})</p>
                        {(detalhe?.msgTemplates || []).length === 0 ? <p className="text-xs text-stone-400">Nenhum template.</p> : (
                          <div className="space-y-1.5">
                            {detalhe.msgTemplates.map((t) => (
                              <div key={t.id} className="rounded-xl border border-surface-200 bg-white px-3 py-2">
                                <span className="block text-sm font-medium text-stone-800 truncate">{t.nome}</span>
                                {t.mensagem && <span className="block text-[11px] text-stone-500 whitespace-pre-wrap mt-0.5 max-h-24 overflow-y-auto scroll-y-soft">{t.mensagem}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">E-mail ({(detalhe?.emailTemplates || []).length})</p>
                        {(detalhe?.emailTemplates || []).length === 0 ? <p className="text-xs text-stone-400">Nenhum template.</p> : (
                          <div className="space-y-1.5">
                            {detalhe.emailTemplates.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => abrirTemplate(t)}
                                onMouseEnter={(e) => { setHoverTpl(t); setHoverRect(e.currentTarget.getBoundingClientRect()) }}
                                onMouseLeave={() => setHoverTpl((h) => (h?.id === t.id ? null : h))}
                                className="w-full flex items-center gap-2 rounded-xl border border-surface-200 bg-white px-3 py-2 text-left hover:border-primary-300 transition"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium text-stone-800 truncate">{t.nome}</span>
                                  {t.subject && <span className="block text-[11px] text-stone-400 truncate">Assunto: {t.subject}</span>}
                                </span>
                                {(t.html || t.inlined) && <Eye className="w-3.5 h-3.5 text-stone-300 shrink-0" />}
                                <ExternalLink className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (() => {
                    const PD = 12
                    const lista = detTab === 'disparos' ? (detalhe?.disparos || []) : (detalhe?.reclamacoes || [])
                    const totalP = Math.max(1, Math.ceil(lista.length / PD))
                    const pageSafe = Math.min(detPage, totalP)
                    const items = lista.slice((pageSafe - 1) * PD, pageSafe * PD)
                    if (lista.length === 0) {
                      return <p className="text-xs text-stone-400 py-8 text-center">{detTab === 'disparos' ? 'Sem disparos por aqui.' : 'Tudo limpo por aqui.'}</p>
                    }
                    return (
                      <div className="flex-1 flex flex-col">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 flex-1 content-start">
                          {detTab === 'disparos'
                            ? items.map((d, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-surface-200 bg-white px-3 py-2 text-xs">
                                <span className="min-w-0"><span className="block font-medium text-stone-800 truncate">{d.nome}</span><span className="block text-[11px] text-stone-400">{fmtDateMs(d.createdAt)}</span></span>
                                <span className="text-stone-500 shrink-0 tabular-nums">{d.enviados}/{d.total} · <span className="text-blue-600">{d.aberturas} ab</span></span>
                              </div>
                            ))
                            : items.map((r, i) => (
                              <div key={i} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${r.tipo === 'complained' ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/50'}`}>
                                <span className="min-w-0">
                                  <span className="block font-medium text-stone-800 truncate">{r.email}</span>
                                  <span className="block text-[11px] text-stone-400 truncate">{r.motivo || (r.tipo === 'complained' ? 'Marcado como spam' : 'E-mail rejeitado')}{r.bounceTipo ? ` · ${r.bounceTipo}` : ''} · {fmtDateMs(r.createdAt)}</span>
                                </span>
                                <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${r.tipo === 'complained' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{r.tipo === 'complained' ? 'Reclamação' : 'Bounce'}</span>
                              </div>
                            ))}
                        </div>
                        {totalP > 1 && (
                          <div className="flex items-center justify-between gap-2 pt-3 mt-auto">
                            <span className="text-[11px] text-stone-500">Página {pageSafe} de {totalP} · {lista.length}</span>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setDetPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="px-2 py-1.5 rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setDetPage((p) => Math.min(totalP, p + 1))} disabled={pageSafe >= totalP} className="px-2 py-1.5 rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-surface-100 flex justify-end gap-2">
              <button onClick={() => setSel(null)} className="btn-secondary text-sm min-h-[44px]">Fechar</button>
              {!ehAdminCliente(sel) && <button onClick={salvarPerfil} disabled={salvando} className="btn-primary text-sm min-h-[44px] touch-manipulation">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>}
            </div>
          </div>
        </div>
      )}

      {/* Prévia flutuante do template de e-mail (hover) */}
      {hoverTpl && hoverRect && (hoverTpl.html || hoverTpl.inlined) && (() => {
        const PW = 360, vw = window.innerWidth, vh = window.innerHeight
        const PH = Math.min(520, vh - 16)
        let left = hoverRect.left - 12 - PW
        if (left < 8) left = hoverRect.right + 12
        left = Math.max(8, Math.min(left, vw - PW - 8))
        let top = hoverRect.top + hoverRect.height / 2 - PH / 2
        top = Math.max(8, Math.min(top, vh - PH - 8))
        return createPortal(
          <div className="fixed z-[90] rounded-xl border border-surface-200 bg-white shadow-2xl overflow-hidden pointer-events-none" style={{ left, top, width: PW, height: PH }}>
            <iframe srcDoc={emailPreviewDoc(hoverTpl) || hoverTpl.inlined} className="w-full h-full border-0" title="Prévia do template" />
          </div>,
          document.body
        )
      })()}

      {/* Modal: Segurança / 2FA */}
      {showSeg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowSeg(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><KeyRound className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800">Segurança · Verificação em 2 etapas</h3>
              <button onClick={() => setShowSeg(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {enrolled2fa ? (
              <>
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2.5 text-sm font-medium"><ShieldCheck className="w-4 h-4" /> 2FA está ativo nesta conta.</div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Para desativar, digite um código do app</label>
                  <input value={segCode} onChange={(e) => setSegCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" className="w-full text-center tracking-[0.3em] font-mono px-3 py-2.5 rounded-xl border border-surface-200 outline-none focus:border-primary-400" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowSeg(false)} className="btn-secondary text-sm min-h-[44px]">Fechar</button>
                  <button onClick={desativar2fa} disabled={segBusy || segCode.length !== 6} className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5">{segBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Desativar 2FA</button>
                </div>
              </>
            ) : !setupData ? (
              <>
                <p className="text-sm text-stone-500 leading-relaxed">Adicione uma camada extra: além do login, vai pedir um código de 6 dígitos do <strong>Google Authenticator</strong> no seu celular.</p>
                <div className="flex justify-end">
                  <button onClick={iniciarSetup} disabled={segBusy} className="btn-primary text-sm min-h-[44px] touch-manipulation">{segBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />} Ativar 2FA</button>
                </div>
              </>
            ) : (
              <>
                <ol className="text-sm text-stone-600 space-y-1.5 list-decimal list-inside">
                  <li>Abra o <strong>Google Authenticator</strong> → <strong>+</strong> → <strong>Inserir chave de configuração</strong>.</li>
                  <li>Nome: <strong>Autsend</strong>. Cole a chave abaixo. Tipo: <strong>Baseado em tempo</strong>.</li>
                  <li>Digite o código de 6 dígitos que aparecer pra confirmar.</li>
                </ol>
                <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Chave de configuração</p>
                  <code className="block font-mono text-sm text-stone-800 break-all select-all">{setupData.secret}</code>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Código do app</label>
                  <input value={segCode} onChange={(e) => setSegCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" autoFocus className="w-full text-center tracking-[0.3em] font-mono px-3 py-2.5 rounded-xl border border-surface-200 outline-none focus:border-primary-400" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setSetupData(null)} className="btn-secondary text-sm min-h-[44px]">Voltar</button>
                  <button onClick={confirmarSetup} disabled={segBusy || segCode.length !== 6} className="btn-primary text-sm min-h-[44px] touch-manipulation">{segBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Confirmar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Configuração Kiwify (onboarding) */}
      {showKiwify && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowKiwify(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-5 border-b border-surface-100">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><ShoppingBag className="w-4 h-4" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-stone-800">Onboarding Stripe</h3>
              </div>
              <button onClick={() => setShowKiwify(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {!kiwifyCfg ? (
              <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-stone-400" /></div>
            ) : (
              <>
                <div className="p-5 space-y-4 overflow-y-auto scroll-y-soft">
                  {/* Planos do Stripe (read-only) */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1.5">Planos (Stripe)</label>
                    {stripePlanos.length === 0 ? (
                      <p className="text-xs text-stone-400 py-2">Carregando do Stripe… (se ficar vazio, confira os STRIPE_PRICE_* no .env do servidor)</p>
                    ) : (
                      <div className="space-y-2">
                        {stripePlanos.map((p) => (
                          <div key={p.plano} className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50/50 px-3 py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 shrink-0">{p.plano === 'padrao' ? 'Padrão' : p.plano.charAt(0).toUpperCase() + p.plano.slice(1)}</span>
                            <span className="min-w-0 flex-1 text-sm text-stone-700 truncate" title={p.priceId || ''}>
                              {p.erro ? <span className="text-red-500">{p.erro}</span> : (p.produtoNome || '—')}
                              {p.priceId && <span className="block text-[10px] text-stone-400 truncate font-mono">{p.priceId}</span>}
                            </span>
                            {!p.erro && p.valor != null && (
                              <span className="text-sm font-semibold text-stone-800 shrink-0 tabular-nums">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: p.moeda || 'BRL' }).format(p.valor)}{p.intervalo ? `/${p.intervalo === 'month' ? 'mês' : p.intervalo}` : ''}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Remetente das boas-vindas */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-stone-600 mb-1">E-mail remetente (boas-vindas)</label>
                      <input value={kiwifyCfg.fromEmail} onChange={(e) => setKiwifyCfg((c) => ({ ...c, fromEmail: e.target.value }))} placeholder="no-reply@seudominio.com" className="w-full px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-stone-600 mb-1">Nome do remetente</label>
                      <input value={kiwifyCfg.fromName} onChange={(e) => setKiwifyCfg((c) => ({ ...c, fromName: e.target.value }))} placeholder="Autsend" className="w-full px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Link do app (no e-mail)</label>
                    <input value={kiwifyCfg.appUrl} onChange={(e) => setKiwifyCfg((c) => ({ ...c, appUrl: e.target.value }))} placeholder="https://autsend.com.br" className="w-full px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm" />
                  </div>
                </div>

                <div className="p-4 border-t border-surface-100 flex justify-end gap-2">
                  <button onClick={() => setShowKiwify(false)} className="btn-secondary text-sm min-h-[44px]">Fechar</button>
                  <button onClick={salvarKiwify} disabled={savingKiwify} className="btn-primary text-sm min-h-[44px]">{savingKiwify ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}

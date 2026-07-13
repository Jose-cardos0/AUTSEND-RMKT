import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import {
  getLeads,
  getEmailEvents,
  getFunnelSends,
  getEmailFunnels,
  getWhatsappFunnels,
  getMessageLogs,
  getProductGroups,
  getNichos,
  saveNicho,
  deleteNicho,
  updateLeadStatus,
  deleteLead,
} from '../lib/firestore'
import { KIWIFY_EVENTS } from '../lib/constants'
import { lojaByKey, LOJAS } from '../lib/lojas'
import { resolverNicho, contatosParaExcel, CRITERIO_LABEL } from '../lib/nichos'
import PageShell from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import Select from '../components/Select'
import CollapsibleSearch from '../components/CollapsibleSearch'
import WhatsAppIcon from '../components/WhatsAppIcon'
import { useConfirm } from '../components/ConfirmDialog'
import {
  Users, Mail, MousePointerClick, Eye, ShoppingBag, DollarSign, TrendingUp,
  Trophy, Flame, Trash2, Pencil, RotateCcw, AlertTriangle, X, ChevronLeft, ChevronRight, Package, CheckCircle2, Circle, Calendar, Loader2, Download,
  Layers, Plus, ChevronDown, ImagePlus, Filter,
} from 'lucide-react'

const POR_PAGINA = 12

const eventoLabel = (id) => KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id
const CUR_SYM = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£', ARS: 'AR$', MXN: 'MX$' }
// Formata respeitando a moeda do lead (o valor vem cru do webhook; cada plataforma usa a sua).
const fmtMoney = (n, moeda) => {
  const num = Number(n) || 0
  const cur = String(moeda || '').toUpperCase().trim()
  const sym = CUR_SYM[cur] || (cur.length === 3 ? cur + ' ' : 'R$')
  return `${sym} ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtDate = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null
  return d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
}
// Valor líquido do contato = compras − reembolsos/chargebacks (>= 0).
const gastoLiquido = (c) => Math.max(0, (c.totalGasto || 0) - (c.estornoValor || 0))
function parseValor(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[R$\s]/gi, '')
  if (!s) return 0
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function StatCard({ icon: Icon, label, value, tint = 'stone', red = false }) {
  const tints = {
    stone: 'text-stone-400',
    emerald: 'text-emerald-500',
    primary: 'text-primary-500',
    violet: 'text-violet-500',
  }
  return (
    <div className={`relative overflow-hidden rounded-2xl p-4 ${red ? 'bg-rose-50 border border-rose-200' : 'app-panel'}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wider ${red ? 'text-rose-500' : 'text-stone-400'}`}>{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${red ? 'text-rose-700' : 'text-stone-800'}`}>{value}</p>
      <Icon className={`pointer-events-none absolute -right-3 -bottom-4 w-20 h-20 opacity-[0.12] ${red ? 'text-rose-500' : tints[tint]}`} strokeWidth={1.5} />
    </div>
  )
}

export default function BancoLeads() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [emailEvents, setEmailEvents] = useState([])
  const [funnelSends, setFunnelSends] = useState([])
  const [emailFunnelIds, setEmailFunnelIds] = useState(new Set())
  const [whatsFunnelIds, setWhatsFunnelIds] = useState(new Set())
  const [messageLogs, setMessageLogs] = useState([])
  const [productGroups, setProductGroups] = useState([])
  const [editando, setEditando] = useState(null) // contato em edição
  const [editForm, setEditForm] = useState({ nome: '', email: '', telefone: '' })
  const [editCompras, setEditCompras] = useState([]) // [{id, valor}] valores editáveis
  const [salvandoEdit, setSalvandoEdit] = useState(false)
  const [showExcel, setShowExcel] = useState(false)
  // Nichos
  const [view, setView] = useState('leads') // 'leads' | 'nichos'
  const [nichos, setNichos] = useState([])
  const [showCriarNicho, setShowCriarNicho] = useState(false)
  const [nichoForm, setNichoForm] = useState({ nome: '', imagem: '', tipo: 'fixo', loja: '' })
  const [salvandoNicho, setSalvandoNicho] = useState(false)
  const [nichoExpandido, setNichoExpandido] = useState(null)
  const [nichoExcel, setNichoExcel] = useState(null) // nicho para escolher formato do excel

  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [sort, setSort] = useState({ key: 'ultima', dir: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState(new Set())
  const [detalhe, setDetalhe] = useState(null)
  const [excluindo, setExcluindo] = useState(false)

  const carregar = () => {
    if (!user?.uid) return
    setLoading(true)
    Promise.all([
      getLeads(user.uid),
      getEmailEvents(user.uid),
      getFunnelSends(user.uid),
      getEmailFunnels(user.uid),
      getWhatsappFunnels(user.uid),
      getMessageLogs(user.uid),
      getProductGroups(user.uid),
      getNichos(user.uid),
    ])
      .then(([lds, evs, sends, efs, wfs, mlogs, pgs, nch]) => {
        setLeads(lds)
        setEmailEvents(evs)
        setFunnelSends(sends)
        setEmailFunnelIds(new Set(efs.map((f) => f.id)))
        setWhatsFunnelIds(new Set(wfs.map((f) => f.id)))
        setMessageLogs(mlogs)
        setProductGroups(pgs)
        setNichos(nch)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [user?.uid])

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  // Mapa: produto (nome ou id, minúsculo) -> chaves das lojas (dos grupos de produtos).
  const produtoLojas = useMemo(() => {
    const m = new Map()
    for (const g of productGroups) {
      const lojas = g.lojas || []
      if (!lojas.length) continue
      for (const p of g.produtos || []) {
        const k = String(p).toLowerCase().trim()
        if (!k) continue
        if (!m.has(k)) m.set(k, new Set())
        lojas.forEach((l) => m.get(k).add(l))
      }
    }
    return m
  }, [productGroups])

  // ── Agrega os leads por contato — MESMA PESSOA se compartilha e-mail OU telefone ──
  // (union-find transitivo: e-mail A ~ telefone P ~ e-mail B → tudo o mesmo lead).
  const contatos = useMemo(() => {
    const map = new Map()
    const norm = { email: (e) => (e || '').trim().toLowerCase(), tel: (t) => (t || '').replace(/\D/g, '') }
    // Union-find sobre os identificadores (e:email / p:telefone)
    const parent = new Map()
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
    const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
    const union = (a, b) => { add(a); add(b); parent.set(find(a), find(b)) }
    for (const l of leads) {
      const e = norm.email(l.email) ? 'e:' + norm.email(l.email) : null
      const p = norm.tel(l.telefone) ? 'p:' + norm.tel(l.telefone) : null
      if (e) add(e)
      if (p) add(p)
      if (e && p) union(e, p)
    }
    const keyOf = (l) => {
      const e = norm.email(l.email) ? 'e:' + norm.email(l.email) : null
      const p = norm.tel(l.telefone) ? 'p:' + norm.tel(l.telefone) : null
      if (e) return find(e)
      if (p) return find(p)
      return 'id:' + l.id
    }
    for (const l of leads) {
      const key = keyOf(l)
      if (!key) continue
      let a = map.get(key)
      if (!a) {
        a = { key, nome: '', email: '', telefone: '', produtos: new Set(), produtoIds: new Set(), eventos: [], compras: [], totalGasto: 0, estornoValor: 0, moeda: '', leadIds: [], whats: false, mail: false, clicou: false, abriu: false, opens: 0, clicks: 0, ultima: 0 }
        map.set(key, a)
      }
      a.leadIds.push(l.id)
      if (l.nome && !a.nome) a.nome = l.nome
      if (l.email && !a.email) a.email = l.email
      if (l.telefone && !a.telefone) a.telefone = l.telefone
      if (l.produto) a.produtos.add(l.produto)
      if (l.produtoId) a.produtoIds.add(l.produtoId)
      a.eventos.push({ evento: l.evento, produto: l.produto, valor: l.valor, createdAt: l.createdAt })
      const t = l.createdAt?.toMillis?.() ?? l.createdAt ?? 0
      if (t > a.ultima) a.ultima = t
      if (l.status === 'enviado') a.whats = true
      if (l.moeda && !a.moeda) a.moeda = l.moeda
      if (l.evento === 'order_status.purchase_approved') {
        const val = parseValor(l.valor)
        a.compras.push({ id: l.id, produto: l.produto, valor: val, valorRaw: l.valor, moeda: l.moeda, createdAt: l.createdAt })
        a.totalGasto += val
      }
      if (l.evento === 'order_status.refund' || l.evento === 'order_status.chargeback') {
        a.estornoValor += parseValor(l.valor)
      }
    }
    // Resolve um contato agregado a partir de um e-mail/telefone (respeitando o union-find).
    const contatoPorEmail = (email) => { const e = norm.email(email); if (!e) return null; const tok = 'e:' + e; return parent.has(tok) ? map.get(find(tok)) : null }
    const contatoPorTel = (tel) => { const t = norm.tel(tel); if (!t) return null; const tok = 'p:' + t; return parent.has(tok) ? map.get(find(tok)) : null }
    // eventos de e-mail (abriu/clicou = e-mail enviado)
    for (const e of emailEvents) {
      const a = contatoPorEmail(e.email)
      if (!a) continue
      a.mail = true
      if (e.tipo === 'opened') { a.abriu = true; a.opens++ }
      if (e.tipo === 'clicked') { a.clicou = true; a.clicks++ }
    }
    // envios de funil (canal pelo tipo do funil)
    for (const s of funnelSends) {
      if (emailFunnelIds.has(s.funnelId)) { const a = contatoPorEmail(s.contato?.email); if (a) a.mail = true }
      if (whatsFunnelIds.has(s.funnelId)) { const a = contatoPorTel(s.contato?.telefone); if (a) a.whats = true }
    }
    // logs de mensagem (WhatsApp)
    for (const m of messageLogs) {
      const a = contatoPorTel(m.telefone || m.numero)
      if (a) a.whats = true
    }
    return [...map.values()].map((a) => {
      const lojas = new Set()
      for (const p of a.produtos) { const s = produtoLojas.get(String(p).toLowerCase().trim()); if (s) s.forEach((k) => lojas.add(k)) }
      for (const id of a.produtoIds) { const s = produtoLojas.get(String(id).toLowerCase().trim()); if (s) s.forEach((k) => lojas.add(k)) }
      const temChargeback = a.eventos.some((e) => e.evento === 'order_status.chargeback')
      const temRefund = a.eventos.some((e) => e.evento === 'order_status.refund')
      const estorno = temChargeback ? 'chargeback' : temRefund ? 'refund' : null
      // Se o evento de estorno não trouxe valor, estima pelo total das compras.
      const estornoValor = estorno ? (a.estornoValor > 0 ? Math.min(a.estornoValor, a.totalGasto || a.estornoValor) : a.totalGasto) : 0
      return {
        ...a,
        produtos: [...a.produtos],
        produtoIds: [...a.produtoIds],
        lojas: [...lojas],
        estorno,
        estornoValor,
        comprou: a.compras.length > 0,
        engajamento: a.opens + a.clicks,
      }
    })
  }, [leads, emailEvents, funnelSends, emailFunnelIds, whatsFunnelIds, messageLogs, produtoLojas])

  // ── Métricas gerais ──
  const stats = useMemo(() => {
    const total = contatos.length
    const compradores = contatos.filter((c) => c.comprou).length
    const faturamento = contatos.reduce((s, c) => s + c.totalGasto, 0)
    const totalEstornos = contatos.reduce((s, c) => s + (c.estornoValor || 0), 0)
    const fatLiquido = faturamento - totalEstornos
    const conversao = total > 0 ? Math.round((compradores / total) * 100) : 0
    // Moeda predominante entre os compradores (o faturamento soma valores crus; ver aviso).
    const cnt = {}
    contatos.forEach((c) => { if (c.comprou && c.moeda) cnt[c.moeda] = (cnt[c.moeda] || 0) + 1 })
    const moeda = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    return { total, compradores, faturamento, totalEstornos, fatLiquido, conversao, moeda }
  }, [contatos])

  const topFaturamento = useMemo(() => [...contatos].filter((c) => c.totalGasto > 0).sort((a, b) => gastoLiquido(b) - gastoLiquido(a) || b.totalGasto - a.totalGasto).slice(0, 5), [contatos])
  const topEngajados = useMemo(() => [...contatos].filter((c) => c.engajamento > 0).sort((a, b) => b.engajamento - a.engajamento).slice(0, 5), [contatos])

  // ── Filtro + busca + ordenação ──
  const filtrados = useMemo(() => {
    let list = contatos
    const q = busca.trim().toLowerCase()
    if (q) list = list.filter((c) => (c.nome || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.telefone || '').includes(q) || c.produtos.some((p) => (p || '').toLowerCase().includes(q)))
    if (filtro === 'compradores') list = list.filter((c) => c.comprou)
    else if (filtro === 'nao_compradores') list = list.filter((c) => !c.comprou)
    else if (filtro === 'estornados') list = list.filter((c) => c.estorno)
    else if (filtro === 'clicaram') list = list.filter((c) => c.clicou)
    else if (filtro === 'whats') list = list.filter((c) => c.whats)
    else if (filtro === 'email') list = list.filter((c) => c.mail)
    const val = (c) => {
      switch (sort.key) {
        case 'nome': return (c.nome || c.email || '').toLowerCase()
        case 'produto': return (c.produtos[0] || '').toLowerCase()
        case 'comprou': return c.totalGasto
        case 'engajamento': return c.engajamento
        case 'ultima': return c.ultima
        default: return 0
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return sort.dir === 'asc' ? -1 : 1
      if (va > vb) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [contatos, busca, filtro, sort])

  useEffect(() => { setPagina(1) }, [busca, filtro, sort])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const pageItems = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  // Master check = TODOS os filtrados (todas as páginas), não só a página.
  const todosSelecionados = filtrados.length > 0 && filtrados.every((c) => selecionados.has(c.key))
  const toggleSel = (key) => setSelecionados((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleSelTodos = () => setSelecionados((prev) => {
    const n = new Set(prev)
    if (todosSelecionados) filtrados.forEach((c) => n.delete(c.key))
    else filtrados.forEach((c) => n.add(c.key))
    return n
  })
  const selecionadosContatos = useMemo(() => contatos.filter((c) => selecionados.has(c.key)), [contatos, selecionados])

  // ── Exportar Excel (WhatsApp: número,nome · E-mail: email,nome) ──
  const baixarExcel = (tipo) => {
    const alvos = selecionadosContatos.length > 0 ? selecionadosContatos : filtrados
    const rows = []
    if (tipo === 'whatsapp') {
      for (const c of alvos) { const tel = (c.telefone || '').replace(/\D/g, ''); if (tel) rows.push([tel, c.nome || '']) }
    } else {
      for (const c of alvos) { const em = (c.email || '').trim(); if (em) rows.push([em, c.nome || '']) }
    }
    if (rows.length === 0) { toast.error(tipo === 'whatsapp' ? 'Nenhum contato com telefone.' : 'Nenhum contato com e-mail.'); return }
    const ws = XLSX.utils.aoa_to_sheet([tipo === 'whatsapp' ? ['Número', 'Nome'] : ['E-mail', 'Nome'], ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'whatsapp' ? 'WhatsApp' : 'E-mail')
    XLSX.writeFile(wb, `leads_${tipo}_${rows.length}.xlsx`)
    setShowExcel(false)
    toast.success(`${rows.length} contato(s) exportado(s).`)
  }

  // ── Nichos ──
  const onNichoImg = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const max = 220
        let { width, height } = img
        if (width > height) { if (width > max) { height = (height * max) / width; width = max } }
        else if (height > max) { width = (width * max) / height; height = max }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        setNichoForm((f) => ({ ...f, imagem: canvas.toDataURL('image/png') }))
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const criarNicho = async () => {
    const nome = nichoForm.nome.trim()
    if (!nome) { toast.error('Dê um nome ao nicho.'); return }
    setSalvandoNicho(true)
    try {
      const docData = { nome, imagem: nichoForm.imagem || '' }
      if (nichoForm.tipo === 'dinamico') {
        docData.tipo = 'dinamico'
        docData.criterio = { base: filtro === 'todos' || filtro === 'compradores' || filtro === 'nao_compradores' || filtro === 'estornados' ? filtro : 'todos', loja: nichoForm.loja || '' }
      } else {
        docData.tipo = 'snapshot'
        const alvos = selecionadosContatos.length > 0 ? selecionadosContatos : filtrados
        docData.contatos = alvos.map((c) => ({ nome: c.nome || '', email: c.email || '', telefone: c.telefone || '', produto: c.produtos[0] || '' }))
      }
      await saveNicho(user.uid, null, docData)
      toast.success(`Nicho "${nome}" criado.`)
      setShowCriarNicho(false)
      setNichoForm({ nome: '', imagem: '', tipo: 'fixo', loja: '' })
      setSelecionados(new Set())
      setNichos(await getNichos(user.uid))
      setView('nichos')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar nicho.')
    } finally {
      setSalvandoNicho(false)
    }
  }

  const excluirNicho = async (n) => {
    if (!(await confirm({ title: 'Excluir nicho?', message: `Apagar o nicho "${n.nome}"? Os leads NÃO são apagados, só o nicho.`, confirmLabel: 'Excluir', danger: true }))) return
    try { await deleteNicho(user.uid, n.id); setNichos((prev) => prev.filter((x) => x.id !== n.id)); toast.success('Nicho excluído.') } catch (err) { toast.error(err.message || 'Erro ao excluir.') }
  }

  const removerContatoNicho = async (n, idx) => {
    const contatos = (n.contatos || []).filter((_, i) => i !== idx)
    setNichos((prev) => prev.map((x) => (x.id === n.id ? { ...x, contatos } : x)))
    try { await saveNicho(user.uid, n.id, { contatos }) } catch (err) { toast.error(err.message || 'Erro ao salvar.') }
  }

  const baixarExcelNicho = (n, tipo) => {
    const contatos = resolverNicho(n, leads, produtoLojas)
    const rows = contatosParaExcel(contatos, tipo)
    if (rows.length === 0) { toast.error(tipo === 'whatsapp' ? 'Nenhum contato com telefone.' : 'Nenhum contato com e-mail.'); return }
    const ws = XLSX.utils.aoa_to_sheet([tipo === 'whatsapp' ? ['Número', 'Nome'] : ['E-mail', 'Nome'], ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'whatsapp' ? 'WhatsApp' : 'E-mail')
    XLSX.writeFile(wb, `nicho_${(n.nome || 'nicho').replace(/[^a-z0-9]+/gi, '_')}_${tipo}_${rows.length}.xlsx`)
    setNichoExcel(null)
    toast.success(`${rows.length} contato(s) exportado(s).`)
  }

  const excluirSelecionados = async () => {
    const alvos = contatos.filter((c) => selecionados.has(c.key))
    if (alvos.length === 0) return
    const totalDocs = alvos.reduce((s, c) => s + c.leadIds.length, 0)
    if (!(await confirm({ title: 'Excluir leads?', message: `Isso apaga ${alvos.length} lead(s) e todo o histórico deles (${totalDocs} registro(s)). Não dá pra desfazer.`, confirmLabel: 'Excluir', danger: true }))) return
    setExcluindo(true)
    try {
      for (const c of alvos) for (const id of c.leadIds) await deleteLead(user.uid, id)
      toast.success(`${alvos.length} lead(s) excluído(s).`)
      setSelecionados(new Set())
      setDetalhe(null)
      carregar()
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const excluirUm = async (c) => {
    if (!(await confirm({ title: 'Excluir lead?', message: `Apagar ${c.nome || c.email || c.telefone || 'este lead'} e seu histórico (${c.leadIds.length} registro(s))?`, confirmLabel: 'Excluir', danger: true }))) return
    try {
      for (const id of c.leadIds) await deleteLead(user.uid, id)
      toast.success('Lead excluído.')
      setDetalhe(null)
      carregar()
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir.')
    }
  }

  const abrirEdicao = (c) => {
    setEditForm({ nome: c.nome || '', email: c.email || '', telefone: c.telefone || '' })
    setEditCompras((c.compras || []).map((cp) => ({ id: cp.id, produto: cp.produto, valor: String(cp.valor ?? '') })))
    setEditando(c)
  }
  const salvarEdicao = async () => {
    if (!editando) return
    setSalvandoEdit(true)
    try {
      const patch = { nome: editForm.nome.trim(), email: editForm.email.trim(), telefone: editForm.telefone.replace(/\D/g, '') }
      for (const id of editando.leadIds) await updateLeadStatus(user.uid, id, patch)
      // valores das compras (corrigir valor errado)
      for (const cp of editCompras) {
        if (!cp.id) continue
        await updateLeadStatus(user.uid, cp.id, { valor: String(cp.valor).trim() })
      }
      toast.success('Lead atualizado.')
      setEditando(null)
      setDetalhe(null)
      carregar()
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar.')
    } finally {
      setSalvandoEdit(false)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const Canais = ({ c }) => (
    <span className="inline-flex items-center gap-1.5">
      {c.whats && <span title="WhatsApp enviado"><WhatsAppIcon className="w-4 h-4 text-[#25D366]" /></span>}
      {c.mail && <Mail title="E-mail enviado" className="w-4 h-4 text-primary-600" />}
      {!c.whats && !c.mail && <span className="text-xs text-stone-300">—</span>}
    </span>
  )

  const LojaLogos = ({ lojas, size = 'h-5' }) => (
    <span className="inline-flex items-center gap-1">
      {(lojas || []).map((k) => { const l = lojaByKey(k); return l ? <img key={k} src={l.logo} alt={l.nome} title={l.nome} className={`${size} w-auto max-w-[26px] object-contain`} /> : null })}
    </span>
  )

  const EstornoBadge = ({ tipo, className = '' }) => tipo ? (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tipo === 'chargeback' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'} ${className}`}>
      {tipo === 'chargeback' ? <AlertTriangle className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
      {tipo === 'chargeback' ? 'Chargeback' : 'Reembolso'}
    </span>
  ) : null

  // Valor exibido: sem estorno = total; parcial = líquido; total reembolsado = valor riscado em vermelho.
  const GastoValor = ({ c, withIcon = false, plain = false }) => {
    const liq = gastoLiquido(c)
    const full = c.estorno && liq <= 0
    if (full) return <span className="inline-flex items-center gap-1 text-rose-600 line-through font-semibold">{withIcon && <RotateCcw className="w-3.5 h-3.5" />}{fmtMoney(c.totalGasto, c.moeda)}</span>
    const valor = c.estorno ? liq : c.totalGasto
    return <span className={`inline-flex items-center gap-1 font-semibold ${plain ? 'text-stone-700' : 'text-emerald-700'}`}>{withIcon && <CheckCircle2 className="w-3.5 h-3.5" />}{fmtMoney(valor, c.moeda)}</span>
  }

  const RankItem = ({ c, i, right }) => (
    <button onClick={() => setDetalhe(c)} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-surface-50 text-left transition-colors">
      <span className="shrink-0 w-9 flex items-center justify-center">
        {c.lojas.length > 0
          ? <LojaLogos lojas={c.lojas} size="h-5" />
          : <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-stone-200 text-stone-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-surface-100 text-stone-400'}`}>{i + 1}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-stone-800 truncate">{c.nome || c.email || c.telefone || 'Sem nome'}</span>
        <span className="block text-[11px] text-stone-400 truncate">{c.email || c.telefone || ''}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-stone-700 tabular-nums">{right(c)}</span>
    </button>
  )

  const HEADERS = [
    ['nome', 'Lead'],
    ['produto', 'Produto'],
    ['canais', 'Enviado'],
    ['clicou', 'Clicou?'],
    ['comprou', 'Comprou?'],
    ['ultima', 'Último evento'],
  ]

  return (
    <PageShell
      badge="Geral · CRM"
      title="Banco de Leads"
      right={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-surface-100 p-0.5">
            <button onClick={() => setView('leads')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'leads' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> Leads</span>
            </button>
            <button onClick={() => setView('nichos')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'nichos' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              <span className="inline-flex items-center gap-1.5"><Layers className="w-4 h-4" /> Nichos {nichos.length > 0 && <span className="text-[11px] text-stone-400">({nichos.length})</span>}</span>
            </button>
          </div>
        </div>
      }
    >
      {view === 'leads' && (
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Lateral esquerda: Faturamento + Conversão */}
      <aside className="lg:w-52 xl:w-56 shrink-0 lg:order-1">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard icon={RotateCcw} label="Fat. líquido" value={fmtMoney(stats.fatLiquido, stats.moeda)} red />
          <StatCard icon={DollarSign} label="Faturamento" value={fmtMoney(stats.faturamento, stats.moeda)} tint="primary" />
          <StatCard icon={TrendingUp} label="Conversão" value={`${stats.conversao}%`} tint="violet" />
        </div>
      </aside>
      {/* Lateral direita: Total + Compradores */}
      <aside className="lg:w-52 xl:w-56 shrink-0 lg:order-3">
        <div className="lg:sticky lg:top-24 grid grid-cols-2 lg:grid-cols-1 gap-3">
          <StatCard icon={Users} label="Total de leads" value={stats.total} tint="stone" />
          <StatCard icon={ShoppingBag} label="Compradores" value={stats.compradores} tint="emerald" />
        </div>
      </aside>

      {/* Meio: rankings + tabela */}
      <div className="flex-1 min-w-0 lg:order-2 flex flex-col gap-3">

      {/* Melhores leads */}
      {(topFaturamento.length > 0 || topEngajados.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="app-panel rounded-2xl p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-800 mb-2"><Trophy className="w-4 h-4 text-amber-500" /> Que mais gastaram</p>
            {topFaturamento.length === 0 ? <p className="text-xs text-stone-400 px-2 py-4">Nenhuma compra registrada ainda.</p> : (
              <div className="space-y-0.5">{topFaturamento.map((c, i) => <RankItem key={c.key} c={c} i={i} right={(x) => <GastoValor c={x} plain />} />)}</div>
            )}
          </div>
          <div className="app-panel rounded-2xl p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-800 mb-2"><Flame className="w-4 h-4 text-orange-500" /> Mais engajados <span className="text-[11px] font-normal text-stone-400">(aberturas + cliques)</span></p>
            {topEngajados.length === 0 ? <p className="text-xs text-stone-400 px-2 py-4">Nenhum engajamento de e-mail ainda.</p> : (
              <div className="space-y-0.5">{topEngajados.map((c, i) => <RankItem key={c.key} c={c} i={i} right={(x) => `${x.engajamento}`} />)}</div>
            )}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="app-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-surface-100 flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2 text-sm font-semibold text-stone-800 min-w-0"><Users className="w-4 h-4 text-primary-600 shrink-0" /> <span className="truncate">Todos os leads <span className="text-stone-400 font-normal">({filtrados.length})</span></span></span>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {selecionados.size > 0 && (
              <button onClick={excluirSelecionados} disabled={excluindo} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Excluir ({selecionados.size})
              </button>
            )}
            <button onClick={() => { setNichoForm({ nome: '', imagem: '', tipo: selecionados.size > 0 ? 'fixo' : 'dinamico', loja: '' }); setShowCriarNicho(true) }} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg px-2.5 py-1.5 transition-colors" title="Criar nicho">
              <Layers className="w-3.5 h-3.5" /> Criar Nicho {selecionados.size > 0 ? `(${selecionados.size})` : ''}
            </button>
            <button onClick={() => setShowExcel(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2.5 py-1.5 transition-colors" title="Exportar Excel">
              <Download className="w-3.5 h-3.5" /> Baixar Excel {selecionados.size > 0 ? `(${selecionados.size})` : ''}
            </button>
            <Select
              value={filtro}
              onChange={setFiltro}
              searchable={false}
              title="Filtrar leads"
              trigger={
                <span className="relative p-1.5 text-stone-500 hover:text-primary-600 transition-colors inline-flex" title="Filtrar">
                  <Filter className="w-4 h-4" />
                  {filtro !== 'todos' && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary-500" />}
                </span>
              }
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'compradores', label: 'Compradores' },
                { value: 'nao_compradores', label: 'Não compraram' },
                { value: 'estornados', label: 'Reembolsados / chargeback' },
                { value: 'clicaram', label: 'Clicaram' },
                { value: 'whats', label: 'Enviado WhatsApp' },
                { value: 'email', label: 'Enviado E-mail' },
              ]}
            />
            <CollapsibleSearch value={busca} onChange={setBusca} placeholder="Nome, e-mail, telefone ou produto" />
          </div>
        </div>

        <div className="overflow-x-auto">
          {filtrados.length === 0 ? (
            <p className="p-8 text-sm text-stone-400 text-center">{busca || filtro !== 'todos' ? 'Nenhum lead com esses filtros.' : 'Nenhum lead ainda. Quando um webhook criar leads, eles aparecem aqui.'}</p>
          ) : (
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  <th className="px-3 py-2.5 w-10">
                    <button onClick={toggleSelTodos} className="p-1 -m-1 text-stone-400 hover:text-primary-600" title={todosSelecionados ? 'Desmarcar todos' : `Selecionar todos (${filtrados.length})`}>
                      {todosSelecionados ? <CheckCircle2 className="w-4 h-4 text-primary-600" /> : <Circle className="w-4 h-4" />}
                    </button>
                  </th>
                  {HEADERS.map(([key, label]) => (
                    <th key={key} onClick={() => key !== 'canais' && toggleSort(key)} className={`px-4 py-2.5 font-medium text-xs whitespace-nowrap select-none ${key !== 'canais' ? 'cursor-pointer hover:text-stone-700' : ''}`}>
                      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c) => {
                  const sel = selecionados.has(c.key)
                  return (
                    <tr key={c.key} className={`border-b border-surface-50 transition-colors cursor-pointer ${sel ? 'bg-primary-50/60' : 'hover:bg-surface-50/70'}`} onClick={() => setDetalhe(c)}>
                      <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); toggleSel(c.key) }}>
                        <button className={`p-1 -m-1 ${sel ? 'text-primary-600' : 'text-stone-300 hover:text-primary-500'}`}>
                          {sel ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-stone-800 truncate max-w-[200px]">{c.nome || 'Sem nome'}</div>
                        <div className="text-xs text-stone-400 truncate max-w-[200px]">{c.email || c.telefone || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {c.lojas.length > 0 && <LojaLogos lojas={c.lojas} size="h-4" />}
                          <span className="text-stone-600 truncate max-w-[150px]">{c.produtos[0] || '—'}{c.produtos.length > 1 && <span className="text-stone-400"> +{c.produtos.length - 1}</span>}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><Canais c={c} /></td>
                      <td className="px-4 py-2.5">
                        {c.clicou ? <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600"><MousePointerClick className="w-3.5 h-3.5" /> Sim</span>
                          : c.abriu ? <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-500"><Eye className="w-3.5 h-3.5" /> Abriu</span>
                            : <span className="text-xs text-stone-400">Não</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 flex-wrap text-xs">
                          {c.comprou ? <GastoValor c={c} withIcon />
                            : <span className="text-xs text-stone-400">R$ 0,00</span>}
                          <EstornoBadge tipo={c.estorno} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{c.ultima ? fmtDate(c.ultima) : '—'}</td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => abrirEdicao(c)} className="p-1.5 rounded-lg text-stone-400 hover:bg-primary-50 hover:text-primary-600" title="Editar lead"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => excluirUm(c)} className="p-1.5 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir lead"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {filtrados.length > POR_PAGINA && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Página {paginaAtual} de {totalPaginas} · {filtrados.length} lead(s)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
      </div>
      </div>
      )}

      {/* ── View: NICHOS ── */}
      {view === 'nichos' && (
      <div className="space-y-3">
        <div className="flex justify-end">
          <button onClick={() => { setNichoForm({ nome: '', imagem: '', tipo: 'dinamico', loja: '' }); setShowCriarNicho(true) }} className="btn-primary text-sm min-h-[40px] shrink-0"><Plus className="w-4 h-4" /> Criar nicho</button>
        </div>
        {nichos.length === 0 ? (
          <div className="app-panel rounded-2xl p-10 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-3"><Layers className="w-7 h-7" /></span>
            <p className="text-sm text-stone-500 mb-3 max-w-md mx-auto">Nenhum nicho ainda. Vá em <strong>Leads</strong>, filtre/selecione e clique em <strong>Criar Nicho</strong> — ou crie um nicho <strong>dinâmico</strong> por critério.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {nichos.map((n) => {
              const contatos = resolverNicho(n, leads, produtoLojas)
              const comTel = contatos.filter((c) => (c.telefone || '').replace(/\D/g, '')).length
              const comEmail = contatos.filter((c) => (c.email || '').trim()).length
              const aberto = nichoExpandido === n.id
              return (
                <div key={n.id} className="app-panel rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-3 p-3 sm:p-4">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl overflow-hidden shrink-0 ${n.imagem ? '' : 'bg-primary-50'}`}>
                      {n.imagem ? <img src={n.imagem} alt="" className="h-full w-full object-contain" /> : <Users className="w-5 h-5 text-primary-400" />}
                    </span>
                    <button onClick={() => setNichoExpandido(aberto ? null : n.id)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2 min-w-0"><span className="text-sm font-semibold text-stone-800 truncate">{n.nome}</span>{n.tipo === 'dinamico' && <span className="text-[10px] font-bold uppercase text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full shrink-0">dinâmico</span>}</span>
                      <span className="block text-[11px] text-stone-400 truncate">{contatos.length} contato(s) · {comTel} tel · {comEmail} e-mail{n.tipo === 'dinamico' && n.criterio ? ` · ${CRITERIO_LABEL[n.criterio.base] || ''}${n.criterio.loja ? ' · ' + (lojaByKey(n.criterio.loja)?.nome || '') : ''}` : ''}</span>
                    </button>
                    <button onClick={() => setNichoExcel(n)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2.5 py-1.5 shrink-0"><Download className="w-3.5 h-3.5" /> Excel</button>
                    <button onClick={() => excluirNicho(n)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Excluir nicho"><Trash2 className="w-4 h-4" /></button>
                    <button onClick={() => setNichoExpandido(aberto ? null : n.id)} className="p-1 text-stone-400 shrink-0"><ChevronDown className={`w-4 h-4 transition-transform ${aberto ? 'rotate-180' : ''}`} /></button>
                  </div>
                  {aberto && (
                    <div className="border-t border-surface-100 overflow-x-auto max-h-96 overflow-y-auto scroll-y-soft">
                      {contatos.length === 0 ? <p className="p-6 text-sm text-stone-400 text-center">Sem contatos.</p> : (
                        <table className="w-full text-sm min-w-[560px]">
                          <thead><tr className="border-b border-surface-100 text-left text-stone-500 sticky top-0 bg-white">
                            <th className="px-4 py-2 font-medium text-xs">Contato</th>
                            <th className="px-4 py-2 font-medium text-xs">Telefone</th>
                            <th className="px-4 py-2 font-medium text-xs">Produto</th>
                            {n.tipo !== 'dinamico' && <th className="px-4 py-2 w-8"></th>}
                          </tr></thead>
                          <tbody>
                            {contatos.map((c, i) => (
                              <tr key={i} className="border-b border-surface-50">
                                <td className="px-4 py-2"><div className="font-medium text-stone-800 truncate max-w-[200px]">{c.nome || 'Sem nome'}</div><div className="text-xs text-stone-400 truncate max-w-[200px]">{c.email || '—'}</div></td>
                                <td className="px-4 py-2 text-stone-600 font-mono text-xs">{c.telefone || '—'}</td>
                                <td className="px-4 py-2 text-stone-600 truncate max-w-[140px]">{c.produto || '—'}</td>
                                {n.tipo !== 'dinamico' && <td className="px-4 py-2"><button onClick={() => removerContatoNicho(n, i)} className="p-1 rounded text-stone-300 hover:text-red-600" title="Remover do nicho"><X className="w-4 h-4" /></button></td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* Modal: raio-x do lead */}
      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDetalhe(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-5 border-b border-surface-100">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-base font-semibold text-stone-800 truncate">{detalhe.nome || 'Sem nome'}</h3>
                  {detalhe.lojas.length > 0 && <LojaLogos lojas={detalhe.lojas} size="h-5" />}
                </div>
                <p className="text-xs text-stone-500 truncate">{detalhe.email || '—'}{detalhe.telefone ? ` · ${detalhe.telefone}` : ''}</p>
                <div className="flex items-center gap-2 mt-1.5"><Canais c={detalhe} /><EstornoBadge tipo={detalhe.estorno} /></div>
              </div>
              <button onClick={() => abrirEdicao(detalhe)} className="p-1.5 rounded-lg text-stone-400 hover:bg-primary-50 hover:text-primary-600 shrink-0" title="Editar lead"><Pencil className="w-4 h-4" /></button>
              <button onClick={() => setDetalhe(null)} className="p-1 text-stone-400 hover:text-stone-600 shrink-0"><X className="w-5 h-5" /></button>
            </div>
            {detalhe.estorno && (
              <div className={`mx-5 mt-4 rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2 ${detalhe.estorno === 'chargeback' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                {detalhe.estorno === 'chargeback' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <RotateCcw className="w-4 h-4 shrink-0" />}
                {detalhe.estorno === 'chargeback' ? 'Este cliente abriu um chargeback (contestou a compra).' : 'Este cliente pediu reembolso (desistiu da compra).'}
              </div>
            )}

            <div className="p-5 space-y-4 overflow-y-auto scroll-y-soft">
              <div className="grid grid-cols-3 gap-2">
                {(() => {
                  const liq = gastoLiquido(detalhe)
                  const full = detalhe.estorno && liq <= 0
                  return (
                    <div className={`rounded-xl p-3 text-center border ${full ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-100'}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wider ${full ? 'text-rose-500' : 'text-emerald-600'}`}>{detalhe.estorno && !full ? 'Gasto líquido' : 'Gasto total'}</p>
                      <p className={`text-sm font-bold tabular-nums mt-0.5 ${full ? 'text-rose-700 line-through' : 'text-emerald-700'}`}>{fmtMoney(full ? detalhe.totalGasto : (detalhe.estorno ? liq : detalhe.totalGasto), detalhe.moeda)}</p>
                    </div>
                  )
                })()}
                <div className="rounded-xl bg-primary-50 border border-primary-100 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Compras</p>
                  <p className="text-sm font-bold text-primary-700 tabular-nums mt-0.5">{detalhe.compras.length}</p>
                </div>
                <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Engajamento</p>
                  <p className="text-sm font-bold text-violet-700 tabular-nums mt-0.5">{detalhe.opens}<span className="text-[10px] font-normal"> ab</span> · {detalhe.clicks}<span className="text-[10px] font-normal"> cl</span></p>
                </div>
              </div>

              {detalhe.compras.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-600 mb-1.5 flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Compras</p>
                  <div className="space-y-1.5">
                    {detalhe.compras.map((cp, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-surface-200 bg-surface-50/50 px-3 py-2">
                        <span className="min-w-0"><span className="block text-sm font-medium text-stone-800 truncate">{cp.produto || 'Produto'}</span><span className="block text-[11px] text-stone-400">{fmtDate(cp.createdAt)}</span></span>
                        <span className="text-sm font-semibold text-emerald-700 tabular-nums shrink-0">{fmtMoney(cp.valor, cp.moeda || detalhe.moeda)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detalhe.produtos.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-600 mb-1.5 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Produtos de interesse</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detalhe.produtos.map((p, i) => <span key={i} className="text-[11px] font-medium bg-primary-50 text-primary-700 border border-primary-200/70 rounded-full px-2.5 py-1">{p}</span>)}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-stone-600 mb-1.5 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Linha do tempo ({detalhe.eventos.length})</p>
                <div className="space-y-1 max-h-56 overflow-y-auto scroll-y-soft pr-1">
                  {[...detalhe.eventos].sort((a, b) => (b.createdAt?.toMillis?.() ?? b.createdAt ?? 0) - (a.createdAt?.toMillis?.() ?? a.createdAt ?? 0)).map((ev, i) => {
                    const est = ev.evento === 'order_status.chargeback' || ev.evento === 'order_status.refund'
                    const compra = ev.evento === 'order_status.purchase_approved'
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${est ? 'bg-rose-500' : compra ? 'bg-emerald-500' : 'bg-primary-400'}`} />
                        <span className={`font-medium ${est ? 'text-rose-600' : 'text-stone-700'}`}>{eventoLabel(ev.evento)}</span>
                        {ev.produto && <span className="text-stone-400 truncate">· {ev.produto}</span>}
                        <span className="ml-auto text-stone-400 whitespace-nowrap shrink-0">{fmtDate(ev.createdAt)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-surface-100 flex justify-between items-center gap-2">
              <button onClick={() => excluirUm(detalhe)} className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl px-3 py-2 transition-colors"><Trash2 className="w-4 h-4" /> Excluir lead</button>
              <button onClick={() => setDetalhe(null)} className="btn-secondary text-sm min-h-[40px]">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: editar lead */}
      {editando && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setEditando(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Pencil className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800">Editar lead</h3>
              <button onClick={() => setEditando(null)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-stone-400">Altera o nome, e-mail e telefone em todos os {editando.leadIds.length} registro(s) deste lead.</p>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
              <input value={editForm.nome} onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Nome do lead" autoFocus className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">E-mail</label>
              <input value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Telefone</label>
              <input value={editForm.telefone} onChange={(e) => setEditForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="5511999999999" className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300" />
            </div>
            {editCompras.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Valor da(s) compra(s)</label>
                <div className="space-y-2">
                  {editCompras.map((cp, i) => (
                    <div key={cp.id || i} className="flex items-center gap-2">
                      <span className="text-xs text-stone-500 truncate flex-1 min-w-0">{cp.produto || 'Compra'}</span>
                      <input value={cp.valor} onChange={(e) => setEditCompras((arr) => arr.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder="132,51" className="w-32 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm text-right outline-none focus:border-surface-300" />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-stone-400 mt-1">Corrija aqui se o valor veio errado (ex.: centavos). Use ponto ou vírgula.</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditando(null)} className="btn-secondary text-sm min-h-[44px]">Cancelar</button>
              <button onClick={salvarEdicao} disabled={salvandoEdit} className="btn-primary text-sm min-h-[44px] touch-manipulation">
                {salvandoEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: escolher formato do Excel */}
      {showExcel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowExcel(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shrink-0"><Download className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800">Baixar Excel</h3>
              <button onClick={() => setShowExcel(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-stone-500">Exportando <strong>{(selecionadosContatos.length > 0 ? selecionadosContatos.length : filtrados.length)} contato(s)</strong> {selecionadosContatos.length > 0 ? 'selecionados' : '(todos os filtrados)'}. Escolha o formato:</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => baixarExcel('whatsapp')} className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-surface-200 hover:border-[#25D366] hover:bg-green-50/50 p-4 transition">
                <WhatsAppIcon className="w-7 h-7 text-[#25D366]" />
                <span className="text-sm font-semibold text-stone-800">WhatsApp</span>
                <span className="text-[10px] text-stone-400">número, nome</span>
              </button>
              <button onClick={() => baixarExcel('email')} className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-surface-200 hover:border-primary-400 hover:bg-primary-50/50 p-4 transition">
                <Mail className="w-7 h-7 text-primary-600" />
                <span className="text-sm font-semibold text-stone-800">E-mail</span>
                <span className="text-[10px] text-stone-400">email, nome</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: excel de um nicho */}
      {nichoExcel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setNichoExcel(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shrink-0"><Download className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800 truncate">Excel · {nichoExcel.nome}</h3>
              <button onClick={() => setNichoExcel(null)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => baixarExcelNicho(nichoExcel, 'whatsapp')} className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-surface-200 hover:border-[#25D366] hover:bg-green-50/50 p-4 transition">
                <WhatsAppIcon className="w-7 h-7 text-[#25D366]" /><span className="text-sm font-semibold text-stone-800">WhatsApp</span><span className="text-[10px] text-stone-400">número, nome</span>
              </button>
              <button onClick={() => baixarExcelNicho(nichoExcel, 'email')} className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-surface-200 hover:border-primary-400 hover:bg-primary-50/50 p-4 transition">
                <Mail className="w-7 h-7 text-primary-600" /><span className="text-sm font-semibold text-stone-800">E-mail</span><span className="text-[10px] text-stone-400">email, nome</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: criar nicho */}
      {showCriarNicho && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCriarNicho(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto scroll-y-soft" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Layers className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800">Criar nicho</h3>
              <button onClick={() => setShowCriarNicho(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-surface-300 bg-surface-50 cursor-pointer overflow-hidden shrink-0 hover:border-primary-300">
                {nichoForm.imagem ? <img src={nichoForm.imagem} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="w-6 h-6 text-stone-400" />}
                <input type="file" accept="image/*" onChange={onNichoImg} className="hidden" />
              </label>
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome do nicho</label>
                <input value={nichoForm.nome} onChange={(e) => setNichoForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Compradores Gekko" autoFocus className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm outline-none focus:border-surface-300" />
                {nichoForm.imagem && <button onClick={() => setNichoForm((f) => ({ ...f, imagem: '' }))} className="text-[11px] text-red-500 hover:underline mt-1">Remover imagem</button>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Tipo do nicho</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setNichoForm((f) => ({ ...f, tipo: 'fixo' }))} className={`rounded-xl border-2 p-3 text-left transition ${nichoForm.tipo === 'fixo' ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 hover:border-primary-300'}`}>
                  <span className="block text-sm font-semibold text-stone-800">Fixo</span>
                  <span className="block text-[11px] text-stone-400 leading-snug mt-0.5">{selecionados.size > 0 ? `${selecionados.size} selecionado(s)` : `${filtrados.length} filtrado(s)`} — lista congelada.</span>
                </button>
                <button onClick={() => setNichoForm((f) => ({ ...f, tipo: 'dinamico' }))} className={`rounded-xl border-2 p-3 text-left transition ${nichoForm.tipo === 'dinamico' ? 'border-violet-500 bg-violet-50/50' : 'border-surface-200 hover:border-violet-300'}`}>
                  <span className="block text-sm font-semibold text-stone-800">Dinâmico</span>
                  <span className="block text-[11px] text-stone-400 leading-snug mt-0.5">Atualiza sozinho com leads novos que batem o critério.</span>
                </button>
              </div>
            </div>

            {nichoForm.tipo === 'dinamico' ? (
              <div className="rounded-xl bg-violet-50/60 border border-violet-100 p-3 space-y-2">
                <p className="text-[11px] text-stone-500">Critério: <strong>{CRITERIO_LABEL[['todos', 'compradores', 'nao_compradores', 'estornados'].includes(filtro) ? filtro : 'todos']}</strong> (do filtro atual) + loja (opcional):</p>
                <Select value={nichoForm.loja} onChange={(v) => setNichoForm((f) => ({ ...f, loja: v }))} searchable={false} className="w-full" options={[{ value: '', label: 'Todas as lojas' }, ...LOJAS.map((l) => ({ value: l.key, label: l.nome, image: l.logo }))]} withThumb />
              </div>
            ) : (
              <p className="text-[11px] text-stone-400">Vai criar o nicho com {selecionados.size > 0 ? `os ${selecionados.size} leads selecionados` : `todos os ${filtrados.length} leads filtrados`}.</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCriarNicho(false)} className="btn-secondary text-sm min-h-[44px]">Cancelar</button>
              <button onClick={criarNicho} disabled={salvandoNicho} className="btn-primary text-sm min-h-[44px] touch-manipulation">
                {salvandoNicho ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />} Criar nicho
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

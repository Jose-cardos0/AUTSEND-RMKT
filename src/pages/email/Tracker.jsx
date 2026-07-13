import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import {
  createCustomWebhook,
  getCustomWebhooks,
  getWebhookSamples,
  updateWebhookMapping,
  deleteWebhook,
} from '../../lib/firestore'
import { KIWIFY_EVENTS } from '../../lib/constants'
import { LOJAS, lojaByKey } from '../../lib/lojas'
import { getWebhookPreset } from '../../lib/webhookPresets'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { useConfirm } from '../../components/ConfirmDialog'
import MelhorarPlano from '../../components/MelhorarPlano'
import { usePlano } from '../../lib/PlanoContext'
import {
  Radar, Webhook, Plus, Copy, Check, Trash2, Loader2, RefreshCw, Play,
  Power, PowerOff, ChevronRight, ChevronDown, Zap, MousePointerClick, Sparkles,
  HelpCircle, X, Pencil, Store,
} from 'lucide-react'

/** Seção recolhível (accordion) — clique no título para abrir/fechar. */
function Secao({ title, icon: Icon, open, onToggle, action, children }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <div className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3 hover:bg-surface-50 transition">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0 flex-1 text-left">
          {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {action}
          <button type="button" onClick={onToggle} aria-label={open ? 'Recolher' : 'Expandir'} className="p-1 text-stone-400 hover:text-stone-600">
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <div className="px-4 sm:px-5 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

/** Achata um objeto/array em caminhos folha tipo "customer.email". */
function flattenPaths(obj, prefix = '', out = [], depth = 0) {
  if (obj == null || depth > 6) return out
  if (Array.isArray(obj)) {
    obj.slice(0, 5).forEach((v, i) => {
      const p = prefix ? `${prefix}.${i}` : String(i)
      if (v && typeof v === 'object') flattenPaths(v, p, out, depth + 1)
      else out.push({ path: p, value: v })
    })
  } else if (typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) => {
      const p = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object') flattenPaths(v, p, out, depth + 1)
      else out.push({ path: p, value: v })
    })
  }
  return out
}

/** Tenta adivinhar quais caminhos são nome/email/telefone/produto (lida com produto aninhado em arrays). */
function autoGuess(paths) {
  const used = new Set()
  const claim = (predicates) => {
    for (const pred of predicates) {
      const hit = paths.find((p) => !used.has(p.path) && pred(p.path.toLowerCase()))
      if (hit) { used.add(hit.path); return hit.path }
    }
    return ''
  }
  const email = claim([(p) => /email|e-mail/.test(p) || p.endsWith('mail')])
  const telefone = claim([(p) => /phone|telefone|celular|whatsapp|mobile/.test(p)])
  // Produto: prefere um caminho que termine em "name" dentro de product/offer.
  const produto = claim([
    (p) => (p.includes('product') || p.includes('offer') || p.includes('produto')) && p.endsWith('name'),
    (p) => p.includes('product') || p.includes('produto') || p.includes('plan'),
  ])
  // Nome do cliente: evita product/offer/card (ex.: card_holder_name).
  const nome = claim([
    (p) => /customer|buyer|cliente|lead/.test(p) && p.endsWith('name'),
    (p) => p.endsWith('name') && !/product|offer|card|holder/.test(p),
    (p) => p.includes('nome'),
  ])
  const produtoId = claim([(p) => p.includes('product') && p.endsWith('id')])
  const orderId = claim([
    (p) => p === 'id',
    (p) => /order_id|transaction_id|order_number|purchase_id|sale_id/.test(p),
  ])
  const valor = claim([
    (p) => /(^|\.)amount$/.test(p),
    (p) => p === 'total' || p.endsWith('.total'),
    (p) => p.includes('valor') || p.includes('price'),
  ])
  return { email, telefone, produto, nome, produtoId, orderId, valor }
}

const ROLES = [
  { key: 'nome', label: 'Nome', obrigatorio: true },
  { key: 'email', label: 'E-mail', obrigatorio: true },
  { key: 'telefone', label: 'Telefone', obrigatorio: false },
  { key: 'produto', label: 'Produto', obrigatorio: false },
  { key: 'produtoId', label: 'ID do produto', obrigatorio: false },
  { key: 'orderId', label: 'ID do pedido', obrigatorio: false },
  { key: 'valor', label: 'Valor da compra', obrigatorio: false },
]

const OPERADORES = [
  { value: 'equals', label: 'é igual a' },
  { value: 'contains', label: 'contém' },
  { value: 'exists', label: 'existe (qualquer valor)' },
]

function preview(v) {
  if (v === null) return 'null'
  if (v === undefined) return ''
  const s = String(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

export default function Tracker() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const { limiteDe } = usePlano()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [webhooks, setWebhooks] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [samples, setSamples] = useState([])
  const [carregandoSamples, setCarregandoSamples] = useState(false)
  const [fieldMap, setFieldMap] = useState({})
  const [eventRules, setEventRules] = useState([])
  const [insSecret, setInsSecret] = useState('')
  const [salvandoSecret, setSalvandoSecret] = useState(false)
  const [criando, setCriando] = useState(false)
  // Popup de criação: escolher loja + nome
  const [showCriar, setShowCriar] = useState(false)
  const [lojaSel, setLojaSel] = useState(null) // key da loja ou 'custom'
  const [nomeNovo, setNomeNovo] = useState('')
  // Popup de edição do webhook selecionado (nome + loja)
  const [showEditar, setShowEditar] = useState(false)
  const [editNome, setEditNome] = useState('')
  const [editLoja, setEditLoja] = useState(null)
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [secoes, setSecoes] = useState({ url: false, amostras: false, mapear: false, regras: false })
  const toggleSecao = (k) => setSecoes((s) => ({ ...s, [k]: !s[k] }))
  const pollRef = useRef(null)
  const autoFilledRef = useRef({})

  const selected = useMemo(() => webhooks.find((w) => w.id === selectedId) || null, [webhooks, selectedId])

  useEffect(() => {
    if (!user?.uid) return
    getCustomWebhooks(user.uid)
      .then((list) => {
        setWebhooks(list)
        if (list.length > 0) setSelectedId((cur) => cur ?? list[0].id)
      })
      .finally(() => setLoading(false))
  }, [user?.uid])

  // Ao trocar de webhook, carrega mapeamento + amostras
  useEffect(() => {
    if (!selected) return
    setFieldMap(selected.fieldMap || {})
    setEventRules(selected.eventRules || [])
    setInsSecret(selected.insSecret || '')
    carregarSamples(selected.id)
  }, [selectedId])

  // Auto-poll de amostras (teste e ativo) — só re-renderiza se chegar amostra nova
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (!selected || !user?.uid) return
    pollRef.current = setInterval(() => carregarSamples(selected.id, true), 3500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [selectedId, selected?.status, user?.uid])

  const carregarSamples = async (webhookId, silent = false) => {
    if (!user?.uid || !webhookId) return
    if (!silent) setCarregandoSamples(true)
    try {
      const list = await getWebhookSamples(user.uid, webhookId)
      // Só re-renderiza se chegou amostra nova (evita o JSON "piscar/pular" a cada poll)
      setSamples((prev) => {
        if (prev.length === list.length && prev[0]?.id === list[0]?.id) return prev
        return list
      })
    } catch (_) {} finally {
      if (!silent) setCarregandoSamples(false)
    }
  }

  const paths = useMemo(() => flattenPaths(samples[0]?.rawPayload || {}), [samples])

  // Pré-preenche o mapeamento sozinho quando a primeira amostra chega (uma vez por webhook, sem sobrescrever o salvo/editado)
  useEffect(() => {
    if (!selected || paths.length === 0 || autoFilledRef.current[selected.id]) return
    autoFilledRef.current[selected.id] = true
    if (Object.values(selected.fieldMap || {}).some(Boolean)) return
    const guess = autoGuess(paths)
    setFieldMap((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(guess)) if (v && !next[k]) next[k] = v
      return next
    })
  }, [paths, selectedId])

  const abrirCriar = () => { setLojaSel(null); setNomeNovo(''); setShowCriar(true) }

  const handleCriar = async () => {
    if (!user?.uid) return
    if (!lojaSel) { toast.error('Selecione a loja do webhook.'); return }
    const limite = limiteDe('trackers')
    if (webhooks.length >= limite) {
      toast.error(`Seu plano permite ${limite} tracker${limite === 1 ? '' : 's'}. Faça upgrade pra criar mais.`)
      setShowCriar(false)
      setUpgradeOpen(true)
      return
    }
    setCriando(true)
    try {
      const lojaNome = lojaByKey(lojaSel)?.nome
      const nomeFinal = nomeNovo.trim() || `${lojaNome || 'Webhook'} ${new Date().toLocaleDateString('pt-BR')}`
      const preset = getWebhookPreset(lojaSel)
      const id = await createCustomWebhook(user.uid, {
        nome: nomeFinal,
        loja: lojaSel,
        fieldMap: preset?.fieldMap,
        eventRules: preset?.eventRules,
      })
      const list = await getCustomWebhooks(user.uid)
      setWebhooks(list)
      setSelectedId(id)
      setShowCriar(false)
      toast.success(
        preset
          ? `Webhook criado com o setup ${lojaNome} pronto! Cole a URL, envie um teste e confira.`
          : 'Webhook criado! Cole a URL na sua plataforma e envie um teste.'
      )
    } catch (err) {
      toast.error(err.message || 'Erro ao criar webhook')
    } finally {
      setCriando(false)
    }
  }

  const aplicarPreset = () => {
    const preset = getWebhookPreset(selected?.loja)
    if (!preset) return
    setFieldMap(preset.fieldMap)
    setEventRules(preset.eventRules)
    toast.success(`Preset ${lojaByKey(selected.loja)?.nome || ''} aplicado. Confira e clique em Salvar.`)
  }

  const salvarInsSecret = async () => {
    if (!selected) return
    setSalvandoSecret(true)
    try {
      await updateWebhookMapping(user.uid, selected.id, { insSecret: insSecret.trim() })
      const list = await getCustomWebhooks(user.uid)
      setWebhooks(list)
      toast.success('INS Secret Key salva.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar a chave.')
    } finally {
      setSalvandoSecret(false)
    }
  }

  const abrirEditar = () => {
    if (!selected) return
    setEditNome(selected.nome || '')
    setEditLoja(selected.loja || null)
    setShowEditar(true)
  }

  const handleSalvarEdicao = async () => {
    if (!selected) return
    setSalvandoEdicao(true)
    try {
      await updateWebhookMapping(user.uid, selected.id, { nome: editNome.trim() || selected.nome, loja: editLoja || '' })
      const list = await getCustomWebhooks(user.uid)
      setWebhooks(list)
      setShowEditar(false)
      toast.success('Webhook atualizado.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
    } finally {
      setSalvandoEdicao(false)
    }
  }

  const handleCopiar = () => {
    if (!selected?.webhookUrl) return
    navigator.clipboard.writeText(selected.webhookUrl)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const handleAdivinhar = () => {
    if (paths.length === 0) { toast.error('Envie um teste primeiro para detectar os campos.'); return }
    setFieldMap((prev) => ({ ...autoGuess(paths), ...Object.fromEntries(Object.entries(prev).filter(([, v]) => v)) }))
    toast.success('Campos sugeridos. Confira e ajuste se precisar.')
  }

  const [iaLoading, setIaLoading] = useState(false)
  const handleIA = async () => {
    const sample = samples[0]?.rawPayload
    if (!sample) { toast.error('Envie um teste primeiro (nenhuma amostra capturada).'); return }
    setIaLoading(true)
    try {
      // primeiro o Adivinhar (grátis), depois a IA completa o que faltou
      const base = autoGuess(paths)
      const fn = httpsCallable(functions, 'aiMapFields')
      const res = await fn({ sample, eventos: KIWIFY_EVENTS })
      const aiMap = res.data?.fieldMap || {}
      const aiRules = res.data?.eventRules || []
      setFieldMap((prev) => {
        const merged = { ...base, ...Object.fromEntries(Object.entries(prev).filter(([, v]) => v)) }
        for (const k of Object.keys(aiMap)) if (aiMap[k] && !merged[k]) merged[k] = aiMap[k]
        return merged
      })
      if (aiRules.length) {
        setEventRules((prev) => {
          const existentes = new Set(prev.map((r) => r.evento))
          const novas = aiRules
            .filter((r) => r && r.path && KIWIFY_EVENTS.some((e) => e.id === r.evento) && !existentes.has(r.evento))
            .map((r) => ({ path: r.path, op: r.op === 'contains' ? 'contains' : 'equals', value: r.value ?? '', evento: r.evento, ativo: true }))
          return [...prev, ...novas]
        })
      }
      toast.success('IA preencheu os campos e as regras. Confira e salve. ✨')
    } catch (err) {
      toast.error(err.message || 'Falha ao usar a IA.')
    } finally {
      setIaLoading(false)
    }
  }

  const setRole = (key, value) => setFieldMap((prev) => ({ ...prev, [key]: value }))

  const addRule = () =>
    setEventRules((prev) => [...prev, { path: '', op: 'equals', value: '', evento: 'abandoned_cart', ativo: true }])
  const updateRule = (i, patch) =>
    setEventRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRule = (i) => setEventRules((prev) => prev.filter((_, idx) => idx !== i))

  const salvarMapeamento = async (extra = {}) => {
    if (!user?.uid || !selected) return
    setSalvando(true)
    try {
      const cleanMap = Object.fromEntries(Object.entries(fieldMap).filter(([, v]) => v))
      await updateWebhookMapping(user.uid, selected.id, { fieldMap: cleanMap, eventRules, ...extra })
      const list = await getCustomWebhooks(user.uid)
      setWebhooks(list)
      return true
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
      return false
    } finally {
      setSalvando(false)
    }
  }

  const handleSalvar = async () => { if (await salvarMapeamento()) toast.success('Mapeamento salvo.') }

  const handleAtivar = async () => {
    if (!fieldMap.email && !fieldMap.telefone) {
      toast.error('Mapeie ao menos o E-mail ou o Telefone antes de ativar.')
      return
    }
    if (eventRules.length === 0) {
      toast.error('Crie ao menos uma regra de gatilho antes de ativar.')
      return
    }
    if (await salvarMapeamento({ status: 'active' })) toast.success('Webhook ativado! Já está capturando eventos de verdade.')
  }

  const handleVoltarTeste = async () => {
    if (await salvarMapeamento({ status: 'testing' })) toast('Voltou para modo teste.', { icon: '🧪' })
  }

  const handleExcluir = async (w) => {
    if (!(await confirm({ title: `Excluir "${w.nome}"?`, message: 'A URL deixará de funcionar na sua plataforma.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteWebhook(user.uid, w.id)
      const list = await getCustomWebhooks(user.uid)
      setWebhooks(list)
      setSelectedId(list[0]?.id ?? null)
      if (list.length === 0) { setSamples([]); setFieldMap({}); setEventRules([]) }
      toast.success('Webhook excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const isActive = selected?.status === 'active'

  return (
    <PageShell
      badge="Captura · Webhook custom"
      title="Tracker"
      right={
        <button onClick={abrirCriar} disabled={criando} className="btn-primary text-sm min-h-[44px] touch-manipulation">
          {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Criar webhook custom
        </button>
      }
    >
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      {webhooks.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600">
              <Radar className="w-7 h-7" />
            </span>
            <h2 className="text-lg font-semibold text-stone-800">Nenhum webhook custom ainda</h2>
            <p className="text-sm text-stone-500 max-w-md leading-relaxed">
              Clique em <strong>Criar webhook custom</strong>, cole a URL gerada na sua plataforma de vendas e
              envie um evento de teste. O app captura o formato para você mapear.
            </p>
          </div>
        </Panel>
      ) : (
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Lista de webhooks */}
          <div className="lg:w-64 shrink-0 space-y-2">
            {webhooks.map((w) => {
              const loja = lojaByKey(w.loja)
              return (
              <button
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                className={`relative overflow-hidden w-full text-left p-3 rounded-xl border transition ${
                  selectedId === w.id ? 'border-primary-500 bg-primary-50/60' : 'border-surface-200 bg-white/70 hover:bg-white'
                }`}
              >
                {/* Logo da loja como cover cortado (30% da largura, altura total, 50% opacidade) */}
                {loja?.logo && (
                  <img
                    src={loja.logo}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute right-0 top-0 h-full w-[30%] object-cover opacity-50"
                  />
                )}
                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-stone-800 text-sm truncate">{w.nome}</span>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </div>
                  <span className={`inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    w.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {w.status === 'active' ? 'Ativo' : 'Testando'}
                  </span>
                </div>
              </button>
              )
            })}
          </div>

          {/* Configuração do webhook selecionado */}
          {selected && (
            <div className="flex-1 min-w-0 space-y-3">
              {/* URL + ações */}
              <Secao
                title={selected.nome}
                icon={Webhook}
                open={secoes.url}
                onToggle={() => toggleSecao('url')}
                action={
                  <>
                    <button type="button" onClick={abrirEditar} title="Editar nome" className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={abrirEditar} title="Trocar loja" className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Store className="w-4 h-4" /></button>
                  </>
                }
              >
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <code className="flex-1 min-w-0 text-xs text-stone-600 break-all bg-surface-50 border border-surface-200 rounded-lg px-3 py-2.5">
                    {selected.webhookUrl}
                  </code>
                  <div className="flex gap-2">
                    <button onClick={handleCopiar} className="btn-secondary text-sm min-h-[44px] px-4 touch-manipulation">
                      {copiado ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      {copiado ? 'Copiado' : 'Copiar'}
                    </button>
                    <button onClick={() => handleExcluir(selected)} className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-600 touch-manipulation" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-stone-500">
                  Cole essa URL na sua plataforma (Hotmart, Cartpanda, Braip, etc.) como webhook/postback e dispare um teste.
                </p>

                {selected.loja === 'clickbank' && (
                  <div className="mt-1 rounded-xl border border-primary-200/70 bg-primary-50/40 p-3 space-y-2">
                    <label className="block text-xs font-semibold text-stone-700">INS Secret Key (ClickBank)</label>
                    <p className="text-[11px] text-stone-500 leading-relaxed">
                      O ClickBank envia o payload <strong>criptografado</strong>. Cole aqui sua <strong>Secret Key</strong> (ClickBank → Settings → Advanced Tools → Instant Notification) pra descriptografarmos automaticamente.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={insSecret}
                        onChange={(e) => setInsSecret(e.target.value)}
                        placeholder="sua INS Secret Key"
                        className="flex-1 px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm font-mono focus:border-surface-300 focus:ring-0 outline-none"
                      />
                      <button onClick={salvarInsSecret} disabled={salvandoSecret} className="btn-primary text-sm min-h-[44px] px-4 touch-manipulation shrink-0">
                        {salvandoSecret ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar chave
                      </button>
                    </div>
                  </div>
                )}
              </Secao>

              {/* Amostras capturadas */}
              <Secao title="Amostras recebidas" icon={Play} open={secoes.amostras} onToggle={() => toggleSecao('amostras')}>
                <div className="flex items-center justify-between gap-2 -mt-1">
                  <p className="text-xs text-stone-500">
                    {isActive
                      ? 'Webhook ativo — aqui aparecem os eventos reais mais recentes (últimos 10).'
                      : samples.length > 0
                        ? `${samples.length} amostra(s). Mostrando a mais recente.`
                        : 'Aguardando o primeiro teste da sua plataforma…'}
                  </p>
                  <button onClick={() => carregarSamples(selected.id)} className="text-xs text-primary-600 hover:underline flex items-center gap-1 shrink-0">
                    {carregandoSamples ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Atualizar
                  </button>
                </div>
                {samples.length > 0 ? (
                  <pre className="mt-2 text-[11px] leading-relaxed text-stone-700 bg-surface-50 border border-surface-200 rounded-xl p-3 overflow-auto h-64 min-h-[8rem] resize-y scroll-y-soft">
                    {JSON.stringify(samples[0].rawPayload, null, 2)}
                  </pre>
                ) : (
                  <div className="mt-2 rounded-xl border border-dashed border-amber-300/70 bg-amber-50/40 p-4 text-sm text-amber-800 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    Nenhuma amostra ainda. Envie um teste pela sua plataforma — atualiza sozinho.
                  </div>
                )}
              </Secao>

              {/* Mapeamento de campos */}
              <Secao title="Mapear campos" icon={MousePointerClick} open={secoes.mapear} onToggle={() => toggleSecao('mapear')}>
                <div className="flex items-center justify-between -mt-1">
                  <p className="text-xs text-stone-500">Diga qual campo do JSON é cada informação.</p>
                  <div className="flex items-center gap-3 shrink-0">
                    {getWebhookPreset(selected.loja) ? (
                      <button onClick={aplicarPreset} className="text-xs font-medium text-stone-600 hover:text-primary-600 flex items-center gap-1" title="Preencher com o setup pronto desta loja">
                        <Store className="w-3.5 h-3.5" /> Usar preset {lojaByKey(selected.loja)?.nome}
                      </button>
                    ) : (
                      <>
                        <button onClick={handleAdivinhar} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5" /> Adivinhar
                        </button>
                        <button onClick={handleIA} disabled={iaLoading} className="text-xs font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 disabled:opacity-50">
                          {iaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Preencher com IA
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                  {ROLES.map((role) => (
                    <div key={role.key}>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        {role.label} {role.obrigatorio && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        list={`paths-${selected.id}`}
                        value={fieldMap[role.key] || ''}
                        onChange={(e) => setRole(role.key, e.target.value)}
                        placeholder="ex.: customer.email"
                        className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                      />
                      {fieldMap[role.key] && paths.find((p) => p.path === fieldMap[role.key]) && (
                        <p className="text-[11px] text-stone-400 mt-1 truncate">= {preview(paths.find((p) => p.path === fieldMap[role.key]).value)}</p>
                      )}
                    </div>
                  ))}
                </div>
                <datalist id={`paths-${selected.id}`}>
                  {paths.map((p) => <option key={p.path} value={p.path}>{preview(p.value)}</option>)}
                </datalist>
              </Secao>

              {/* Regras de gatilho */}
              <Secao title="Regras de gatilho" icon={Radar} open={secoes.regras} onToggle={() => toggleSecao('regras')}>
                <p className="text-xs text-stone-500 -mt-1">
                  Quando o evento chegar e a condição bater, o app cria o lead com esse evento (e dispara a automação configurada).
                </p>
                <div className="space-y-2 mt-1">
                  {eventRules.map((rule, i) => (
                    <div key={i} className="rounded-xl border border-surface-200 bg-surface-50/60 p-3 space-y-2">
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <span className="text-xs font-semibold text-stone-500 shrink-0">QUANDO</span>
                        <input
                          list={`paths-${selected.id}`}
                          value={rule.path}
                          onChange={(e) => updateRule(i, { path: e.target.value })}
                          placeholder="campo (ex.: status)"
                          className="flex-1 min-w-0 px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm font-mono"
                        />
                        <Select
                          value={rule.op}
                          onChange={(v) => updateRule(i, { op: v })}
                          className="w-full sm:w-44"
                          options={OPERADORES}
                        />
                        {rule.op !== 'exists' && (
                          <input
                            value={rule.value}
                            onChange={(e) => updateRule(i, { value: e.target.value })}
                            placeholder="valor (ex.: refunded)"
                            className="flex-1 min-w-0 px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm"
                          />
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <span className="text-xs font-semibold text-stone-500 shrink-0">ENTÃO O EVENTO É</span>
                        <Select
                          value={rule.evento}
                          onChange={(v) => updateRule(i, { evento: v })}
                          className="flex-1 min-w-0"
                          options={KIWIFY_EVENTS.map((ev) => ({ value: ev.id, label: ev.label }))}
                        />
                        <button onClick={() => removeRule(i)} className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Remover regra">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addRule} className="btn-secondary text-sm min-h-[40px] mt-2">
                  <Plus className="w-4 h-4" /> Adicionar regra
                </button>
              </Secao>

              {/* Ações */}
              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pb-2">
                <button onClick={handleSalvar} disabled={salvando} className="btn-secondary min-h-[44px] touch-manipulation">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar mapeamento
                </button>
                {isActive ? (
                  <button onClick={handleVoltarTeste} disabled={salvando} className="btn-secondary min-h-[44px] touch-manipulation">
                    <PowerOff className="w-4 h-4" /> Voltar para teste
                  </button>
                ) : (
                  <button onClick={handleAtivar} disabled={salvando} className="btn-primary min-h-[44px] touch-manipulation">
                    <Power className="w-4 h-4" /> Ativar webhook
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Popup: criar webhook — escolher loja + nome */}
      {showCriar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCriar(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Webhook className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-stone-800">Criar webhook custom</h3>
                <p className="text-xs text-stone-500">De qual loja é esse webhook?</p>
              </div>
              <button onClick={() => setShowCriar(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Lojas */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {LOJAS.map((l) => {
                const sel = lojaSel === l.key
                return (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => setLojaSel(l.key)}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border-2 transition ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                  >
                    <img src={l.logo} alt={l.nome} className="h-9 w-9 object-contain" />
                    <span className="text-[11px] font-medium text-stone-700 truncate max-w-full">{l.nome}</span>
                  </button>
                )
              })}
              {/* Loja que não temos nas logos */}
              <button
                type="button"
                onClick={() => setLojaSel('custom')}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border-2 transition ${lojaSel === 'custom' ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-stone-400"><HelpCircle className="w-5 h-5" /></span>
                <span className="text-[11px] font-medium text-stone-700">Outra</span>
              </button>
            </div>

            {/* Nome — aparece após escolher a loja */}
            {lojaSel && (
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">Nome do webhook</label>
                <input
                  value={nomeNovo}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCriar() }}
                  placeholder={lojaSel === 'custom' ? 'Ex.: Webhook Braip' : `Ex.: ${lojaByKey(lojaSel)?.nome} principal`}
                  autoFocus
                  className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCriar(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={handleCriar} disabled={!lojaSel || criando} className="btn-primary min-h-[44px]">
                {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: editar webhook — nome + loja */}
      {showEditar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowEditar(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Pencil className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-stone-800">Editar webhook</h3>
                <p className="text-xs text-stone-500">Mude o nome e a loja do webhook.</p>
              </div>
              <button onClick={() => setShowEditar(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Nome do webhook</label>
              <input
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSalvarEdicao() }}
                placeholder="Nome do webhook"
                autoFocus
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Loja</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {LOJAS.map((l) => {
                  const sel = editLoja === l.key
                  return (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => setEditLoja(l.key)}
                      className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border-2 transition ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                    >
                      <img src={l.logo} alt={l.nome} className="h-9 w-9 object-contain" />
                      <span className="text-[11px] font-medium text-stone-700 truncate max-w-full">{l.nome}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setEditLoja('custom')}
                  className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border-2 transition ${editLoja === 'custom' ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-stone-400"><HelpCircle className="w-5 h-5" /></span>
                  <span className="text-[11px] font-medium text-stone-700">Outra</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEditar(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={handleSalvarEdicao} disabled={salvandoEdicao} className="btn-primary min-h-[44px]">{salvandoEdicao ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

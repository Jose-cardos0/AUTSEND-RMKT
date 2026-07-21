import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PERSONAS, personaLabel } from '../lib/atendentePersonas'
import { uploadAtendenteAsset } from '../lib/firestore'
import AudioTemplatePicker from './AudioTemplatePicker'
import AudioPlayer from './AudioPlayer'
import Select from './Select'
import { Rocket, FileText, Package, ShoppingBag, Plus, Save, Trash2, X, Search, Link2, Loader2, Target, Shield, MessageCircle, Star, Image as ImageIcon, AudioLines, Upload, Video, TrendingUp, TrendingDown, ChevronDown, Layers, Gift, Copy, ClipboardPaste, Clock, GitBranch, Bell } from 'lucide-react'

// Blocos de CONHECIMENTO (texto que alimenta o cérebro da IA). Cada um vira um campo derivado ao salvar.
const CONHECIMENTO = {
  contexto:    { label: 'Contexto',         Icon: FileText,      border: 'border-sky-200',    text: 'text-sky-700',    ph: 'O que a IA precisa saber: produto, o que faz, funcionamento, FAQ.' },
  objetivo:    { label: 'Objetivo',         Icon: Target,        border: 'border-amber-300',  text: 'text-amber-700',  ph: 'A meta da IA. Ex.: vender o plano mensal; qualificar e agendar; tirar dúvida e fechar a venda.' },
  regras:      { label: 'Regras / Limites', Icon: Shield,        border: 'border-rose-300',   text: 'text-rose-700',   ph: 'O que a IA NÃO pode fazer. Ex.: nunca prometa reembolso; não invente preço; não dê conselho médico.' },
  objecoes:    { label: 'Objeções',         Icon: MessageCircle, border: 'border-orange-300', text: 'text-orange-700', ph: 'Como rebater. Ex.: "tá caro" → mostre o custo-benefício; "vou pensar" → crie urgência com o cupom.' },
  provasocial: { label: 'Prova social',     Icon: Star,          border: 'border-yellow-400', text: 'text-yellow-700', ph: 'Depoimentos e resultados que a IA pode citar. Ex.: "+3 mil clientes", print do resultado da Maria...' },
}
const ehConhecimento = (t) => t in CONHECIMENTO

// Ofertas do funil (VSL/TSL = página principal; UP = upsell; DW = downsell).
const OFERTA = {
  vsl: { label: 'Página VSL', border: 'border-indigo-300', text: 'text-indigo-700', Icon: Video },
  tsl: { label: 'Página TSL', border: 'border-blue-300', text: 'text-blue-700', Icon: FileText },
  up: { label: 'Upsell', border: 'border-emerald-300', text: 'text-emerald-700', Icon: TrendingUp },
  dw: { label: 'Downsell', border: 'border-amber-300', text: 'text-amber-700', Icon: TrendingDown },
}

/* ─────────── Nós ─────────── */
function IaNode({ data, selected }) {
  return (
    <div className={`rounded-2xl border-2 px-4 py-3 bg-violet-50 shadow-sm min-w-[190px] ${selected ? 'border-primary-500' : 'border-violet-300'}`}>
      <div className="flex items-center gap-2 text-violet-700 font-semibold text-sm"><Rocket className="w-4 h-4" /> Atendente IA</div>
      <p className="text-[11px] text-violet-600/80 mt-0.5 truncate">{data?.produto || 'Produto'}</p>
      <p className="text-[10px] text-violet-500 mt-0.5">Perfil: {personaLabel(data?.persona)}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function KnowledgeNode({ type, data, selected }) {
  const cfg = CONHECIMENTO[type] || CONHECIMENTO.contexto
  const Icon = cfg.Icon
  const header = type === 'contexto' ? (data?.titulo || cfg.label) : cfg.label
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[170px] max-w-[220px] ${selected ? 'border-primary-500' : cfg.border}`}>
      <Handle type="target" position={Position.Top} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${cfg.text}`}><Icon className="w-4 h-4" /> {header}</div>
      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data?.texto ? data.texto : 'Escreva o conteúdo'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function MidiaNode({ type, data, selected }) {
  const isImg = type === 'imagem'
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[150px] max-w-[200px] ${selected ? 'border-primary-500' : isImg ? 'border-fuchsia-300' : 'border-indigo-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${isImg ? 'text-fuchsia-700' : 'text-indigo-700'}`}>
        {isImg ? <ImageIcon className="w-4 h-4" /> : <AudioLines className="w-4 h-4" />} {isImg ? 'Imagem' : 'Áudio'}
      </div>
      {isImg && data?.url && <img src={data.url} alt="" className="mt-1.5 rounded-lg max-h-20 w-full object-cover" />}
      {!isImg && data?.nome && <p className="text-[11px] text-stone-500 mt-0.5 truncate">{data.nome}</p>}
      {!data?.url && <p className="text-[11px] text-stone-400 mt-0.5">{isImg ? 'Suba uma imagem' : 'Escolha um áudio'}</p>}
    </div>
  )
}
function PlanoNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-emerald-50 shadow-sm min-w-[170px] max-w-[220px] ${selected ? 'border-primary-500' : 'border-emerald-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm"><Package className="w-4 h-4" /> {data?.nome || 'Plano'}</div>
      {data?.preco && <p className="text-[11px] text-emerald-700/90 mt-0.5 font-medium">{data.preco}</p>}
      {data?.descricao && <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data.descricao}</p>}
      <p className="text-[10px] text-emerald-600/70 mt-1">↓ ligue ao checkout</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function CheckoutNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[170px] max-w-[220px] ${selected ? 'border-primary-500' : 'border-primary-200'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-primary-700 font-semibold text-sm"><ShoppingBag className="w-4 h-4" /> {data?.nome || 'Checkout'}</div>
      <p className="text-[11px] text-stone-400 mt-0.5 truncate">{data?.link ? data.link : 'Escolha o link'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function OfertaNode({ data, selected }) {
  const cfg = OFERTA[data?.kind] || OFERTA.up
  const Icon = cfg.Icon
  const header = (data?.kind === 'up' || data?.kind === 'dw') ? (data?.nome || cfg.label) : cfg.label
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[170px] max-w-[220px] ${selected ? 'border-primary-500' : cfg.border}`}>
      <Handle type="target" position={Position.Top} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${cfg.text}`}><Icon className="w-4 h-4" /> {header}</div>
      {data?.descricao && <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data.descricao}</p>}
      <p className="text-[10px] text-stone-400 mt-1">↓ ligue ao checkout</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function AgradecimentoNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[150px] max-w-[200px] ${selected ? 'border-primary-500' : 'border-teal-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm"><Gift className="w-4 h-4" /> Agradecimento</div>
      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data?.texto ? data.texto : 'Msg de "valeu pela compra"'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
/* ─── Nós de FOLLOW-UP (automação temporizada, roda no backend) ─── */
const UNIDADE_LABEL = { min: 'min', hora: 'hora(s)', dia: 'dia(s)' }
function EsperarNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[150px] ${selected ? 'border-primary-500' : 'border-slate-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm"><Clock className="w-4 h-4" /> Esperar</div>
      <p className="text-[11px] text-stone-500 mt-0.5">{data?.valor || 5} {UNIDADE_LABEL[data?.unidade] || 'min'}</p>
      <p className="text-[10px] text-slate-400 mt-1">↓ conta se o lead ficar em silêncio</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function CondicaoNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[180px] ${selected ? 'border-primary-500' : 'border-purple-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-purple-700 font-semibold text-sm"><GitBranch className="w-4 h-4" /> Comprou?</div>
      <div className="flex justify-between mt-2 text-[10px] font-semibold">
        <span className="text-emerald-600">✓ Sim</span>
        <span className="text-rose-600">Não ✗</span>
      </div>
      <Handle id="sim" type="source" position={Position.Bottom} style={{ left: '22%' }} className="!bg-emerald-500" />
      <Handle id="nao" type="source" position={Position.Bottom} style={{ left: '78%' }} className="!bg-rose-500" />
    </div>
  )
}
function MensagemNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[160px] max-w-[220px] ${selected ? 'border-primary-500' : 'border-cyan-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-cyan-700 font-semibold text-sm"><Bell className="w-4 h-4" /> Mensagem</div>
      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data?.gerarIA ? '⚡ Gerada pela IA (reativação)' : (data?.texto || 'Escreva a mensagem')}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { ia: IaNode, contexto: KnowledgeNode, objetivo: KnowledgeNode, regras: KnowledgeNode, objecoes: KnowledgeNode, provasocial: KnowledgeNode, plano: PlanoNode, checkout: CheckoutNode, imagem: MidiaNode, audio: MidiaNode, oferta: OfertaNode, agradecimento: AgradecimentoNode, esperar: EsperarNode, condicao: CondicaoNode, mensagem: MensagemNode }

/** Monta o grafo inicial a partir dos campos legados (ou de um iaGraph salvo). */
function grafoInicial(grupo) {
  if (grupo?.iaGraph?.nodes?.length) return { nodes: grupo.iaGraph.nodes, edges: grupo.iaGraph.edges || [] }
  const ia = { id: 'ia', type: 'ia', position: { x: 320, y: 20 }, data: { produto: grupo?.nome || '', persona: grupo?.iaPersona || 'amigavel' } }
  const nodes = [ia]
  const edges = []
  let y = 180
  if (grupo?.iaContexto) {
    nodes.push({ id: 'ctx_prod', type: 'contexto', position: { x: 60, y }, data: { titulo: 'Produto', texto: grupo.iaContexto } })
    edges.push({ id: 'e_ctxprod', source: 'ia', target: 'ctx_prod' })
  }
  if (grupo?.iaContextoPlanos) {
    nodes.push({ id: 'ctx_planos', type: 'contexto', position: { x: 60, y: y + 160 }, data: { titulo: 'Planos', texto: grupo.iaContextoPlanos } })
    edges.push({ id: 'e_ctxplanos', source: 'ia', target: 'ctx_planos' })
  }
  const cks = Array.isArray(grupo?.iaCheckouts) ? grupo.iaCheckouts : []
  cks.forEach((c, i) => {
    const pid = `plano_${i}`, cid = `ck_${i}`
    nodes.push({ id: pid, type: 'plano', position: { x: 360 + i * 240, y: 200 }, data: { nome: c.nome || `Plano ${i + 1}`, preco: '', descricao: '' } })
    nodes.push({ id: cid, type: 'checkout', position: { x: 360 + i * 240, y: 380 }, data: { nome: c.nome || 'Checkout', link: c.link || '' } })
    edges.push({ id: `e_iap_${i}`, source: 'ia', target: pid })
    edges.push({ id: `e_pc_${i}`, source: pid, target: cid })
  })
  return { nodes, edges }
}

export default function AtendenteFlowEditor({ grupo, grupos = [], checkoutsFlat = [], uid, onClose, onSave }) {
  const inicial = useMemo(() => grafoInicial(grupo), [grupo])
  const [nodes, setNodes, onNodesChange] = useNodesState(inicial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(inicial.edges)
  const [selId, setSelId] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [ckPickerFor, setCkPickerFor] = useState(null) // id do nó checkout escolhendo link
  const [ckQ, setCkQ] = useState('')
  const [audioPickerFor, setAudioPickerFor] = useState(null) // id do nó áudio escolhendo template
  const [uploadingImg, setUploadingImg] = useState(false)
  const [pagMenuOpen, setPagMenuOpen] = useState(false)
  const imgInputRef = useRef(null)

  const addOferta = (kind) => {
    setPagMenuOpen(false)
    if ((kind === 'vsl' || kind === 'tsl') && nodes.some((n) => n.type === 'oferta' && (n.data?.kind === 'vsl' || n.data?.kind === 'tsl'))) {
      toast.error('Você já tem uma página de venda principal (VSL ou TSL). Remova a atual pra trocar.'); return
    }
    let nome = OFERTA[kind].label
    if (kind === 'up' || kind === 'dw') {
      const n = nodes.filter((x) => x.type === 'oferta' && x.data?.kind === kind).length + 1
      nome = (kind === 'up' ? 'UP' : 'DW') + n
    }
    const id = `oferta_${Date.now()}`
    setNodes((nds) => [...nds, { id, type: 'oferta', position: posNova(), data: { kind, nome, descricao: '', link: '' } }])
    setSelId(id)
  }

  const onImgFile = async (e, nodeId) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!/image\//.test(f.type)) { toast.error('Escolha uma imagem.'); return }
    if (f.size > 10 * 1024 * 1024) { toast.error('Imagem muito grande (máx. 10 MB).'); return }
    setUploadingImg(true)
    try {
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
      const { url } = await uploadAtendenteAsset(uid, f, ext, f.type)
      upd(nodeId, { url, nome: f.name })
    } catch (err) { toast.error('Erro ao subir a imagem.') }
    finally { setUploadingImg(false) }
  }

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges])
  const sel = useMemo(() => nodes.find((n) => n.id === selId) || null, [nodes, selId])

  // Posição pra um novo bloco: no CENTRO do que o usuário está vendo (respeita zoom/pan).
  const rfRef = useRef(null)
  const wrapRef = useRef(null)
  const posNova = () => {
    const inst = rfRef.current
    const wrap = wrapRef.current
    if (inst?.screenToFlowPosition && wrap) {
      const r = wrap.getBoundingClientRect()
      const jx = (Math.random() - 0.5) * 90
      const jy = (Math.random() - 0.5) * 90
      return inst.screenToFlowPosition({ x: r.left + r.width / 2 + jx, y: r.top + r.height / 2 + jy })
    }
    return { x: 200 + Math.round(Math.random() * 120), y: 200 }
  }

  const upd = (id, patch) => setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  const addNode = (type) => {
    const id = `${type}_${Date.now()}`
    const data = type === 'contexto' ? { titulo: '', texto: '' }
      : ehConhecimento(type) ? { texto: '' }
      : type === 'plano' ? { nome: '', preco: '', descricao: '', grupoId: '', grupoNome: '' }
      : (type === 'imagem' || type === 'audio') ? { url: '', nome: '' }
      : type === 'agradecimento' ? { texto: '' }
      : type === 'esperar' ? { valor: 5, unidade: 'min' }
      : type === 'condicao' ? { tipo: 'comprou' }
      : type === 'mensagem' ? { texto: '', gerarIA: true }
      : { nome: '', link: '' }
    setNodes((nds) => [...nds, { id, type, position: posNova(), data }])
    setSelId(id)
  }
  const removerNode = (id) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelId(null)
  }

  // ── Copiar / Colar blocos (Ctrl+C / Ctrl+V) ──
  const clipboardRef = useRef({ nodes: [], edges: [] })
  const copiar = () => {
    const marcados = nodes.filter((n) => n.selected && n.type !== 'ia') // IA é única, não copia
    if (!marcados.length) return
    const ids = new Set(marcados.map((n) => n.id))
    clipboardRef.current = {
      nodes: marcados.map((n) => ({ oldId: n.id, type: n.type, position: n.position, data: JSON.parse(JSON.stringify(n.data || {})) })),
      edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target })),
    }
    toast.success(`${marcados.length} bloco(s) copiado(s)`)
  }
  const colar = () => {
    const clip = clipboardRef.current
    if (!clip.nodes?.length) return
    const stamp = Date.now()
    const idMap = {}
    let upN = nodes.filter((n) => n.type === 'oferta' && n.data?.kind === 'up').length
    let dwN = nodes.filter((n) => n.type === 'oferta' && n.data?.kind === 'dw').length
    const temPrincipal = nodes.some((n) => n.type === 'oferta' && (n.data?.kind === 'vsl' || n.data?.kind === 'tsl'))
    const novos = []
    clip.nodes.forEach((n, i) => {
      if (n.type === 'oferta' && (n.data?.kind === 'vsl' || n.data?.kind === 'tsl') && temPrincipal) return // não duplica página principal
      const newId = `${n.type}_${stamp}_${i}`
      idMap[n.oldId] = newId
      const data = { ...n.data }
      if (n.type === 'oferta' && n.data?.kind === 'up') { upN += 1; data.nome = `UP${upN}` }
      if (n.type === 'oferta' && n.data?.kind === 'dw') { dwN += 1; data.nome = `DW${dwN}` }
      novos.push({ id: newId, type: n.type, position: { x: (n.position?.x || 0) + 48, y: (n.position?.y || 0) + 48 }, data, selected: true })
    })
    if (!novos.length) return
    const novasEdges = (clip.edges || []).filter((e) => idMap[e.source] && idMap[e.target]).map((e, i) => ({ id: `e_${stamp}_${i}`, source: idMap[e.source], target: idMap[e.target], animated: true }))
    setNodes((nds) => [...nds.map((x) => ({ ...x, selected: false })), ...novos])
    setEdges((eds) => [...eds, ...novasEdges])
    setSelId(null)
    toast.success(`${novos.length} bloco(s) colado(s)`)
  }
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { copiar() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { colar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, edges])

  const salvar = async (fechar = false) => {
    const iaNode = nodes.find((n) => n.type === 'ia')
    const persona = iaNode?.data?.persona || 'amigavel'
    // Blocos de conhecimento (por tipo) — coleta TODOS (o usuário monta o fluxo livre; não exige ligação à IA).
    const textoDoTipo = (tipo) => nodes.filter((n) => n.type === tipo).map((n) => (n.data?.texto || '').trim()).filter(Boolean).join('\n\n')
    const contextos = nodes.filter((n) => n.type === 'contexto')
    const iaContexto = contextos.map((n) => `${n.data?.titulo ? `[${n.data.titulo}] ` : ''}${n.data?.texto || ''}`.trim()).filter(Boolean).join('\n\n')
    const iaSuporte = contextos.map((n) => (n.data?.suporte || '').trim()).filter(Boolean).join('\n')
    const iaLinkApp = contextos.map((n) => (n.data?.link || '').trim()).filter(Boolean).join('\n')
    const iaObjetivo = textoDoTipo('objetivo')
    const iaRegras = textoDoTipo('regras')
    const iaObjecoes = textoDoTipo('objecoes')
    const iaProvaSocial = textoDoTipo('provasocial')
    // Planos, cada um com o checkout que ele aponta
    const planoNodes = nodes.filter((n) => n.type === 'plano')
    const iaPlanos = planoNodes.map((p) => {
      const ck = nodes.find((n) => n.id === edges.find((e) => e.source === p.id)?.target && n.type === 'checkout')
      return { nome: p.data?.nome || '', preco: p.data?.preco || '', descricao: p.data?.descricao || '', grupoNome: p.data?.grupoNome || '', checkoutNome: ck?.data?.nome || '', checkoutLink: ck?.data?.link || '' }
    }).filter((p) => p.nome || p.checkoutLink)
    // Funil de ofertas (VSL/TSL principal + upsells + downsells), cada oferta com o checkout que aponta.
    const linkCkDe = (o) => nodes.find((n) => n.id === edges.find((e) => e.source === o.id)?.target && n.type === 'checkout')?.data?.link || ''
    const ofertas = nodes.filter((n) => n.type === 'oferta')
    const mapOferta = (o) => ({ nome: o.data?.nome || '', grupoId: o.data?.grupoId || '', grupoNome: o.data?.grupoNome || '', descricao: o.data?.descricao || '', link: o.data?.link || '', checkoutLink: linkCkDe(o) })
    const principalNode = ofertas.find((o) => o.data?.kind === 'vsl' || o.data?.kind === 'tsl')
    const iaFunil = {
      principal: principalNode ? { kind: principalNode.data?.kind, ...mapOferta(principalNode) } : null,
      upsells: ofertas.filter((o) => o.data?.kind === 'up').map(mapOferta),
      downsells: ofertas.filter((o) => o.data?.kind === 'dw').map(mapOferta),
    }
    // Mídias (imagem/áudio): cada uma com o gatilho (bloco de origem) que a dispara.
    const midiaNodes = nodes.filter((n) => n.type === 'imagem' || n.type === 'audio')
    const iaMidias = midiaNodes.map((m) => {
      const src = nodes.find((n) => n.id === edges.find((e) => e.target === m.id)?.source)
      let gatilho = null
      if (src) {
        if (src.type === 'checkout') gatilho = { tipo: 'checkout', link: src.data?.link || '', nome: src.data?.nome || '' }
        else if (src.type === 'plano') gatilho = { tipo: 'plano', nome: src.data?.nome || '' }
        else if (ehConhecimento(src.type)) gatilho = { tipo: src.type }
      }
      return { tipo: m.type, url: m.data?.url || '', nome: m.data?.nome || '', gatilho }
    }).filter((m) => m.url)
    // Agradecimentos: uma mensagem que pode estar ligada a VÁRIOS checkouts (checkout → agradecimento).
    const iaAgradecimentos = nodes.filter((n) => n.type === 'agradecimento').map((a) => {
      const cks = edges.filter((e) => e.target === a.id).map((e) => nodes.find((n) => n.id === e.source && n.type === 'checkout')).filter(Boolean)
      return { texto: a.data?.texto || '', checkouts: cks.map((c) => ({ nome: c.data?.nome || '', link: c.data?.link || '' })) }
    }).filter((a) => a.texto && a.checkouts.length)
    const cleanNodes = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))
    const cleanEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) }))
    setSalvando(true)
    try {
      await onSave({ iaGraph: { nodes: cleanNodes, edges: cleanEdges }, iaPersona: persona, iaContexto, iaSuporte, iaLinkApp, iaObjetivo, iaRegras, iaObjecoes, iaProvaSocial, iaPlanos, iaFunil, iaAgradecimentos, iaMidias })
      if (fechar) onClose()
    } catch (_) { /* onSave já mostra o toast de erro */ } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-[90vw] max-w-[90vw] h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shrink-0"><Rocket className="w-4 h-4" /></span>
          <h3 className="text-sm font-semibold text-stone-800 truncate flex-1">Atendente IA · {grupo?.nome}</h3>
          <span className="text-xs text-stone-400 hidden lg:flex items-center gap-1">Shift+clique seleciona vários · Ctrl+C / Ctrl+V copia e cola</span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-100 flex-wrap">
          <span className="text-xs text-stone-400">Adicionar:</span>
          <button onClick={() => addNode('contexto')} className="btn-secondary text-xs min-h-[36px] px-3"><FileText className="w-3.5 h-3.5" /> Contexto</button>
          <button onClick={() => addNode('objetivo')} className="btn-secondary text-xs min-h-[36px] px-3"><Target className="w-3.5 h-3.5" /> Objetivo</button>
          <button onClick={() => addNode('regras')} className="btn-secondary text-xs min-h-[36px] px-3"><Shield className="w-3.5 h-3.5" /> Regras</button>
          <button onClick={() => addNode('objecoes')} className="btn-secondary text-xs min-h-[36px] px-3"><MessageCircle className="w-3.5 h-3.5" /> Objeções</button>
          <button onClick={() => addNode('provasocial')} className="btn-secondary text-xs min-h-[36px] px-3"><Star className="w-3.5 h-3.5" /> Prova social</button>
          <span className="w-px h-5 bg-surface-200 mx-1" />
          {/* Páginas do funil (VSL/TSL/UP/DW) */}
          <div className="relative">
            <button onClick={() => setPagMenuOpen((v) => !v)} className="btn-secondary text-xs min-h-[36px] px-3"><Layers className="w-3.5 h-3.5" /> Páginas <ChevronDown className="w-3 h-3" /></button>
            {pagMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPagMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 w-52 rounded-xl border border-surface-200 bg-white shadow-lg p-1.5">
                  <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Página principal</p>
                  <button onClick={() => addOferta('vsl')} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left text-sm text-stone-700"><Video className="w-4 h-4 text-indigo-500" /> Página VSL <span className="text-[10px] text-stone-400">(vídeo)</span></button>
                  <button onClick={() => addOferta('tsl')} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left text-sm text-stone-700"><FileText className="w-4 h-4 text-blue-500" /> Página TSL <span className="text-[10px] text-stone-400">(texto)</span></button>
                  <div className="h-px bg-surface-100 my-1" />
                  <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Depois da compra</p>
                  <button onClick={() => addOferta('up')} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left text-sm text-stone-700"><TrendingUp className="w-4 h-4 text-emerald-500" /> Upsell (UP)</button>
                  <button onClick={() => addOferta('dw')} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left text-sm text-stone-700"><TrendingDown className="w-4 h-4 text-amber-500" /> Downsell (DW)</button>
                </div>
              </>
            )}
          </div>
          <span className="w-px h-5 bg-surface-200 mx-1" />
          <button onClick={() => addNode('plano')} className="btn-secondary text-xs min-h-[36px] px-3"><Package className="w-3.5 h-3.5" /> Plano</button>
          <button onClick={() => addNode('checkout')} className="btn-secondary text-xs min-h-[36px] px-3"><ShoppingBag className="w-3.5 h-3.5" /> Checkout</button>
          <button onClick={() => addNode('agradecimento')} className="btn-secondary text-xs min-h-[36px] px-3"><Gift className="w-3.5 h-3.5" /> Agradecimento</button>
          <span className="w-px h-5 bg-surface-200 mx-1" />
          <button onClick={() => addNode('imagem')} className="btn-secondary text-xs min-h-[36px] px-3"><ImageIcon className="w-3.5 h-3.5" /> Imagem</button>
          <button onClick={() => addNode('audio')} className="btn-secondary text-xs min-h-[36px] px-3"><AudioLines className="w-3.5 h-3.5" /> Áudio</button>
          <span className="w-px h-5 bg-surface-200 mx-1" />
          <button onClick={() => addNode('esperar')} className="btn-secondary text-xs min-h-[36px] px-3" title="Follow-up: aguarda o lead ficar em silêncio"><Clock className="w-3.5 h-3.5" /> Esperar</button>
          <button onClick={() => addNode('condicao')} className="btn-secondary text-xs min-h-[36px] px-3" title="Ramifica por Comprou? (Sim/Não)"><GitBranch className="w-3.5 h-3.5" /> Condição</button>
          <button onClick={() => addNode('mensagem')} className="btn-secondary text-xs min-h-[36px] px-3" title="Mensagem de reativação (IA ou texto fixo)"><Bell className="w-3.5 h-3.5" /> Mensagem</button>
          <span className="w-px h-5 bg-surface-200 mx-1 ml-auto" />
          <button onClick={copiar} title="Copiar blocos selecionados (Ctrl+C)" className="btn-secondary text-xs min-h-[36px] px-3"><Copy className="w-3.5 h-3.5" /> Copiar</button>
          <button onClick={colar} title="Colar (Ctrl+V)" className="btn-secondary text-xs min-h-[36px] px-3"><ClipboardPaste className="w-3.5 h-3.5" /> Colar</button>
          <button onClick={() => salvar(false)} disabled={salvando} title="Grava sem fechar o fluxo" className="inline-flex items-center gap-1.5 text-xs min-h-[36px] px-3 rounded-xl bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-50">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Gravar</button>
        </div>

        {/* Canvas */}
        <div ref={wrapRef} className="relative flex-1 min-h-0">
          <ReactFlow
            onInit={(inst) => { rfRef.current = inst }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelId(n.id)}
            onPaneClick={() => setSelId(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background gap={16} color="#e7e5e4" />
            <Controls />
            <MiniMap pannable zoomable className="!bg-surface-50" />
          </ReactFlow>

          {/* Painel do nó selecionado */}
          {sel && (
            <div className="absolute top-3 right-3 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-surface-200 p-4 space-y-3 z-10 max-h-[calc(88vh-8rem)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-stone-800">
                  {sel.type === 'ia' ? 'Atendente IA' : ehConhecimento(sel.type) ? CONHECIMENTO[sel.type].label : sel.type === 'plano' ? 'Plano' : sel.type === 'checkout' ? 'Checkout' : sel.type === 'imagem' ? 'Imagem' : sel.type === 'audio' ? 'Áudio' : sel.type === 'oferta' ? (OFERTA[sel.data?.kind]?.label || 'Oferta') : sel.type === 'agradecimento' ? 'Agradecimento' : sel.type === 'esperar' ? 'Esperar' : sel.type === 'condicao' ? 'Condição: Comprou?' : sel.type === 'mensagem' ? 'Mensagem de follow-up' : ''}
                </p>
                <button onClick={() => setSelId(null)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>

              {sel.type === 'ia' && (
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Perfil comercial</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PERSONAS.map((p) => {
                      const on = sel.data?.persona === p.key
                      return (
                        <button key={p.key} type="button" onClick={() => upd(sel.id, { persona: p.key })} className={`rounded-xl border-2 px-3 py-2.5 text-center transition ${on ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}>
                          <p className="text-sm font-semibold text-stone-800">{p.label}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {sel.type === 'contexto' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Título</label>
                    <input value={sel.data?.titulo || ''} onChange={(e) => upd(sel.id, { titulo: e.target.value })} placeholder="Ex.: Sobre o produto / FAQ" className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Texto</label>
                    <textarea value={sel.data?.texto || ''} onChange={(e) => upd(sel.id, { texto: e.target.value })} rows={6} placeholder={CONHECIMENTO.contexto.ph} className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Suporte <span className="text-stone-400">(e-mails/telefones)</span></label>
                    <textarea value={sel.data?.suporte || ''} onChange={(e) => upd(sel.id, { suporte: e.target.value })} rows={2} placeholder="Ex.: suporte@empresa.com · WhatsApp (11) 90000-0000" className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                    <p className="text-[11px] text-stone-400 mt-1">A IA manda o cliente falar com o suporte pra dúvidas de uso (login, configuração, problemas).</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Link do app / plataforma <span className="text-stone-400">(opcional)</span></label>
                    <input value={sel.data?.link || ''} onChange={(e) => upd(sel.id, { link: e.target.value })} placeholder="https://app.suaempresa.com" className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                    <p className="text-[11px] text-stone-400 mt-1">O link certo pra IA mandar quando o cliente perguntar onde acessar. A IA nunca inventa link.</p>
                  </div>
                </>
              )}

              {ehConhecimento(sel.type) && sel.type !== 'contexto' && (
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">{CONHECIMENTO[sel.type].label}</label>
                  <textarea value={sel.data?.texto || ''} onChange={(e) => upd(sel.id, { texto: e.target.value })} rows={7} placeholder={CONHECIMENTO[sel.type].ph} className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                </div>
              )}

              {sel.type === 'plano' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Produto (grupo)</label>
                    <Select value={sel.data?.grupoId || ''} onChange={(v) => { const g = grupos.find((x) => x.id === v); upd(sel.id, { grupoId: v, grupoNome: g?.nome || '', nome: (sel.data?.nome || g?.nome || '') }) }} withThumb title="Selecionar produto" placeholder="Escolher produto" className="w-full" options={grupos.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Nome do plano</label>
                    <input value={sel.data?.nome || ''} onChange={(e) => upd(sel.id, { nome: e.target.value })} placeholder="Ex.: Plano Mensal" className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Preço / recorrência</label>
                    <input value={sel.data?.preco || ''} onChange={(e) => upd(sel.id, { preco: e.target.value })} placeholder="Ex.: US$47 / mês" className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Descrição</label>
                    <textarea value={sel.data?.descricao || ''} onChange={(e) => upd(sel.id, { descricao: e.target.value })} rows={3} placeholder="O que inclui, cupom, diferencial..." className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <p className="text-[11px] text-stone-400">Puxe a bolinha de baixo deste plano até um bloco <b>Checkout</b> pra ligar o link.</p>
                </>
              )}

              {sel.type === 'checkout' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Nome do checkout</label>
                    <input value={sel.data?.nome || ''} onChange={(e) => upd(sel.id, { nome: e.target.value })} placeholder="Ex.: Checkout $47" className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Link</label>
                    {sel.data?.link ? (
                      <div className="flex items-center gap-2 p-2 rounded-xl border border-surface-200">
                        <Link2 className="w-4 h-4 text-primary-500 shrink-0" />
                        <span className="flex-1 min-w-0 text-[11px] text-stone-500 truncate" title={sel.data.link}>{sel.data.link}</span>
                        <button onClick={() => { setCkQ(''); setCkPickerFor(sel.id) }} className="text-xs text-primary-600 hover:underline shrink-0">Trocar</button>
                      </div>
                    ) : (
                      <button onClick={() => { setCkQ(''); setCkPickerFor(sel.id) }} className="w-full inline-flex items-center justify-center gap-2 min-h-[40px] rounded-xl border border-surface-200 text-sm text-stone-600 hover:bg-surface-50"><ShoppingBag className="w-4 h-4" /> Escolher checkout</button>
                    )}
                  </div>
                </>
              )}

              {sel.type === 'imagem' && (
                <div className="space-y-2">
                  {sel.data?.url && <img src={sel.data.url} alt="" className="rounded-xl max-h-44 w-full object-contain border border-surface-200" />}
                  <input ref={imgInputRef} type="file" accept="image/*" onChange={(e) => onImgFile(e, sel.id)} className="hidden" />
                  <button onClick={() => imgInputRef.current?.click()} disabled={uploadingImg} className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] rounded-xl border border-surface-200 text-sm text-stone-600 hover:bg-surface-50 disabled:opacity-50">
                    {uploadingImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {sel.data?.url ? 'Trocar imagem' : 'Subir imagem'}
                  </button>
                  <p className="text-[11px] text-stone-400">A IA manda essa imagem depois do bloco ligado a ela (checkout, plano, objeção...).</p>
                </div>
              )}

              {sel.type === 'audio' && (
                <div className="space-y-2">
                  {sel.data?.url && <AudioPlayer src={sel.data.url} />}
                  <button onClick={() => setAudioPickerFor(sel.id)} className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] rounded-xl border border-surface-200 text-sm text-stone-600 hover:bg-surface-50">
                    <AudioLines className="w-4 h-4" /> {sel.data?.url ? 'Trocar áudio' : 'Escolher áudio'}
                  </button>
                  <p className="text-[11px] text-stone-400">Os áudios ficam em <b>Templates → Áudio</b> (grave ou suba lá). A IA manda depois do bloco ligado.</p>
                </div>
              )}

              {sel.type === 'oferta' && (
                <>
                  <p className="text-xs font-semibold text-stone-500">
                    {OFERTA[sel.data?.kind]?.label}{(sel.data?.kind === 'up' || sel.data?.kind === 'dw') ? ` · ${sel.data?.nome}` : ' (principal)'}
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Produto (grupo)</label>
                    <Select value={sel.data?.grupoId || ''} onChange={(v) => { const g = grupos.find((x) => x.id === v); upd(sel.id, { grupoId: v, grupoNome: g?.nome || '' }) }} withThumb title="Selecionar produto" placeholder="Escolher produto" className="w-full" options={grupos.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))} />
                    {(sel.data?.kind === 'dw') && <p className="text-[11px] text-amber-600 mt-1">Downsell = o MESMO produto do upsell, mais barato/com cupom.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Descrição da oferta (pitch + preço)</label>
                    <textarea value={sel.data?.descricao || ''} onChange={(e) => upd(sel.id, { descricao: e.target.value })} rows={4}
                      placeholder={sel.data?.kind === 'up' ? 'Como a IA vende esse produto + o preço. Ex.: "aquecedor de chip com IA, protege contra ban — R$29,90".' : sel.data?.kind === 'dw' ? 'O mesmo produto com desconto/cupom + o preço menor. Ex.: "leva por R$19,90, promo só pra você".' : 'A oferta principal: o que vende essa página, o que inclui, preço.'}
                      className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Link da página {sel.data?.kind === 'vsl' ? 'VSL' : sel.data?.kind === 'tsl' ? 'TSL' : 'da oferta'} <span className="text-stone-400">(opcional)</span></label>
                    <input value={sel.data?.link || ''} onChange={(e) => upd(sel.id, { link: e.target.value })} placeholder="https://..." className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                  </div>
                  <p className="text-[11px] text-stone-400">Puxe a bolinha de baixo até um bloco <b>Checkout</b> pra ligar o link de pagamento{(sel.data?.kind === 'up' || sel.data?.kind === 'dw') ? '. Só é oferecido DEPOIS da compra da oferta principal.' : '.'}</p>
                </>
              )}

              {sel.type === 'agradecimento' && (
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Mensagem de agradecimento</label>
                  <textarea value={sel.data?.texto || ''} onChange={(e) => upd(sel.id, { texto: e.target.value })} rows={5} placeholder='Ex.: "Muito obrigado pela compra! 🎉 Qualquer dúvida na hora de usar, é só me chamar aqui."' className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                  <p className="text-[11px] text-stone-400 mt-1">Ligue um <b>Checkout</b> (bolinha de baixo dele) até aqui. A IA manda essa mensagem quando o cliente comprar aquela oferta.</p>
                </div>
              )}

              {sel.type === 'esperar' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Esperar</label>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} value={sel.data?.valor ?? 5} onChange={(e) => upd(sel.id, { valor: Math.max(1, parseInt(e.target.value || '1', 10)) })} className="w-24 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                      <Select value={sel.data?.unidade || 'min'} onChange={(v) => upd(sel.id, { unidade: v })} className="flex-1" options={[{ value: 'min', label: 'minuto(s)' }, { value: 'hora', label: 'hora(s)' }, { value: 'dia', label: 'dia(s)' }]} />
                    </div>
                  </div>
                  <p className="text-[11px] text-stone-400">O tempo começa a contar após a <b>última mensagem do bot</b>. Se o lead responder antes, a espera é cancelada e a IA volta a conversar. Ligue a bolinha de baixo ao próximo passo (Condição ou Mensagem).</p>
                </>
              )}

              {sel.type === 'condicao' && (
                <>
                  <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                    <p className="text-sm font-medium text-stone-700 flex items-center gap-2"><GitBranch className="w-4 h-4 text-purple-600" /> O lead comprou?</p>
                    <p className="text-[11px] text-stone-500 mt-1">Considera compra <b>deste grupo de produto</b> desde que a espera começou.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">✓ Sim</span>
                    <span className="text-stone-400">→ saída da esquerda (comprou, ex.: agradece / para de vender)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-600">✗ Não</span>
                    <span className="text-stone-400">→ saída da direita (não comprou, ex.: nova tentativa)</span>
                  </div>
                  <p className="text-[11px] text-stone-400">Se a compra bater <b>durante a espera</b>, sai pelo <b>Sim</b> na hora.</p>
                </>
              )}

              {sel.type === 'mensagem' && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={sel.data?.gerarIA !== false} onChange={(e) => upd(sel.id, { gerarIA: e.target.checked })} className="w-4 h-4 rounded accent-primary-600" />
                    <span className="text-xs font-medium text-stone-700">Gerar com IA (reativação natural, usando o contexto)</span>
                  </label>
                  {sel.data?.gerarIA !== false ? (
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Instrução pra IA <span className="text-stone-400">(opcional)</span></label>
                      <textarea value={sel.data?.texto || ''} onChange={(e) => upd(sel.id, { texto: e.target.value })} rows={3} placeholder='Ex.: "Retoma a conversa com leveza, lembra do benefício X e pergunta se ainda tem interesse."' className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Texto fixo</label>
                      <textarea value={sel.data?.texto || ''} onChange={(e) => upd(sel.id, { texto: e.target.value })} rows={4} placeholder='Ex.: "Oi {nome}! Ainda dá tempo de garantir o seu. Quer que eu te mande o link?"' className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm" />
                    </div>
                  )}
                  <p className="text-[11px] text-stone-400">Ligue Imagem/Áudio embaixo desta mensagem pra mandar junto. Depois pode ligar outro <b>Esperar</b> pra continuar o follow-up.</p>
                </>
              )}

              {sel.type !== 'ia' && (
                <button onClick={() => removerNode(sel.id)} className="w-full text-xs text-red-600 hover:bg-red-50 rounded-lg py-2 flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remover bloco</button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary min-h-[40px]">Cancelar</button>
          <button onClick={() => salvar(true)} disabled={salvando} className="btn-primary min-h-[40px]">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
        </div>
      </div>

      {/* Popup: escolher checkout pra um nó */}
      {ckPickerFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setCkPickerFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ShoppingBag className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Escolher checkout</h3>
              <button onClick={() => setCkPickerFor(null)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input value={ckQ} onChange={(e) => setCkQ(e.target.value)} placeholder="Pesquisar checkout..." autoFocus className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
            </div>
            {(() => {
              const q = ckQ.trim().toLowerCase()
              const filt = q ? checkoutsFlat.filter((c) => (c.nome || '').toLowerCase().includes(q) || (c.link || '').toLowerCase().includes(q)) : checkoutsFlat
              if (checkoutsFlat.length === 0) return <p className="px-2 py-6 text-sm text-stone-500 text-center">Nenhum checkout cadastrado (em Checkouts).</p>
              return (
                <ul className="space-y-1 max-h-[320px] overflow-y-auto">
                  {filt.length === 0 && <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>}
                  {filt.map((c, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => { upd(ckPickerFor, { link: c.link, nome: (nodes.find((n) => n.id === ckPickerFor)?.data?.nome) || c.nome }); setCkPickerFor(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-100 text-left transition-colors">
                        <Link2 className="w-4 h-4 text-primary-500 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-stone-800 truncate">{c.nome}</span>
                          <span className="block text-[11px] text-stone-400 truncate">{c.link}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </div>
        </div>
      )}

      {/* Escolher áudio (templates) pra um nó de áudio */}
      <AudioTemplatePicker
        uid={uid}
        open={!!audioPickerFor}
        onClose={() => setAudioPickerFor(null)}
        onPick={(t) => { upd(audioPickerFor, { url: t.audioUrl, nome: t.nome }); setAudioPickerFor(null) }}
      />
    </div>
  )
}

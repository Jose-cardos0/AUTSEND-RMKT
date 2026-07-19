import { useState, useCallback, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PERSONAS, personaLabel } from '../lib/atendentePersonas'
import { uploadAtendenteAsset } from '../lib/firestore'
import AudioTemplatePicker from './AudioTemplatePicker'
import AudioPlayer from './AudioPlayer'
import { Rocket, FileText, Package, ShoppingBag, Plus, Save, Trash2, X, Search, Link2, Loader2, Target, Shield, MessageCircle, Star, Image as ImageIcon, AudioLines, Upload } from 'lucide-react'

// Blocos de CONHECIMENTO (texto que alimenta o cérebro da IA). Cada um vira um campo derivado ao salvar.
const CONHECIMENTO = {
  contexto:    { label: 'Contexto',         Icon: FileText,      border: 'border-sky-200',    text: 'text-sky-700',    ph: 'O que a IA precisa saber: produto, o que faz, funcionamento, FAQ.' },
  objetivo:    { label: 'Objetivo',         Icon: Target,        border: 'border-amber-300',  text: 'text-amber-700',  ph: 'A meta da IA. Ex.: vender o plano mensal; qualificar e agendar; tirar dúvida e fechar a venda.' },
  regras:      { label: 'Regras / Limites', Icon: Shield,        border: 'border-rose-300',   text: 'text-rose-700',   ph: 'O que a IA NÃO pode fazer. Ex.: nunca prometa reembolso; não invente preço; não dê conselho médico.' },
  objecoes:    { label: 'Objeções',         Icon: MessageCircle, border: 'border-orange-300', text: 'text-orange-700', ph: 'Como rebater. Ex.: "tá caro" → mostre o custo-benefício; "vou pensar" → crie urgência com o cupom.' },
  provasocial: { label: 'Prova social',     Icon: Star,          border: 'border-yellow-400', text: 'text-yellow-700', ph: 'Depoimentos e resultados que a IA pode citar. Ex.: "+3 mil clientes", print do resultado da Maria...' },
}
const ehConhecimento = (t) => t in CONHECIMENTO

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
const nodeTypes = { ia: IaNode, contexto: KnowledgeNode, objetivo: KnowledgeNode, regras: KnowledgeNode, objecoes: KnowledgeNode, provasocial: KnowledgeNode, plano: PlanoNode, checkout: CheckoutNode, imagem: MidiaNode, audio: MidiaNode }

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

export default function AtendenteFlowEditor({ grupo, checkoutsFlat = [], uid, onClose, onSave }) {
  const inicial = useMemo(() => grafoInicial(grupo), [grupo])
  const [nodes, setNodes, onNodesChange] = useNodesState(inicial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(inicial.edges)
  const [selId, setSelId] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [ckPickerFor, setCkPickerFor] = useState(null) // id do nó checkout escolhendo link
  const [ckQ, setCkQ] = useState('')
  const [audioPickerFor, setAudioPickerFor] = useState(null) // id do nó áudio escolhendo template
  const [uploadingImg, setUploadingImg] = useState(false)
  const imgInputRef = useRef(null)

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

  const upd = (id, patch) => setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  const addNode = (type) => {
    const id = `${type}_${Date.now()}`
    const data = type === 'contexto' ? { titulo: '', texto: '' }
      : ehConhecimento(type) ? { texto: '' }
      : type === 'plano' ? { nome: '', preco: '', descricao: '' }
      : (type === 'imagem' || type === 'audio') ? { url: '', nome: '' }
      : { nome: '', link: '' }
    setNodes((nds) => [...nds, { id, type, position: { x: 120 + Math.round(Math.random() * 240), y: 220 + nds.length * 20 }, data }])
    setSelId(id)
  }
  const removerNode = (id) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelId(null)
  }

  const salvar = async () => {
    const iaNode = nodes.find((n) => n.type === 'ia')
    const persona = iaNode?.data?.persona || 'amigavel'
    const ligadoAIa = (id) => edges.some((e) => e.source === (iaNode?.id) && e.target === id)
    // Blocos de conhecimento ligados à IA (por tipo)
    const textoDoTipo = (tipo) => nodes.filter((n) => n.type === tipo && ligadoAIa(n.id)).map((n) => (n.data?.texto || '').trim()).filter(Boolean).join('\n\n')
    const contextos = nodes.filter((n) => n.type === 'contexto' && ligadoAIa(n.id))
    const iaContexto = contextos.map((n) => `${n.data?.titulo ? `[${n.data.titulo}] ` : ''}${n.data?.texto || ''}`.trim()).filter(Boolean).join('\n\n')
    const iaObjetivo = textoDoTipo('objetivo')
    const iaRegras = textoDoTipo('regras')
    const iaObjecoes = textoDoTipo('objecoes')
    const iaProvaSocial = textoDoTipo('provasocial')
    // Planos ligados à IA, cada um com o checkout que ele aponta
    const planoNodes = nodes.filter((n) => n.type === 'plano' && ligadoAIa(n.id))
    const iaPlanos = planoNodes.map((p) => {
      const ckId = edges.find((e) => e.source === p.id)?.target
      const ck = nodes.find((n) => n.id === ckId && n.type === 'checkout')
      return { nome: p.data?.nome || '', preco: p.data?.preco || '', descricao: p.data?.descricao || '', checkoutNome: ck?.data?.nome || '', checkoutLink: ck?.data?.link || '' }
    }).filter((p) => p.nome || p.checkoutLink)
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
    const cleanNodes = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))
    const cleanEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
    setSalvando(true)
    try {
      await onSave({ iaGraph: { nodes: cleanNodes, edges: cleanEdges }, iaPersona: persona, iaContexto, iaObjetivo, iaRegras, iaObjecoes, iaProvaSocial, iaPlanos, iaMidias })
    } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-[90vw] max-w-[90vw] h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shrink-0"><Rocket className="w-4 h-4" /></span>
          <h3 className="text-sm font-semibold text-stone-800 truncate flex-1">Atendente IA · {grupo?.nome}</h3>
          <span className="text-xs text-stone-400 hidden sm:flex items-center gap-1">Ligue os blocos à IA · Plano → Checkout</span>
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
          <button onClick={() => addNode('plano')} className="btn-secondary text-xs min-h-[36px] px-3"><Package className="w-3.5 h-3.5" /> Plano</button>
          <button onClick={() => addNode('checkout')} className="btn-secondary text-xs min-h-[36px] px-3"><ShoppingBag className="w-3.5 h-3.5" /> Checkout</button>
          <span className="w-px h-5 bg-surface-200 mx-1" />
          <button onClick={() => addNode('imagem')} className="btn-secondary text-xs min-h-[36px] px-3"><ImageIcon className="w-3.5 h-3.5" /> Imagem</button>
          <button onClick={() => addNode('audio')} className="btn-secondary text-xs min-h-[36px] px-3"><AudioLines className="w-3.5 h-3.5" /> Áudio</button>
          <button onClick={salvar} disabled={salvando} className="btn-primary text-xs min-h-[36px] px-3 ml-auto">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
        </div>

        {/* Canvas */}
        <div className="relative flex-1 min-h-0">
          <ReactFlow
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
                  {sel.type === 'ia' ? 'Atendente IA' : ehConhecimento(sel.type) ? CONHECIMENTO[sel.type].label : sel.type === 'plano' ? 'Plano' : sel.type === 'checkout' ? 'Checkout' : sel.type === 'imagem' ? 'Imagem' : 'Áudio'}
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

              {sel.type !== 'ia' && (
                <button onClick={() => removerNode(sel.id)} className="w-full text-xs text-red-600 hover:bg-red-50 rounded-lg py-2 flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remover bloco</button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary min-h-[40px]">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="btn-primary min-h-[40px]">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
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

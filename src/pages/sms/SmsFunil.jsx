import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { auth, functions } from '../../lib/firebase'
import { getSmsFunnels, saveSmsFunnel, deleteSmsFunnel, getProductGroups, getFunnelSends } from '../../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../../lib/constants'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { useConfirm } from '../../components/ConfirmDialog'
import MessageEditor from '../../components/MessageEditor'
import CollapsibleSearch from '../../components/CollapsibleSearch'
import { Play, Clock, GitBranch, Plus, Save, Trash2, Loader2, X, UserPlus, CheckCircle2, XCircle, RefreshCw, Send, ChevronLeft, ChevronRight, ShoppingBag, MessageSquare } from 'lucide-react'

const eventoLabel = (id) => KIWIFY_EVENTS.find((e) => e.id === id)?.label
const formatDate = (ts) => {
  if (!ts) return '-'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Normaliza pra E.164 internacional (espelho do backend). Rejeita BR (+55). */
function normalizarE164Internacional(raw) {
  let s = String(raw || '').trim()
  const temMais = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false }
  if (!temMais && d.length === 10) d = '1' + d
  if (d.startsWith('55')) return { ok: false, br: true }
  if (d.length < 8 || d.length > 15) return { ok: false }
  return { ok: true, e164: '+' + d }
}

// ───────── Nós customizados ─────────
function InicioNode({ selected, data }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-green-50 shadow-sm ${selected ? 'border-primary-500' : 'border-green-300'}`}>
      <div className="flex items-center gap-2 text-green-700 font-semibold text-sm"><Play className="w-4 h-4" /> Início</div>
      <p className="text-[11px] text-green-600/80 mt-0.5">{data?.evento ? `Evento: ${eventoLabel(data.evento) || data.evento}` : 'Manual / evento'}</p>
      {data?.grupoNome && <p className="text-[10px] text-green-600/70">Produto: {data.grupoNome}</p>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function EnviarNode({ data, selected }) {
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[180px] max-w-[220px] ${selected ? 'border-primary-500' : 'border-sky-200'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-sky-700 font-semibold text-sm"><MessageSquare className="w-4 h-4" /> Enviar SMS</div>
      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">{data?.mensagem ? data.mensagem : 'Escreva o SMS'}</p>
      {data?._enviados > 0 && (
        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center shadow" title={`${data._enviados} envio(s)`}>{data._enviados}</span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function EsperarNode({ data, selected }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-amber-50 shadow-sm ${selected ? 'border-primary-500' : 'border-amber-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm"><Clock className="w-4 h-4" /> Esperar</div>
      <p className="text-[11px] text-amber-600/90 mt-0.5">{data?.valor ?? 1} {data?.unidade || 'dias'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function CondicaoNode({ selected }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-violet-50 shadow-sm min-w-[170px] relative ${selected ? 'border-primary-500' : 'border-violet-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-violet-700 font-semibold text-sm"><ShoppingBag className="w-4 h-4" /> Condição</div>
      <p className="text-[11px] text-violet-600/90 mt-0.5">Comprou?</p>
      <span className="absolute right-2 top-[30%] text-[10px] font-bold text-green-600">Sim</span>
      <span className="absolute right-2 top-[64%] text-[10px] font-bold text-red-500">Não</span>
      <Handle type="source" position={Position.Right} id="sim" style={{ top: '35%', background: '#16a34a' }} />
      <Handle type="source" position={Position.Right} id="nao" style={{ top: '70%', background: '#ef4444' }} />
    </div>
  )
}
const nodeTypes = { inicio: InicioNode, enviar: EnviarNode, esperar: EsperarNode, condicao: CondicaoNode }

const novoInicio = () => ({ id: `inicio_${Date.now()}`, type: 'inicio', position: { x: 280, y: 40 }, data: {} })

export default function SmsFunil() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [funis, setFunis] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [nome, setNome] = useState('')
  const [ativo, setAtivo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollList, setEnrollList] = useState('')
  const [inscrevendo, setInscrevendo] = useState(false)
  const [grupos, setGrupos] = useState([])
  const [funnelSends, setFunnelSends] = useState([])
  const [pSends, setPSends] = useState(1)
  const [buscaSends, setBuscaSends] = useState('')
  const [sortSends, setSortSends] = useState({ key: 'quando', dir: 'desc' })
  const toggleSortSends = (key) =>
    setSortSends((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  useEffect(() => { setPSends(1) }, [buscaSends, sortSends])

  const seenKey = user?.uid ? `sendly:sms-funnel-seen:${user.uid}` : null
  const [seenSends, setSeenSends] = useState({})
  useEffect(() => {
    if (!seenKey) return
    try { setSeenSends(JSON.parse(localStorage.getItem(seenKey) || '{}')) } catch { setSeenSends({}) }
  }, [seenKey])
  const countByFunnel = useMemo(() => {
    const m = {}
    for (const s of funnelSends) m[s.funnelId] = (m[s.funnelId] || 0) + 1
    return m
  }, [funnelSends])
  useEffect(() => {
    if (!seenKey || !selectedId) return
    const c = countByFunnel[selectedId] || 0
    setSeenSends((prev) => {
      if (prev[selectedId] === c) return prev
      const next = { ...prev, [selectedId]: c }
      try { localStorage.setItem(seenKey, JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [seenKey, selectedId, countByFunnel])
  const funnelBadge = (id) => Math.max(0, (countByFunnel[id] || 0) - (seenSends[id] || 0))

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getSmsFunnels(user.uid, canal), getProductGroups(user.uid), getFunnelSends(user.uid)])
      .then(([fs, gs, sends]) => {
        setFunis(fs)
        setGrupos(gs)
        setFunnelSends(sends.filter((s) => s.canal === 'sms' && (s.smsCanal || 'eua') === canal))
        if (fs.length > 0) carregarFunil(fs[0])
      })
      .finally(() => setLoading(false))
  }, [user?.uid, canal])

  useEffect(() => {
    if (!selectedId) return
    const counts = {}
    funnelSends.filter((s) => s.funnelId === selectedId && s.status === 'enviado').forEach((s) => { counts[s.nodeId] = (counts[s.nodeId] || 0) + 1 })
    setNodes((nds) => nds.map((n) => (n.type === 'enviar' ? { ...n, data: { ...n.data, _enviados: counts[n.id] || 0 } } : n)))
    setPSends(1)
  }, [funnelSends, selectedId, setNodes])

  const carregarFunil = (f) => {
    setSelectedId(f.id)
    setNome(f.nome || '')
    setAtivo(!!f.ativo)
    setNodes(Array.isArray(f.nodes) && f.nodes.length ? f.nodes : [novoInicio()])
    setEdges(Array.isArray(f.edges) ? f.edges : [])
    setSelectedNodeId(null)
  }

  const novoFunil = () => {
    setSelectedId(null)
    setNome('')
    setAtivo(false)
    setNodes([novoInicio()])
    setEdges([])
    setSelectedNodeId(null)
  }

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges])

  const addNode = (type) => {
    const id = `${type}_${Date.now()}`
    const data = type === 'esperar' ? { valor: 1, unidade: 'dias' } : type === 'enviar' ? { mensagem: '' } : {}
    setNodes((nds) => [...nds, { id, type, position: { x: 200 + Math.round(Math.random() * 120), y: 160 + nds.length * 30 }, data }])
  }

  const updateNodeData = (id, patch) =>
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))

  const removerNode = (id) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelectedNodeId(null)
  }

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId])

  const handleSalvar = async () => {
    if (!user?.uid) return
    if (!nome.trim()) { toast.error('Dê um nome ao funil.'); return }
    setSalvando(true)
    try {
      const cleanNodes = nodes.map((n) => {
        const data = {}
        for (const [k, v] of Object.entries(n.data || {})) if (!k.startsWith('_')) data[k] = v
        return { id: n.id, type: n.type, position: n.position, data }
      })
      const cleanEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null }))
      const inicio = nodes.find((n) => n.type === 'inicio')
      const gatilhoEvento = inicio?.data?.evento || null
      const gatilhoGrupoId = inicio?.data?.grupoId || null
      const id = await saveSmsFunnel(user.uid, selectedId, { nome: nome.trim(), ativo, gatilhoEvento, gatilhoGrupoId, smsCanal: canal, nodes: cleanNodes, edges: cleanEdges })
      setFunis(await getSmsFunnels(user.uid, canal))
      setSelectedId(id)
      toast.success('Funil salvo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar funil')
    } finally {
      setSalvando(false)
    }
  }

  const inscreverLista = async () => {
    if (!selectedId) { toast.error('Salve o funil primeiro para poder inscrever.'); return }
    let brIgnorados = 0
    const recipients = enrollList.split(/\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[\t,;]/).map((p) => p.trim()).filter(Boolean)
      const numeroRaw = parts.find((p) => p.replace(/\D/g, '').length >= 8) || parts[0] || ''
      const nomeC = parts.filter((p) => p !== numeroRaw).join(' ')
      const norm = normalizarE164Internacional(numeroRaw)
      if (norm.br) brIgnorados++
      return { telefone: norm.ok ? norm.e164 : '', nome: nomeC, ok: norm.ok }
    }).filter((r) => r.ok).map((r) => ({ telefone: r.telefone, nome: r.nome }))
    if (recipients.length === 0) { toast.error('Nenhum número internacional válido na lista. SMS não atende números do Brasil (+55).'); return }
    setInscrevendo(true)
    try {
      const fn = httpsCallable(functions, 'enrollFunnel')
      const res = await fn({ funnelId: selectedId, recipients, canal: 'sms' })
      toast.success(`${res.data?.inscritos || 0} contato(s) inscrito(s) no funil.`)
      if (brIgnorados > 0) toast(`${brIgnorados} número(s) do Brasil foram ignorados (SMS só internacional).`, { icon: '🇧🇷' })
      setShowEnroll(false)
      setEnrollList('')
    } catch (err) {
      toast.error(err.message || 'Erro ao inscrever')
    } finally {
      setInscrevendo(false)
    }
  }

  const carregarSends = async () => {
    if (!user?.uid) return
    try { setFunnelSends((await getFunnelSends(user.uid)).filter((s) => s.canal === 'sms')) } catch (_) {}
  }

  const handleExcluir = async () => {
    if (!selectedId) return
    if (!(await confirm({ title: `Excluir o funil "${nome}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteSmsFunnel(user.uid, selectedId)
      const fs = await getSmsFunnels(user.uid, canal)
      setFunis(fs)
      fs.length ? carregarFunil(fs[0]) : novoFunil()
      toast.success('Funil excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const sendsDoFunil = funnelSends.filter((s) => s.funnelId === selectedId)
  const sendsOrdenados = (() => {
    const val = (s) => {
      switch (sortSends.key) {
        case 'contato': return (s.contato?.nome || '').toLowerCase()
        case 'telefone': return (s.contato?.telefone || '').toString()
        case 'produto': return (s.contato?.produto || '').toLowerCase()
        case 'status': return s.status || ''
        case 'quando': return s.createdAt?.toMillis?.() ?? s.createdAt ?? 0
        default: return 0
      }
    }
    let list = sendsDoFunil
    const q = buscaSends.trim().toLowerCase()
    if (q) list = list.filter((s) =>
      (s.contato?.nome || '').toLowerCase().includes(q) ||
      (s.contato?.telefone || '').toString().includes(q) ||
      (s.contato?.produto || '').toLowerCase().includes(q)
    )
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return sortSends.dir === 'asc' ? -1 : 1
      if (va > vb) return sortSends.dir === 'asc' ? 1 : -1
      return 0
    })
  })()
  const SENDS_POR_PAGINA = 10
  const totalPagSends = Math.max(1, Math.ceil(sendsOrdenados.length / SENDS_POR_PAGINA))
  const pSendsAtual = Math.min(pSends, totalPagSends)
  const sendsPagina = sendsOrdenados.slice((pSendsAtual - 1) * SENDS_POR_PAGINA, pSendsAtual * SENDS_POR_PAGINA)

  const msgAtual = selectedNode?.data?.mensagem || ''
  const segmentos = Math.max(1, Math.ceil((msgAtual.length || 1) / 160))

  return (
    <PageShell
      badge={`SMS · Funil · ${canal === 'api' ? "API's" : 'EUA'}`}
      title="Funil de SMS"
      right={
        <div className="flex flex-wrap gap-2 items-center">
          <Select
            value={selectedId || ''}
            onChange={(v) => { const f = funis.find((x) => x.id === v); f ? carregarFunil(f) : novoFunil() }}
            className="w-full sm:w-52"
            options={[{ value: '', label: 'Novo funil' }, ...funis.map((f) => ({ value: f.id, label: f.nome, badge: funnelBadge(f.id) }))]}
          />
          <button onClick={novoFunil} className="btn-secondary text-sm min-h-[40px]"><Plus className="w-4 h-4" /> Novo</button>
          {selectedId && <button onClick={handleExcluir} className="p-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={handleSalvar} disabled={salvando} className="btn-primary text-sm min-h-[40px]">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
        </div>
      }
    >
      <div className="space-y-3">
      <div className="shrink-0 app-panel rounded-2xl p-3 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do funil" className="w-full sm:w-56 px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm" />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <button type="button" onClick={() => setAtivo((a) => !a)} className={`relative w-11 h-6 rounded-full transition-colors ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : ''}`} />
          </button>
          {ativo ? 'Ativo' : 'Inativo'}
        </label>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <span className="text-xs text-stone-400 self-center">Adicionar:</span>
          <button onClick={() => addNode('enviar')} className="btn-secondary text-xs min-h-[38px] px-3"><MessageSquare className="w-3.5 h-3.5" /> SMS</button>
          <button onClick={() => addNode('esperar')} className="btn-secondary text-xs min-h-[38px] px-3"><Clock className="w-3.5 h-3.5" /> Esperar</button>
          <button onClick={() => addNode('condicao')} className="btn-secondary text-xs min-h-[38px] px-3"><GitBranch className="w-3.5 h-3.5" /> Condição</button>
          <button onClick={() => setShowEnroll(true)} className="btn-primary text-xs min-h-[38px] px-3"><UserPlus className="w-3.5 h-3.5" /> Inscrever lista</button>
        </div>
      </div>

      <div className="relative app-panel rounded-2xl overflow-hidden h-[60vh]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedNodeId(n.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background gap={16} color="#e7e5e4" />
          <Controls />
          <MiniMap pannable zoomable className="!bg-surface-50" />
        </ReactFlow>

        {selectedNode && (
          <div className="absolute top-3 right-3 w-[28rem] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-surface-200 p-4 space-y-3 z-10">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">
                {selectedNode.type === 'inicio' ? 'Início (quem entra)' : selectedNode.type === 'enviar' ? 'Enviar SMS' : selectedNode.type === 'esperar' ? 'Esperar' : 'Condição — Comprou?'}
              </p>
              <button onClick={() => setSelectedNodeId(null)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>

            {selectedNode.type === 'inicio' && (
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Gatilho — evento que inicia</label>
                <Select
                  value={selectedNode.data?.evento || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { evento: v })}
                  className="w-full"
                  options={[{ value: '', label: 'Somente manual (lista)' }, ...KIWIFY_EVENTS.map((ev) => ({ value: ev.id, label: ev.label }))]}
                />
                <p className="text-[11px] text-stone-400 mt-1">Com um evento, quem disparar esse evento no Tracker entra sozinho (precisa ter telefone internacional). Também dá pra inscrever uma lista manualmente.</p>

                <label className="block text-xs font-medium text-stone-600 mb-1 mt-3">Produto (grupo)</label>
                <Select
                  value={selectedNode.data?.grupoId || ''}
                  onChange={(v) => { const g = grupos.find((x) => x.id === v); updateNodeData(selectedNode.id, { grupoId: v, grupoNome: g?.nome || '' }) }}
                  className="w-full"
                  withThumb
                  options={[{ value: '', label: 'Todos os produtos' }, ...grupos.map((g) => ({ value: g.id, label: g.nome, image: g.imagem }))]}
                />
              </div>
            )}

            {selectedNode.type === 'enviar' && (
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Texto do SMS</label>
                <MessageEditor
                  value={selectedNode.data?.mensagem || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { mensagem: v })}
                  placeholder={'Autsend: hey {nome_cliente}, your offer for {nome_produto} expires today! Reply STOP to opt out.'}
                  variables={TEMPLATE_VARIABLES}
                  showCheckout
                  rows={5}
                />
                <p className="text-[11px] text-stone-400 mt-1">
                  {msgAtual.length} caractere(s) · <span className={segmentos > 1 ? 'text-amber-600 font-medium' : ''}>{segmentos} segmento(s)</span>. Acentos são removidos automaticamente. Coloque o nome da marca no texto.
                </p>
              </div>
            )}

            {selectedNode.type === 'esperar' && (
              <div className="flex gap-2">
                <input type="number" min={1} value={selectedNode.data?.valor ?? 1} onChange={(e) => updateNodeData(selectedNode.id, { valor: Number(e.target.value) })} className="w-20 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                <Select
                  value={selectedNode.data?.unidade || 'dias'}
                  onChange={(v) => updateNodeData(selectedNode.id, { unidade: v })}
                  className="flex-1"
                  searchable={false}
                  options={[{ value: 'minutos', label: 'minutos' }, { value: 'horas', label: 'horas' }, { value: 'dias', label: 'dias' }]}
                />
              </div>
            )}

            {selectedNode.type === 'condicao' && (
              <div>
                <p className="text-xs text-stone-600">Verifica se o contato <strong>fez uma compra aprovada</strong> depois de entrar no funil.</p>
                <p className="text-[11px] text-stone-400 mt-1">Ligue a saída <strong className="text-green-600">Sim</strong> (comprou) e a <strong className="text-red-500">Não</strong> (não comprou) aos próximos passos.</p>
              </div>
            )}

            {selectedNode.type !== 'inicio' && (
              <button onClick={() => removerNode(selectedNode.id)} className="w-full text-xs text-red-600 hover:bg-red-50 rounded-lg py-2 flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remover nó</button>
            )}
          </div>
        )}
      </div>

      {/* Relatório de envios do funil */}
      <div className="app-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-surface-100 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-stone-800 min-w-0"><Send className="w-4 h-4 text-primary-600 shrink-0" /> <span className="truncate">Relatório de envios</span></span>
          <div className="flex items-center gap-2 shrink-0">
            <CollapsibleSearch value={buscaSends} onChange={setBuscaSends} placeholder="Contato, telefone ou produto" />
            <button onClick={carregarSends} className="text-xs text-primary-600 hover:underline flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Atualizar</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {sendsOrdenados.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">{buscaSends ? 'Nenhum envio encontrado.' : 'Nenhum envio deste funil ainda. Quando um contato entrar e um nó "Enviar SMS" disparar, aparece aqui.'}</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-surface-100 text-left text-stone-500">
                  {[['contato', 'Contato'], ['telefone', 'Número'], ['produto', 'Produto'], ['status', 'Enviado?'], ['quando', 'Quando']].map(([key, label]) => (
                    <th key={key} onClick={() => toggleSortSends(key)} className="px-4 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                      {label}{sortSends.key === key ? (sortSends.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sendsPagina.map((s) => (
                  <tr key={s.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                    <td className="px-4 py-2.5 font-medium text-stone-800 truncate max-w-[160px]">{s.contato?.nome || '—'}</td>
                    <td className="px-4 py-2.5 text-stone-600 font-mono text-xs">{s.contato?.telefone || '—'}</td>
                    <td className="px-4 py-2.5 text-stone-600 truncate max-w-[120px]">{s.contato?.produto || '—'}</td>
                    <td className="px-4 py-2.5">
                      {s.status === 'enviado' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Enviado</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><XCircle className="w-3.5 h-3.5" /> Falhou</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sendsOrdenados.length > SENDS_POR_PAGINA && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Página {pSendsAtual} de {totalPagSends} · {sendsOrdenados.length} envio(s)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPSends((p) => Math.max(1, p - 1))} disabled={pSendsAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPSends((p) => Math.min(totalPagSends, p + 1))} disabled={pSendsAtual >= totalPagSends} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
      </div>

      {showEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowEnroll(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><UserPlus className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Inscrever lista no funil</h3>
                <p className="text-xs text-stone-500">Um número por linha, com DDI (número ou número,nome). Só internacional.</p>
              </div>
            </div>
            <textarea value={enrollList} onChange={(e) => setEnrollList(e.target.value)} rows={8} placeholder={'+14155552671\n+442079460958,Mary'} className="w-full p-3 rounded-xl border border-surface-200 font-mono text-sm resize-y" autoFocus />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEnroll(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={inscreverLista} disabled={inscrevendo} className="btn-primary min-h-[44px]">{inscrevendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Inscrever</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

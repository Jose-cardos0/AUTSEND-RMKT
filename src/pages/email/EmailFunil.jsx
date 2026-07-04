import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { auth, functions } from '../../lib/firebase'
import { getEmailFunnels, saveEmailFunnel, deleteEmailFunnel, getEmailTemplates } from '../../lib/firestore'
import { KIWIFY_EVENTS } from '../../lib/constants'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Play, Mail, Clock, GitBranch, Plus, Save, Trash2, Loader2, X, UserPlus } from 'lucide-react'

const eventoLabel = (id) => KIWIFY_EVENTS.find((e) => e.id === id)?.label

// ───────── Nós customizados ─────────
function InicioNode({ selected, data }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-green-50 shadow-sm ${selected ? 'border-primary-500' : 'border-green-300'}`}>
      <div className="flex items-center gap-2 text-green-700 font-semibold text-sm"><Play className="w-4 h-4" /> Início</div>
      <p className="text-[11px] text-green-600/80 mt-0.5">{data?.evento ? `Evento: ${eventoLabel(data.evento) || data.evento}` : 'Manual / evento'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function EnviarNode({ data, selected }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[170px] ${selected ? 'border-primary-500' : 'border-primary-200'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-primary-700 font-semibold text-sm"><Mail className="w-4 h-4" /> Enviar e-mail</div>
      <p className="text-[11px] text-stone-500 mt-0.5 truncate max-w-[150px]">{data?.templateNome || 'Escolha um template'}</p>
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
function CondicaoNode({ data, selected }) {
  const label = data?.evento === 'clicked' ? 'Clicou no link?' : 'Abriu o e-mail?'
  return (
    <div className={`rounded-xl border-2 px-4 py-3 bg-violet-50 shadow-sm min-w-[170px] relative ${selected ? 'border-primary-500' : 'border-violet-300'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-violet-700 font-semibold text-sm"><GitBranch className="w-4 h-4" /> Condição</div>
      <p className="text-[11px] text-violet-600/90 mt-0.5">{label}</p>
      <span className="absolute right-2 top-[30%] text-[10px] font-bold text-green-600">Sim</span>
      <span className="absolute right-2 top-[64%] text-[10px] font-bold text-red-500">Não</span>
      <Handle type="source" position={Position.Right} id="sim" style={{ top: '35%', background: '#16a34a' }} />
      <Handle type="source" position={Position.Right} id="nao" style={{ top: '70%', background: '#ef4444' }} />
    </div>
  )
}
const nodeTypes = { inicio: InicioNode, enviar: EnviarNode, esperar: EsperarNode, condicao: CondicaoNode }

const novoInicio = () => ({ id: `inicio_${Date.now()}`, type: 'inicio', position: { x: 280, y: 40 }, data: {} })

export default function EmailFunil() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [funis, setFunis] = useState([])
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [nome, setNome] = useState('')
  const [ativo, setAtivo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollList, setEnrollList] = useState('')
  const [inscrevendo, setInscrevendo] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getEmailFunnels(user.uid), getEmailTemplates(user.uid)])
      .then(([fs, tpls]) => {
        setFunis(fs)
        setTemplates(tpls)
        if (fs.length > 0) carregarFunil(fs[0])
      })
      .finally(() => setLoading(false))
  }, [user?.uid])

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
    const data = type === 'esperar' ? { valor: 1, unidade: 'dias' } : type === 'condicao' ? { evento: 'opened' } : {}
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
      const cleanNodes = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data || {} }))
      const cleanEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null }))
      const inicio = nodes.find((n) => n.type === 'inicio')
      const gatilhoEvento = inicio?.data?.evento || null
      const id = await saveEmailFunnel(user.uid, selectedId, { nome: nome.trim(), ativo, gatilhoEvento, nodes: cleanNodes, edges: cleanEdges })
      setFunis(await getEmailFunnels(user.uid))
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
    const recipients = enrollList.split(/\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[\t,;]/).map((p) => p.trim()).filter(Boolean)
      const email = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) || parts[0] || ''
      const nome = parts.filter((p) => p !== email).join(' ')
      return { email, nome }
    }).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
    if (recipients.length === 0) { toast.error('Nenhum e-mail válido na lista.'); return }
    setInscrevendo(true)
    try {
      const fn = httpsCallable(functions, 'enrollFunnel')
      const res = await fn({ funnelId: selectedId, recipients })
      toast.success(`${res.data?.inscritos || 0} contato(s) inscrito(s) no funil.`)
      setShowEnroll(false)
      setEnrollList('')
    } catch (err) {
      toast.error(err.message || 'Erro ao inscrever')
    } finally {
      setInscrevendo(false)
    }
  }

  const handleExcluir = async () => {
    if (!selectedId) return
    if (!window.confirm(`Excluir o funil "${nome}"?`)) return
    try {
      await deleteEmailFunnel(user.uid, selectedId)
      const fs = await getEmailFunnels(user.uid)
      setFunis(fs)
      fs.length ? carregarFunil(fs[0]) : novoFunil()
      toast.success('Funil excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      fill
      badge="E-mail · Funil"
      title="Funil de e-mail"
      subtitle="Arraste os nós e ligue com setas: envie, espere e ramifique conforme abriu / clicou."
      right={
        <div className="flex flex-wrap gap-2 items-center">
          <select value={selectedId || ''} onChange={(e) => { const f = funis.find((x) => x.id === e.target.value); f ? carregarFunil(f) : novoFunil() }} className="px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm bg-white">
            <option value="">Novo funil</option>
            {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <button onClick={novoFunil} className="btn-secondary text-sm min-h-[40px]"><Plus className="w-4 h-4" /> Novo</button>
          {selectedId && <button onClick={handleExcluir} className="p-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={handleSalvar} disabled={salvando} className="btn-primary text-sm min-h-[40px]">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
        </div>
      }
    >
      {/* Barra: nome + ativo + adicionar nós */}
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
          <button onClick={() => addNode('enviar')} className="btn-secondary text-xs min-h-[38px] px-3"><Mail className="w-3.5 h-3.5" /> Enviar</button>
          <button onClick={() => addNode('esperar')} className="btn-secondary text-xs min-h-[38px] px-3"><Clock className="w-3.5 h-3.5" /> Esperar</button>
          <button onClick={() => addNode('condicao')} className="btn-secondary text-xs min-h-[38px] px-3"><GitBranch className="w-3.5 h-3.5" /> Condição</button>
          <button onClick={() => setShowEnroll(true)} className="btn-primary text-xs min-h-[38px] px-3"><UserPlus className="w-3.5 h-3.5" /> Inscrever lista</button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 min-h-0 app-panel rounded-2xl overflow-hidden">
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

        {/* Painel de configuração do nó */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-64 bg-white rounded-2xl shadow-xl border border-surface-200 p-4 space-y-3 z-10">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">
                {selectedNode.type === 'inicio' ? 'Início (quem entra)' : selectedNode.type === 'enviar' ? 'Enviar e-mail' : selectedNode.type === 'esperar' ? 'Esperar' : 'Condição'}
              </p>
              <button onClick={() => setSelectedNodeId(null)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>

            {selectedNode.type === 'inicio' && (
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Gatilho — evento que inicia</label>
                <select value={selectedNode.data?.evento || ''} onChange={(e) => updateNodeData(selectedNode.id, { evento: e.target.value })} className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm bg-white">
                  <option value="">Somente manual (lista)</option>
                  {KIWIFY_EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                </select>
                <p className="text-[11px] text-stone-400 mt-1">Com um evento, quem disparar esse evento no Tracker entra sozinho. Você também pode inscrever uma lista manualmente.</p>
              </div>
            )}

            {selectedNode.type === 'enviar' && (
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Template</label>
                <select
                  value={selectedNode.data?.templateId || ''}
                  onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value)
                    updateNodeData(selectedNode.id, { templateId: e.target.value, templateNome: t?.nome || '' })
                  }}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm bg-white"
                >
                  <option value="">{templates.length === 0 ? 'SEM TEMPLATE' : '— escolha —'}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
            )}

            {selectedNode.type === 'esperar' && (
              <div className="flex gap-2">
                <input type="number" min={1} value={selectedNode.data?.valor ?? 1} onChange={(e) => updateNodeData(selectedNode.id, { valor: Number(e.target.value) })} className="w-20 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm" />
                <select value={selectedNode.data?.unidade || 'dias'} onChange={(e) => updateNodeData(selectedNode.id, { unidade: e.target.value })} className="flex-1 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm bg-white">
                  <option value="minutos">minutos</option>
                  <option value="horas">horas</option>
                  <option value="dias">dias</option>
                </select>
              </div>
            )}

            {selectedNode.type === 'condicao' && (
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Se o contato…</label>
                <select value={selectedNode.data?.evento || 'opened'} onChange={(e) => updateNodeData(selectedNode.id, { evento: e.target.value })} className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm bg-white">
                  <option value="opened">Abriu o e-mail</option>
                  <option value="clicked">Clicou no link</option>
                </select>
                <p className="text-[11px] text-stone-400 mt-1">Ligue a saída <strong className="text-green-600">Sim</strong> e a <strong className="text-red-500">Não</strong> a próximos passos.</p>
              </div>
            )}

            {selectedNode.type !== 'inicio' && (
              <button onClick={() => removerNode(selectedNode.id)} className="w-full text-xs text-red-600 hover:bg-red-50 rounded-lg py-2 flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remover nó</button>
            )}
          </div>
        )}
      </div>

      {showEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowEnroll(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><UserPlus className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Inscrever lista no funil</h3>
                <p className="text-xs text-stone-500">Um e-mail por linha (email ou email,nome).</p>
              </div>
            </div>
            <textarea value={enrollList} onChange={(e) => setEnrollList(e.target.value)} rows={8} placeholder={'cliente@email.com\nmaria@email.com,Maria'} className="w-full p-3 rounded-xl border border-surface-200 font-mono text-sm resize-y" autoFocus />
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

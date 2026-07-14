import { useCallback } from 'react'
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState, Handle, Position } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Play, ShoppingBag } from 'lucide-react'
import WhatsAppIcon from '../components/WhatsAppIcon'

/* Demo interativo — NÃO afeta nenhum funil real. É só um template pra brincar na landing. */

function InicioNode() {
  return (
    <div className="rounded-xl border-2 px-4 py-3 bg-green-50 shadow-sm border-green-300">
      <div className="flex items-center gap-2 text-green-700 font-semibold text-sm"><Play className="w-4 h-4" /> Início</div>
      <p className="text-[11px] text-green-600/80 mt-0.5">Evento: Compra Aprovada</p>
      <p className="text-[10px] text-green-600/70">Produto: Autsend</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function EnviarNode({ data }) {
  return (
    <div className="relative rounded-xl border-2 px-4 py-3 bg-white shadow-sm min-w-[180px] max-w-[220px] border-green-200">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-green-700 font-semibold text-sm"><WhatsAppIcon className="w-4 h-4" /> Enviar mensagem</div>
      <p className="text-[11px] text-stone-500 mt-0.5 uppercase tracking-wide">{data?.label}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
function CondicaoNode() {
  return (
    <div className="rounded-xl border-2 px-4 py-3 bg-violet-50 shadow-sm min-w-[170px] relative border-violet-300">
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

const nodeTypes = { inicio: InicioNode, enviar: EnviarNode, condicao: CondicaoNode }

// Igual ao FUNIL-UPSELL: Início → UPSELL1 → Condição → (não) próximo upsell / (sim) página de obrigado
const initialNodes = [
  { id: 'inicio', type: 'inicio', position: { x: 170, y: 430 }, data: {} },
  { id: 'upsell1', type: 'enviar', position: { x: 380, y: 600 }, data: { label: 'UPSELL1' } },
  { id: 'cond1', type: 'condicao', position: { x: 160, y: 315 }, data: {} },
  { id: 'upsell2', type: 'enviar', position: { x: 430, y: 175 }, data: { label: 'UPSELL2' } },
  { id: 'cond2', type: 'condicao', position: { x: 500, y: 300 }, data: {} },
  { id: 'upsell3', type: 'enviar', position: { x: 590, y: 445 }, data: { label: 'UPSELL3' } },
  { id: 'cond3', type: 'condicao', position: { x: 810, y: 510 }, data: {} },
  { id: 'obrigado', type: 'enviar', position: { x: 880, y: 300 }, data: { label: 'PÁGINA OBRIGADO' } },
]
const initialEdges = [
  { id: 'e1', source: 'inicio', target: 'upsell1' },
  { id: 'e2', source: 'upsell1', target: 'cond1' },
  { id: 'e3', source: 'cond1', sourceHandle: 'nao', target: 'upsell2' },
  { id: 'e4', source: 'cond1', sourceHandle: 'sim', target: 'obrigado' },
  { id: 'e5', source: 'upsell2', target: 'cond2' },
  { id: 'e6', source: 'cond2', sourceHandle: 'nao', target: 'upsell3' },
  { id: 'e7', source: 'cond2', sourceHandle: 'sim', target: 'obrigado' },
  { id: 'e8', source: 'upsell3', target: 'cond3' },
  { id: 'e9', source: 'cond3', sourceHandle: 'sim', target: 'obrigado' },
  { id: 'e10', source: 'cond3', sourceHandle: 'nao', target: 'obrigado' },
]

export default function FunilDemo() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const onConnect = useCallback((c) => setEdges((eds) => addEdge(c, eds)), [setEdges])
  return (
    <div className="rounded-2xl border border-surface-200 bg-white/70 backdrop-blur overflow-hidden h-[420px] sm:h-[520px] shadow-[0_10px_40px_-12px_rgba(74,70,222,0.18)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
      >
        <Background gap={18} color="#c7c9d9" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

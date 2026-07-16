import { useState, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getLeads, getCallLogs } from '../../lib/firestore'
import { KIWIFY_EVENTS } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { usePlano } from '../../lib/PlanoContext'
import { Phone, Sparkles, Loader2, Gauge, Search, CreditCard } from 'lucide-react'

const VOZES = [
  { value: 'Polly.Camila-Neural', label: 'Camila (feminina, natural)' },
  { value: 'Polly.Vitoria-Neural', label: 'Vitória (feminina)' },
  { value: 'Polly.Thiago-Neural', label: 'Thiago (masculina, natural)' },
  { value: 'Polly.Ricardo', label: 'Ricardo (masculina)' },
]
const eventLabel = (id) => (!id || id === 'unknown' || id === 'false') ? 'Outro' : (KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id)
const normTel = (t) => (t || '').replace(/\D/g, '')
function e164Valido(raw, permitirBR) {
  let d = normTel(raw)
  if (!d) return false
  if (raw && !String(raw).startsWith('+') && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return false
  return d.length >= 8 && d.length <= 15
}
const traduzErro = (e) => e || 'Erro'

function StatusBadge({ status, erro }) {
  const map = { atendida: 'bg-emerald-100 text-emerald-700', nao_atendida: 'bg-stone-100 text-stone-500', erro: 'bg-red-100 text-red-700' }
  const label = { atendida: 'Atendida', nao_atendida: 'Não atendida', erro: 'Erro' }
  return (
    <span title={status === 'erro' && erro ? erro : undefined} className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-stone-100 text-stone-500'}`}>
      {label[status] || 'Não ligado'}
    </span>
  )
}

export default function CallCampanha() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const permitirBR = canal === 'api'
  const plano = usePlano()

  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [callLogs, setCallLogs] = useState([])
  const [sel, setSel] = useState(() => new Set())
  const [fEvento, setFEvento] = useState('')
  const [fTexto, setFTexto] = useState('')

  // Agente
  const [objetivo, setObjetivo] = useState('Recuperar um carrinho abandonado e trazer o cliente de volta pra finalizar a compra')
  const [produto, setProduto] = useState('')
  const [texto, setTexto] = useState('')
  const [voz, setVoz] = useState('Polly.Camila-Neural')
  const [velocidade, setVelocidade] = useState(1)
  const [gerando, setGerando] = useState(false)
  const [ligando, setLigando] = useState(false)

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [ld, logs] = await Promise.all([getLeads(user.uid), getCallLogs(user.uid, canal)])
    setLeads(ld); setCallLogs(logs)
    setLoading(false)
  }
  useEffect(() => { carregar() }, [user?.uid, canal])

  const statusByLead = useMemo(() => {
    const m = {}
    for (const l of callLogs) { if (l.leadId && !(l.leadId in m)) m[l.leadId] = { status: l.status, erro: l.erroMsg } }
    return m
  }, [callLogs])

  const contatos = useMemo(() => {
    let list = leads.filter((l) => normTel(l.telefone))
    if (fEvento) list = list.filter((l) => (l.evento || '') === fEvento)
    if (fTexto.trim()) { const q = fTexto.toLowerCase(); list = list.filter((l) => (l.nome || '').toLowerCase().includes(q) || (l.telefone || '').includes(q) || (l.produto || '').toLowerCase().includes(q)) }
    return list
  }, [leads, fEvento, fTexto])

  const eventosDisponiveis = useMemo(() => {
    const s = new Set(leads.map((l) => l.evento).filter(Boolean))
    return [...s]
  }, [leads])

  const toggle = (id) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodos = () => {
    const validos = contatos.filter((l) => e164Valido(l.telefone, permitirBR))
    if (validos.every((l) => sel.has(l.id))) setSel(new Set())
    else setSel(new Set(validos.map((l) => l.id)))
  }

  const gerarRoteiro = async () => {
    setGerando(true)
    try {
      const fn = httpsCallable(functions, 'callGerarRoteiro')
      const r = await fn({ objetivo, produto: produto || undefined })
      setTexto(r.data?.texto || '')
      toast.success('Roteiro gerado! Ajuste como quiser.')
    } catch (err) {
      toast.error(err.message || 'Não consegui gerar o roteiro.')
    } finally { setGerando(false) }
  }

  const ligar = async () => {
    if (!texto.trim()) { toast.error('Escreva ou gere o roteiro da ligação.'); return }
    const escolhidos = contatos.filter((l) => sel.has(l.id) && e164Valido(l.telefone, permitirBR))
    if (!escolhidos.length) { toast.error('Selecione ao menos um contato válido.'); return }
    setLigando(true)
    try {
      const fn = httpsCallable(functions, 'callDisparar')
      const r = await fn({
        canal, texto, voz, velocidade,
        agenteNome: produto ? `IA · ${produto}` : 'Ligação IA',
        contatos: escolhidos.map((l) => ({ telefone: l.telefone, nome: l.nome, produto: l.produto, email: l.email, leadId: l.id })),
      })
      const { iniciadas = 0, erros = [] } = r.data || {}
      toast.success(`${iniciadas} ligação(ões) iniciada(s)!${erros.length ? ` ${erros.length} com erro.` : ''}`)
      setSel(new Set())
      setTimeout(carregar, 4000)
    } catch (err) {
      toast.error(err.message || 'Falha ao iniciar as ligações.')
    } finally { setLigando(false) }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const semVoz = !plano?.isAdmin && !plano?.temCallVoz
  const selValidos = contatos.filter((l) => sel.has(l.id) && e164Valido(l.telefone, permitirBR)).length

  return (
    <PageShell badge={`Call · Campanha · ${canal === 'api' ? "API's" : 'EUA'}`} subtitle="A IA liga pros seus contatos com um roteiro em voz natural.">
      {semVoz && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Você ainda não ativou a voz no seu chip. <Link to="/call/eua/integracao" className="font-semibold underline">Ativar agora</Link>.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Builder do agente */}
        <div className="lg:col-span-2">
          <Panel title="Agente de IA" icon={Sparkles}>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide">Objetivo da ligação</label>
            <textarea value={objetivo} onChange={(e) => setObjetivo(e.target.value)} rows={2} className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mt-1">Produto (opcional)</label>
            <input value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="Ex.: Método Emagrece 30" className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />
            <button onClick={gerarRoteiro} disabled={gerando} className="btn-secondary w-full min-h-[44px]">
              {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Gerar roteiro com IA
            </button>

            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mt-1">Roteiro falado</label>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Olá {nome}! Vi que você se interessou por {nome_produto}..." className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />
            <p className="text-[11px] text-stone-400">Variáveis: <code>{'{nome}'}</code>, <code>{'{nome_produto}'}</code>.</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide">Voz</label>
                <Select value={voz} onChange={setVoz} options={VOZES} className="w-full" />
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs font-semibold text-stone-500 uppercase tracking-wide"><Gauge className="w-3.5 h-3.5" /> Velocidade {velocidade.toFixed(1)}x</label>
                <input type="range" min="0.9" max="1.5" step="0.1" value={velocidade} onChange={(e) => setVelocidade(Number(e.target.value))} className="w-full mt-2 accent-primary-600" />
                <p className="text-[10px] text-stone-400 leading-tight">Mais rápido = ligação mais curta = menos custo.</p>
              </div>
            </div>
          </Panel>
        </div>

        {/* Contatos */}
        <div className="lg:col-span-3">
          <Panel
            title={`Contatos (${contatos.length})`}
            icon={Phone}
            noPadding
            right={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="Buscar" className="w-32 sm:w-40 h-8 pl-8 pr-2 rounded-lg border border-surface-200 text-sm outline-none" />
                </div>
                <Select value={fEvento} onChange={setFEvento} className="w-40" options={[{ value: '', label: 'Todos eventos' }, ...eventosDisponiveis.map((e) => ({ value: e, label: eventLabel(e) }))]} />
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-surface-100 text-left text-stone-500">
                    <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={selValidos > 0 && contatos.filter((l) => e164Valido(l.telefone, permitirBR)).every((l) => sel.has(l.id))} onChange={toggleTodos} className="accent-primary-600" /></th>
                    <th className="px-3 py-2.5 font-medium text-xs">Nome</th>
                    <th className="px-3 py-2.5 font-medium text-xs">Telefone</th>
                    <th className="px-3 py-2.5 font-medium text-xs">Produto</th>
                    <th className="px-3 py-2.5 font-medium text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contatos.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-400">Nenhum contato com telefone.</td></tr>
                  ) : contatos.map((l) => {
                    const valido = e164Valido(l.telefone, permitirBR)
                    const st = statusByLead[l.id]
                    return (
                      <tr key={l.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                        <td className="px-3 py-2.5"><input type="checkbox" disabled={!valido} checked={sel.has(l.id)} onChange={() => toggle(l.id)} className="accent-primary-600 disabled:opacity-30" /></td>
                        <td className="px-3 py-2.5"><div className="font-medium text-stone-800 truncate max-w-[140px]">{l.nome || '—'}</div><div className="text-xs text-stone-400 truncate max-w-[140px]">{l.email || ''}</div></td>
                        <td className="px-3 py-2.5 font-mono text-xs text-stone-600">{l.telefone || '—'}{!valido && <span className="ml-1 text-red-400" title={permitirBR ? 'Inválido' : 'Número BR não é permitido no canal EUA'}>•</span>}</td>
                        <td className="px-3 py-2.5 text-stone-700 truncate max-w-[120px]">{l.produto || '—'}</td>
                        <td className="px-3 py-2.5">{st ? <StatusBadge status={st.status} erro={st.erro} /> : <span className="text-xs text-stone-400">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-500">{selValidos} selecionado(s) · ~R$ {(selValidos * 1.5).toFixed(2).replace('.', ',')} se durar 1 min cada</p>
              <button onClick={ligar} disabled={ligando || selValidos === 0 || semVoz} className="btn-primary min-h-[44px]">
                {ligando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />} Ligar ({selValidos})
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getCallAutomations, saveCallAutomationGrupo, getProductGroups, getLeads, getCallLogs } from '../../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES, canonicalEvento } from '../../lib/constants'
import { usePlano } from '../../lib/PlanoContext'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import CollapsibleSearch from '../../components/CollapsibleSearch'
import ErroTip from '../../components/ErroTip'
import AudioTemplatePicker from '../../components/AudioTemplatePicker'
import AudioPlayer from '../../components/AudioPlayer'
import { PhoneCall, Loader2, RefreshCw, Package, Check, ChevronDown, ChevronUp, Filter, Sparkles, Volume2, Square, Zap, Gauge, FolderOpen, Play } from 'lucide-react'
import imgCamila from '../../assets/atendentes/camila.png'
import imgVitoria from '../../assets/atendentes/vitoria.png'
import imgThiago from '../../assets/atendentes/thiago.png'
import imgRicardo from '../../assets/atendentes/ricardo.png'
import euaflag from '../../assets/euaflag.png'

const VOZES = [
  { value: 'Polly.Camila-Neural', nome: 'Camila', desc: 'Feminina · natural', img: imgCamila },
  { value: 'Polly.Vitoria-Neural', nome: 'Vitória', desc: 'Feminina', img: imgVitoria },
  { value: 'Polly.Thiago-Neural', nome: 'Thiago', desc: 'Masculina · natural', img: imgThiago },
  { value: 'Polly.Ricardo', nome: 'Ricardo', desc: 'Masculina', img: imgRicardo },
]

/** Foto do atendente com fallback pra inicial do nome. */
function AtendenteFoto({ voz, className = '' }) {
  const [erro, setErro] = useState(false)
  return (
    <div className={`overflow-hidden bg-white ${className}`}>
      {erro ? (
        <div className="w-full h-full flex items-center justify-center text-xl font-bold text-primary-400">{voz.nome.charAt(0)}</div>
      ) : (
        <img src={voz.img} alt={voz.nome} onError={() => setErro(true)} className="w-full h-full object-cover" />
      )}
    </div>
  )
}

// Mapeia o evento Kiwify pro "objetivo" que a IA usa pra gerar o roteiro.
const EVENTO_OBJETIVO = {
  carrinho_abandonado: 'carrinho_abandonado',
  compra_aprovada: 'pos_venda',
  compra_recusada: 'oferta',
  reembolso: 'pos_venda',
  chargeback: 'pos_venda',
  assinatura_cancelada: 'recuperar_assinatura',
  assinatura_atrasada: 'recuperar_assinatura',
}

const eventLabel = (id) => KIWIFY_EVENTS.find((e) => e.id === id)?.label || id
const soDigitos = (s) => String(s || '').replace(/\D/g, '')
function e164Valido(raw, permitirBR) {
  let d = soDigitos(raw)
  if (!raw) return false
  if (!String(raw).trim().startsWith('+') && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return false
  return d.length >= 8 && d.length <= 15
}

function CallStatusBadge({ status, erro, count = 0 }) {
  const map = { atendida: 'bg-emerald-100 text-emerald-700', nao_atendida: 'bg-stone-100 text-stone-500', erro: 'bg-red-100 text-red-700' }
  const label = { atendida: 'Atendida', nao_atendida: 'Não atendida', erro: 'Erro' }
  const prefixo = count > 0 ? `${count}x ` : ''
  const badge = (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-stone-100 text-stone-500'}`}>
      {prefixo}{label[status] || 'Não ligado'}
    </span>
  )
  if (status === 'erro' && erro) return <ErroTip msg={erro}>{badge}</ErroTip>
  return badge
}

/** Card de configuração da automação de ligação de um evento (roteiro inline + voz, ou áudio próprio). */
function EventCard({ event, auto, onSave, canal, uid }) {
  const [expanded, setExpanded] = useState(false)
  const [roteiro, setRoteiro] = useState(auto?.roteiro || '')
  const [voz, setVoz] = useState(auto?.voz || 'Polly.Camila-Neural')
  const [velocidade, setVelocidade] = useState(Number(auto?.velocidade) || 1)
  const [ativo, setAtivo] = useState(auto?.ativo ?? false)
  const [audioTpl, setAudioTpl] = useState(auto?.audioUrl ? { id: auto.audioTemplateId, nome: auto.audioNome, url: auto.audioUrl } : null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [ouvindo, setOuvindo] = useState(false)
  const [carregandoVoz, setCarregandoVoz] = useState(false)
  const audioRef = useRef(null)
  const textoRef = useRef(null)

  useEffect(() => {
    setRoteiro(auto?.roteiro || '')
    setVoz(auto?.voz || 'Polly.Camila-Neural')
    setVelocidade(Number(auto?.velocidade) || 1)
    setAtivo(auto?.ativo ?? false)
    setAudioTpl(auto?.audioUrl ? { id: auto.audioTemplateId, nome: auto.audioNome, url: auto.audioUrl } : null)
  }, [auto?.roteiro, auto?.voz, auto?.velocidade, auto?.ativo, auto?.audioUrl])

  const persist = async (data) => onSave(event.id, {
    roteiro, voz, velocidade, ativo,
    audioUrl: audioTpl?.url || null, audioNome: audioTpl?.nome || '', audioTemplateId: audioTpl?.id || null,
    ...data,
  })

  const handleSave = async () => {
    if (!audioTpl && !roteiro.trim()) { toast.error('Escreva o roteiro ou escolha um áudio.'); return }
    setSalvando(true)
    try { await persist({}); toast.success(`Automação de ligação "${event.label}" salva.`) }
    catch { toast.error('Erro ao salvar automação.') }
    finally { setSalvando(false) }
  }

  const handleToggleAtivo = async () => {
    if (!ativo && !audioTpl && !roteiro.trim()) { toast.error('Configure o roteiro ou áudio antes de ativar.'); return }
    const novo = !ativo
    setAtivo(novo)
    try { await persist({ ativo: novo }) }
    catch { setAtivo(!novo); toast.error('Erro ao salvar.') }
  }

  const gerarComIA = async () => {
    setGerando(true)
    try {
      const fn = httpsCallable(functions, 'callGerarRoteiro')
      // Canal EUA liga p/ números internacionais → roteiro em inglês.
      const r = await fn({ objetivo: EVENTO_OBJETIVO[event.id] || 'oferta', tom: 'persuasivo', produto: '', categoria: '', idioma: canal === 'eua' ? 'en' : 'pt' })
      if (r.data?.texto) setRoteiro(r.data.texto)
    } catch (err) { toast.error(err.message || 'Não consegui gerar o roteiro.') }
    finally { setGerando(false) }
  }

  const ouvir = async () => {
    if (ouvindo) { audioRef.current?.pause(); audioRef.current = null; setOuvindo(false); return }
    if (!roteiro.trim()) { toast.error('Escreva ou gere o roteiro primeiro.'); return }
    setCarregandoVoz(true)
    try {
      const fn = httpsCallable(functions, 'callPreviewVoz')
      const r = await fn({ texto: roteiro.trim(), produto: '', voz, velocidade, canal })
      const audio = new Audio(r.data?.audio)
      audioRef.current = audio
      audio.onended = () => { setOuvindo(false); audioRef.current = null }
      audio.onerror = () => { setOuvindo(false); audioRef.current = null }
      setOuvindo(true)
      await audio.play()
    } catch (err) { setOuvindo(false); toast.error(err.message || 'Não consegui gerar a pré-escuta.') }
    finally { setCarregandoVoz(false) }
  }

  const inserirVar = (v) => {
    const el = textoRef.current
    if (!el) { setRoteiro((t) => t + v); return }
    const start = el.selectionStart ?? roteiro.length
    const end = el.selectionEnd ?? roteiro.length
    setRoteiro(roteiro.slice(0, start) + v + roteiro.slice(end))
  }

  return (
    <div className="app-panel border border-surface-200/90 rounded-2xl overflow-hidden bg-white/90">
      <div className="w-full flex items-center justify-between p-3 sm:p-4 min-h-[52px] gap-3">
        <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <PhoneCall className={`w-4 h-4 shrink-0 ${ativo ? 'text-emerald-500' : 'text-stone-400'}`} />
          <span className="font-medium text-stone-800">{event.label}</span>
          {ativo && <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Ativa</span>}
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={handleToggleAtivo} className={`relative w-11 h-6 rounded-full transition-colors ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`} title={ativo ? 'Desativar' : 'Ativar'}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-stone-400 p-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 pt-0 space-y-3 border-t border-surface-100">
          {audioTpl ? (
            <div className="rounded-xl bg-surface-50 border border-surface-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary-600 shrink-0" />
                <span className="text-sm font-medium text-stone-800 truncate flex-1">Áudio: {audioTpl.nome || 'template'}</span>
                <button onClick={() => setAudioTpl(null)} className="text-xs text-red-600 hover:underline shrink-0">Remover</button>
              </div>
              <AudioPlayer src={audioTpl.url} />
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-stone-700">Roteiro da ligação automática</label>
                  <button type="button" onClick={ouvir} disabled={carregandoVoz} title={ouvindo ? 'Parar' : 'Ouvir a voz da ligação'} className="p-1 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50">
                    {carregandoVoz ? <Loader2 className="w-4 h-4 animate-spin" /> : ouvindo ? <Square className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
                <textarea
                  ref={textoRef}
                  value={roteiro}
                  onChange={(e) => setRoteiro(e.target.value)}
                  rows={5}
                  placeholder={canal === 'eua'
                    ? 'Gere com a IA ou escreva você mesmo. Ex.: Hi {nome_cliente}! I saw you were interested in {nome_produto}...'
                    : 'Gere com a IA ou escreva você mesmo. Ex.: Olá {nome_cliente}! Vi que você se interessou por {nome_produto}...'}
                  className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button key={v.key} type="button" onClick={() => inserirVar(v.key)} className="text-[11px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200/70 rounded-full px-2.5 py-1 transition-colors">
                    {v.key}
                  </button>
                ))}
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">Voz do atendente</label>
            <div className="flex flex-wrap gap-4">
              {VOZES.map((v) => {
                const sel = !audioTpl && voz === v.value
                return (
                  <button key={v.value} type="button" onClick={() => { setVoz(v.value); setAudioTpl(null) }} className="flex flex-col items-center gap-1.5 w-16 group">
                    <div className="relative">
                      <AtendenteFoto voz={v} className={`w-14 h-14 rounded-full transition ${sel ? 'ring-2 ring-primary-500 ring-offset-2' : 'group-hover:ring-2 group-hover:ring-primary-200'}`} />
                      {sel && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary-600 text-white flex items-center justify-center shadow"><Check className="w-2.5 h-2.5" /></span>}
                    </div>
                    <span className={`text-xs font-medium ${sel ? 'text-primary-700' : 'text-stone-700'}`}>{v.nome}</span>
                  </button>
                )
              })}
              {/* Tile: usar áudio próprio (template) */}
              <button type="button" onClick={() => setPickerOpen(true)} className="flex flex-col items-center gap-1.5 w-16 group">
                <div className="relative">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center transition border ${audioTpl ? 'ring-2 ring-primary-500 ring-offset-2 border-primary-300 bg-primary-50 text-primary-600' : 'border-surface-200 bg-violet-50 text-violet-500 group-hover:ring-2 group-hover:ring-primary-200'}`}>
                    <FolderOpen className="w-6 h-6" />
                  </div>
                  {audioTpl && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary-600 text-white flex items-center justify-center shadow"><Check className="w-2.5 h-2.5" /></span>}
                </div>
                <span className={`text-xs font-medium ${audioTpl ? 'text-primary-700' : 'text-stone-700'}`}>Templates</span>
              </button>
            </div>
          </div>

          {!audioTpl && (
            <div className="flex items-center gap-2 max-w-[304px]">
              <Gauge className="w-4 h-4 shrink-0 text-stone-400" title="Velocidade da fala" />
              <input type="range" min="0.8" max="1.3" step="0.05" value={velocidade} onChange={(e) => setVelocidade(Number(e.target.value))} className="flex-1 accent-primary-600" />
              <span className="text-xs text-stone-500 w-10 text-right">{velocidade.toFixed(2)}x</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={handleSave} disabled={salvando} className="btn-primary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {salvando ? 'Salvando...' : 'Salvar automação'}
            </button>
            {!audioTpl && (
              <button onClick={gerarComIA} disabled={gerando} className="text-sm w-full sm:w-auto min-h-[44px] px-4 rounded-xl border-2 border-violet-200 text-violet-700 font-medium hover:bg-violet-50 disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation">
                {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Gerar roteiro com IA
              </button>
            )}
          </div>

          <AudioTemplatePicker uid={uid} open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(t) => setAudioTpl({ id: t.id, nome: t.nome, url: t.audioUrl })} currentId={audioTpl?.id} />
        </div>
      )}
    </div>
  )
}

export default function CallAutomacoes() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const permitirBR = canal === 'api'
  usePlano()

  const [loading, setLoading] = useState(true)
  const [autos, setAutos] = useState([])
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [autoAberto, setAutoAberto] = useState(false)
  const [leads, setLeads] = useState([])
  const [callLogs, setCallLogs] = useState([])
  const [filtroNome, setFiltroNome] = useState('')
  const [paginaLeads, setPaginaLeads] = useState(1)
  const [ligandoId, setLigandoId] = useState(null)
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  useEffect(() => { setPaginaLeads(1) }, [filtroNome, sortKey, sortDir])

  const load = async () => {
    if (!user?.uid) return
    const [a, gs, l, logs] = await Promise.all([getCallAutomations(user.uid, canal), getProductGroups(user.uid), getLeads(user.uid), getCallLogs(user.uid, canal)])
    setAutos(a); setGrupos(gs); setLeads(l); setCallLogs(logs)
  }

  useEffect(() => {
    if (!user?.uid) return
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [user?.uid, canal])

  const reload = async () => { setLoading(true); await load(); setLoading(false) }

  useEffect(() => {
    if (grupos.length > 0 && !grupos.some((g) => g.id === grupoId)) setGrupoId(grupos[0].id)
  }, [grupos])

  const autoMap = useMemo(() => {
    const m = {}
    KIWIFY_EVENTS.forEach((e) => { m[e.id] = autos.find((a) => a.grupoId === grupoId && a.evento === e.id) || null })
    return m
  }, [autos, grupoId])

  const grupoSel = useMemo(() => grupos.find((g) => g.id === grupoId) || null, [grupos, grupoId])

  // Status/contagem de ligação por lead (callLogs já vem ordenado desc = mais recente vence).
  const statusByLead = useMemo(() => {
    const m = {}
    for (const l of callLogs) { if (l.leadId && !(l.leadId in m)) m[l.leadId] = { status: l.status, erro: l.erroMsg } }
    return m
  }, [callLogs])
  const countByLead = useMemo(() => {
    const m = {}
    for (const l of callLogs) { if (l.leadId) m[l.leadId] = (m[l.leadId] || 0) + 1 }
    return m
  }, [callLogs])

  const handleSave = async (evento, data) => {
    if (!grupoId) { toast.error('Selecione um grupo de produto.'); return }
    const id = await saveCallAutomationGrupo(user.uid, grupoId, evento, data, canal)
    setAutos((prev) => {
      const idx = prev.findIndex((a) => a.grupoId === grupoId && a.evento === evento && (a.canal || 'eua') === canal)
      const updated = { grupoId, evento, canal, ...data, id }
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...updated }; return copy }
      return [...prev, updated]
    })
  }

  const handleLigar = async (lead) => {
    const prodL = String(lead.produto || '').toLowerCase()
    const grupoLead = grupos.find((g) => Array.isArray(g.produtos) && g.produtos.some((p) => String(p).toLowerCase() === prodL))
    const evL = canonicalEvento(lead.evento)
    const forEvent = autos.filter((a) => canonicalEvento(a.evento) === evL)
    // Preferência: automação do grupo do lead; senão uma global (sem grupo); senão a 1ª do evento (fallback).
    const auto = (grupoLead && forEvent.find((a) => a.grupoId === grupoLead.id)) || forEvent.find((a) => !a.grupoId) || forEvent[0] || null
    if (!auto?.roteiro) { toast.error('Nenhuma automação de ligação configurada para este evento. Configure primeiro.'); return }
    if (!e164Valido(lead.telefone, permitirBR)) { toast.error(permitirBR ? 'Número inválido.' : 'Este canal (EUA) não liga para números do Brasil (+55).'); return }
    setLigandoId(lead.id)
    try {
      const fn = httpsCallable(functions, 'callDisparar')
      const r = await fn({ canal, texto: auto.roteiro, voz: auto.voz, velocidade: auto.velocidade, agenteNome: 'Automação', contatos: [{ telefone: lead.telefone, nome: lead.nome, produto: lead.produto, email: lead.email, leadId: lead.id }] })
      if (r.data?.iniciadas > 0) toast.success(`Ligando para ${lead.nome || lead.telefone}...`)
      else toast.error(r.data?.erros?.[0]?.erro || 'Não foi possível iniciar a ligação.')
      setTimeout(async () => { setCallLogs(await getCallLogs(user.uid, canal)) }, 1500)
    } catch (err) {
      toast.error(err.message || 'Erro ao ligar.')
    } finally {
      setLigandoId(null)
    }
  }

  const formatDate = (ts) => {
    if (!ts) return '-'
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  const LEADS_POR_PAGINA = 5
  const filtered = useMemo(() => {
    let list = leads
    if (!permitirBR) list = list.filter((l) => !soDigitos(l.telefone).startsWith('55'))
    if (filtroNome.trim()) {
      const q = filtroNome.toLowerCase()
      list = list.filter((l) => (l.nome || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.telefone || '').includes(filtroNome))
    }
    if (sortKey) {
      const val = (l) => {
        switch (sortKey) {
          case 'nome': return (l.nome || '').toLowerCase()
          case 'telefone': return l.telefone || ''
          case 'produto': return (l.produto || '').toLowerCase()
          case 'evento': return (l.evento || '').toLowerCase()
          case 'status': return statusByLead[l.id]?.status || ''
          case 'data': return l.createdAt?.toMillis ? l.createdAt.toMillis() : (l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0)
          default: return 0
        }
      }
      list = [...list].sort((a, b) => {
        const va = val(a), vb = val(b)
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }
    return list
  }, [leads, filtroNome, sortKey, sortDir, statusByLead, permitirBR])

  const totalPaginasLeads = Math.max(1, Math.ceil(filtered.length / LEADS_POR_PAGINA))
  const paginaLeadsAtual = Math.min(paginaLeads, totalPaginasLeads)
  const leadsPagina = filtered.slice((paginaLeadsAtual - 1) * LEADS_POR_PAGINA, paginaLeadsAtual * LEADS_POR_PAGINA)

  if (loading) return <PageLoader />

  return (
    <PageShell
      className="!space-y-0 pb-12 sm:pb-14"
      badge={`Ligação IA · Automações · ${canal === 'api' ? "API's" : 'EUA'}`}
      right={
        <button onClick={reload} className="btn-secondary text-sm w-full sm:w-auto min-h-[44px] touch-manipulation">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      }
    >
      <div className="mt-8 sm:mt-10 flex flex-col lg:flex-row gap-6">
        {/* Grupos */}
        <aside className="lg:w-56 xl:w-60 shrink-0 lg:order-1">
          <div className="lg:sticky lg:top-24 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-widest">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Package className="w-4 h-4 shrink-0" /></span>
                Produtos <span className="text-[10px] font-normal text-stone-400 normal-case tracking-normal">({grupos.length})</span>
              </span>
              <Link to="/produtos" className="text-[11px] text-primary-600 hover:underline">Gerenciar</Link>
            </div>
            {grupos.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                As automações são <strong>por grupo de produto</strong>. Crie um{' '}
                <Link to="/produtos" className="font-semibold underline">grupo</Link> primeiro.
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {grupos.map((g) => {
                  const sel = grupoId === g.id
                  return (
                    <button key={g.id} type="button" onClick={() => setGrupoId(g.id)}
                      className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition touch-manipulation ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}>
                      {g.imagem ? (
                        <img src={g.imagem} alt="" className="h-7 w-7 rounded-lg object-contain shrink-0" />
                      ) : (
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${sel ? 'bg-primary-500 text-white' : 'bg-surface-100 text-stone-400'}`}><Package className="w-3.5 h-3.5" /></span>
                      )}
                      <span className="text-sm font-medium text-stone-800 truncate">{g.nome}</span>
                      {sel && <Check className="w-4 h-4 text-primary-600 shrink-0 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Conteúdo principal */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 lg:order-2">
          {grupoId && (
            <div className="app-panel rounded-2xl overflow-hidden">
              <button type="button" onClick={() => setAutoAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 hover:bg-surface-50 transition">
                <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
                  {grupoSel?.imagem
                    ? <img src={grupoSel.imagem} alt={grupoSel.nome} title={grupoSel.nome} className="h-7 w-7 rounded-lg object-contain shrink-0" />
                    : <Zap className="w-5 h-5 text-primary-600 shrink-0" />}
                  Automação de Ligação IA
                  <img src={euaflag} alt="EUA" className="h-4 w-auto rounded-sm shrink-0" />
                </span>
                <ChevronDown className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${autoAberto ? 'rotate-180' : ''}`} />
              </button>
              {autoAberto && (
                <div className="p-4 sm:p-6 space-y-3 sm:space-y-4 border-t border-surface-100">
                  {KIWIFY_EVENTS.map((event) => (
                    <EventCard key={event.id} event={event} auto={autoMap[event.id]} onSave={handleSave} canal={canal} uid={user.uid} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Leads recebidos — relatório de ligação + ligar de novo */}
          <Panel
            title="Leads recebidos"
            icon={Filter}
            noPadding
            right={<CollapsibleSearch value={filtroNome} onChange={setFiltroNome} placeholder="Nome, e-mail ou telefone" />}
          >
            <div className="w-full overflow-x-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-stone-400 text-sm">
                  {leads.length === 0 ? 'Nenhum lead recebido ainda.' : 'Nenhum lead corresponde aos filtros.'}
                </div>
              ) : (
                <table className="w-full text-sm min-w-[680px]">
                  <thead>
                    <tr className="border-b border-surface-100 text-left text-stone-500">
                      {[['nome', 'Nome'], ['telefone', 'Telefone'], ['produto', 'Produto'], ['evento', 'Evento'], ['status', 'Status'], ['data', 'Data']].map(([key, label]) => (
                        <th key={key} onClick={() => toggleSort(key)} className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-xs sm:text-sm cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                          {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium w-14 sm:w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPagina.map((lead) => {
                      const valido = e164Valido(lead.telefone, permitirBR)
                      const st = statusByLead[lead.id]
                      return (
                        <tr key={lead.id} className="border-b border-surface-50 hover:bg-surface-50/80 transition">
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <div className="font-medium text-stone-800 truncate max-w-[120px] sm:max-w-[160px]">{lead.nome || '-'}</div>
                            <div className="text-xs text-stone-400 truncate max-w-[120px] sm:max-w-[160px]">{lead.email || ''}</div>
                          </td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-600 font-mono text-xs">{lead.telefone || '-'}{!valido && <span className="ml-1 text-red-400" title={permitirBR ? 'Inválido' : 'Número BR não é permitido no canal EUA'}>•</span>}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-stone-700 truncate max-w-[80px] sm:max-w-[120px]">{lead.produto || '-'}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <span className="text-xs bg-surface-100 text-stone-600 px-2 py-0.5 rounded-full whitespace-nowrap">{eventLabel(lead.evento)}</span>
                          </td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">{st ? <CallStatusBadge status={st.status} erro={st.erro} count={countByLead[lead.id] || 0} /> : <span className="text-xs text-stone-400">—</span>}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs text-stone-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                          <td className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <button
                              onClick={() => handleLigar(lead)}
                              disabled={ligandoId === lead.id || !valido}
                              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-primary-50 text-primary-600 disabled:opacity-40 disabled:pointer-events-none transition touch-manipulation"
                              title={!valido ? (permitirBR ? 'Número inválido' : 'Não liga para número do Brasil no canal EUA') : 'Ligar agora'}
                            >
                              {ligandoId === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {filtered.length > LEADS_POR_PAGINA && (
                <div className="px-4 py-3 sm:py-4 border-t border-surface-100 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
                  <p className="text-xs text-stone-600 text-center sm:text-left">Página {paginaLeadsAtual} de {totalPaginasLeads} · {filtered.length} lead(s)</p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => setPaginaLeads((p) => Math.max(1, p - 1))} disabled={paginaLeadsAtual <= 1} className="px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50 text-sm">Anterior</button>
                    <button onClick={() => setPaginaLeads((p) => Math.min(totalPaginasLeads, p + 1))} disabled={paginaLeadsAtual >= totalPaginasLeads} className="px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50 text-sm">Próxima</button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}

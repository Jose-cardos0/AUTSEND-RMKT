import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getLeads, getCallLogs, getProductGroups, getCallConfigs, saveCallConfig, deleteCallConfig } from '../../lib/firestore'
import { KIWIFY_EVENTS, TEMPLATE_VARIABLES } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { usePlano } from '../../lib/PlanoContext'
import AudioTemplatePicker from '../../components/AudioTemplatePicker'
import AudioPlayer from '../../components/AudioPlayer'
import { Phone, Sparkles, Loader2, Gauge, Search, ChevronLeft, ChevronRight, ChevronDown, X, Check, Braces, Settings2, Package, Target, Smile, Volume2, Square, Bookmark, Trash2, Languages, CheckCircle2, Circle, FolderOpen } from 'lucide-react'
import imgCamila from '../../assets/atendentes/camila.png'
import imgVitoria from '../../assets/atendentes/vitoria.png'
import imgThiago from '../../assets/atendentes/thiago.png'
import imgRicardo from '../../assets/atendentes/ricardo.png'

const POR_PAGINA = 8

const VOZES = [
  { value: 'Polly.Camila-Neural', nome: 'Camila', desc: 'Feminina · natural', img: imgCamila },
  { value: 'Polly.Vitoria-Neural', nome: 'Vitória', desc: 'Feminina', img: imgVitoria },
  { value: 'Polly.Thiago-Neural', nome: 'Thiago', desc: 'Masculina · natural', img: imgThiago },
  { value: 'Polly.Ricardo', nome: 'Ricardo', desc: 'Masculina', img: imgRicardo },
]
const OBJETIVOS = [
  { value: 'carrinho_abandonado', label: 'Carrinho abandonado' },
  { value: 'boas_vindas', label: 'Boas-vindas' },
  { value: 'pos_venda', label: 'Pós-venda' },
  { value: 'recuperar_assinatura', label: 'Recuperar assinatura' },
  { value: 'oferta', label: 'Oferta especial' },
  { value: 'lembrete', label: 'Lembrete' },
]
const TONS = [
  { value: 'persuasivo', label: 'Persuasivo' },
  { value: 'engracado', label: 'Engraçado' },
  { value: 'direto', label: 'Direto' },
  { value: 'emocional', label: 'Emocional' },
  { value: 'amigavel', label: 'Amigável' },
  { value: 'urgente', label: 'Urgente' },
]
const IDIOMAS = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
]
const objLabel = (k) => OBJETIVOS.find((o) => o.value === k)?.label || ''
const tomLabel = (k) => TONS.find((t) => t.value === k)?.label || ''
const idiomaLabel = (k) => IDIOMAS.find((i) => i.value === k)?.label || ''

const eventLabel = (id) => (!id || id === 'unknown' || id === 'false') ? 'Outro' : (KIWIFY_EVENTS.find((e) => e.id === id)?.label ?? id)
const normTel = (t) => (t || '').replace(/\D/g, '')
function e164Valido(raw, permitirBR) {
  let d = normTel(raw)
  if (!d) return false
  if (raw && !String(raw).startsWith('+') && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return false
  return d.length >= 8 && d.length <= 15
}
function ehNumeroBR(raw) {
  let d = normTel(raw)
  if (!d) return false
  if (raw && !String(raw).startsWith('+') && d.length === 10) d = '1' + d
  return d.startsWith('55')
}

/** Foto do atendente com fallback pra inicial (sem fundo, só borda + shadow delicado). */
function AtendenteFoto({ voz, className = '' }) {
  const [erro, setErro] = useState(false)
  return (
    <div className={`overflow-hidden rounded-xl border border-surface-200 shadow-sm bg-white ${className}`}>
      {erro ? (
        <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-primary-400">{voz.nome.charAt(0)}</div>
      ) : (
        <img src={voz.img} alt={voz.nome} onError={() => setErro(true)} className="w-full h-full object-cover" />
      )}
    </div>
  )
}

function StatusBadge({ status, erro, count = 0 }) {
  const map = { atendida: 'bg-emerald-100 text-emerald-700', nao_atendida: 'bg-stone-100 text-stone-500', erro: 'bg-red-100 text-red-700' }
  const label = { atendida: 'Atendida', nao_atendida: 'Não atendida', erro: 'Erro' }
  const prefixo = count > 0 ? `${count}x ` : '' // quantas vezes já liguei pra este lead
  return (
    <span title={status === 'erro' && erro ? erro : undefined} className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-stone-100 text-stone-500'}`}>
      {prefixo}{label[status] || 'Não ligado'}
    </span>
  )
}

/** Tag quadradinha: corpo (editar) + divisória tracejada cinza + X (remover). */
function Tag({ icon: Icon, texto, onEdit, onRemove }) {
  return (
    <span className="inline-flex items-stretch rounded-md bg-surface-100 border border-surface-200 text-sm text-stone-700 overflow-hidden">
      <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 min-w-0 pl-2.5 pr-2 py-1 hover:text-primary-700">
        {Icon && <Icon className="w-3.5 h-3.5 text-primary-500 shrink-0" />}
        <span className="truncate max-w-[150px]">{texto}</span>
      </button>
      <span className="self-stretch border-l border-dashed border-stone-300" />
      <button type="button" onClick={onRemove} className="flex items-center justify-center px-1.5 text-stone-400 hover:text-red-600 transition-colors shrink-0">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

/** Etiqueta selecionável (opacity 50% → 100% quando ativa). */
function Etiqueta({ ativo, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded-full border text-sm font-medium transition ${ativo ? 'opacity-100 border-primary-500 bg-primary-50 text-primary-700' : 'opacity-50 border-surface-200 bg-surface-50 text-stone-600 hover:opacity-80'}`}>
      {children}
    </button>
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
  const [grupos, setGrupos] = useState([])
  const [configs, setConfigs] = useState([])
  const [sel, setSel] = useState(() => new Set())
  const [fTexto, setFTexto] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const toggleSort = (k) => { if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir('asc') } }

  // Configuração da chamada
  const [objetivo, setObjetivo] = useState('')
  const [tom, setTom] = useState('')
  const [idioma, setIdioma] = useState('pt')
  const [produto, setProduto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [grupoId, setGrupoId] = useState('')
  const [grupoNome, setGrupoNome] = useState('')
  const [voz, setVoz] = useState('Polly.Camila-Neural')
  const [velocidade, setVelocidade] = useState(1)

  const [editando, setEditando] = useState(false) // popup de config
  const [passoCfg, setPassoCfg] = useState(1) // 1 objetivo/tom · 2 produto · 3 voz
  const [gruposOpen, setGruposOpen] = useState(false) // dropdown de grupos no passo 2
  const [gruposPos, setGruposPos] = useState(null)
  const grupoBtnRef = useRef(null)
  const abrirGrupos = () => {
    if (gruposOpen) { setGruposOpen(false); return }
    const r = grupoBtnRef.current?.getBoundingClientRect()
    if (r) setGruposPos({ top: r.bottom + 6, left: Math.max(8, r.right - 288) })
    setGruposOpen(true)
  }
  const [salvosOpen, setSalvosOpen] = useState(false) // popup de configs salvas
  const [audioTpl, setAudioTpl] = useState(null) // { id, nome, url } quando usa áudio próprio
  const [audioPickerOpen, setAudioPickerOpen] = useState(false)
  const [salvosQ, setSalvosQ] = useState('') // filtro do popup de configs salvas
  const [salvosPage, setSalvosPage] = useState(1)
  const [nomeOpen, setNomeOpen] = useState(false) // popup pra nomear a config
  const [nomeCfg, setNomeCfg] = useState('')

  const [texto, setTexto] = useState('')
  const [gerando, setGerando] = useState(false)
  const [ligando, setLigando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const [falando, setFalando] = useState(false)
  const [carregandoVoz, setCarregandoVoz] = useState(false)
  const textoRef = useRef(null)
  const audioRef = useRef(null)

  const produtoEfetivo = (produto.trim() || grupoNome).trim()
  const configCompleta = !!(objetivo && tom && produtoEfetivo && categoria.trim() && voz)
  const temAlgumaConfig = !!(objetivo || tom || produto.trim() || grupoNome || categoria.trim() || voz)
  const vozSel = VOZES.find((v) => v.value === voz) || VOZES[0]

  // Pré-escuta com a MESMA voz da ligação (ElevenLabs, gerada no backend).
  const ouvirRoteiro = async () => {
    if (falando) { audioRef.current?.pause(); audioRef.current = null; setFalando(false); return }
    const raw = (texto || '').trim()
    if (!raw) { toast.error('Escreva ou gere o roteiro primeiro.'); return }
    setCarregandoVoz(true)
    try {
      const fn = httpsCallable(functions, 'callPreviewVoz')
      const r = await fn({ texto: raw, produto: produtoEfetivo, voz, velocidade, canal })
      const audio = new Audio(r.data?.audio)
      audioRef.current = audio
      audio.onended = () => { setFalando(false); audioRef.current = null }
      audio.onerror = () => { setFalando(false); audioRef.current = null }
      setFalando(true)
      await audio.play()
    } catch (err) {
      setFalando(false)
      toast.error(err.message || 'Não consegui gerar a pré-escuta.')
    } finally { setCarregandoVoz(false) }
  }

  const inserirVar = (v) => {
    const el = textoRef.current
    setVarsOpen(false)
    if (!el) { setTexto((t) => t + v); return }
    const start = el.selectionStart ?? texto.length
    const end = el.selectionEnd ?? texto.length
    setTexto(texto.slice(0, start) + v + texto.slice(end))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + v.length })
  }

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [ld, logs, gs, cfs] = await Promise.all([getLeads(user.uid), getCallLogs(user.uid, canal), getProductGroups(user.uid), getCallConfigs(user.uid)])
    setLeads(ld); setCallLogs(logs); setGrupos(gs); setConfigs(cfs)
    setLoading(false)
  }
  useEffect(() => { carregar() }, [user?.uid, canal])

  const statusByLead = useMemo(() => {
    const m = {}
    for (const l of callLogs) { if (l.leadId && !(l.leadId in m)) m[l.leadId] = { status: l.status, erro: l.erroMsg } }
    return m
  }, [callLogs])
  // Quantas vezes já liguei pra cada lead (total de tentativas).
  const countByLead = useMemo(() => {
    const m = {}
    for (const l of callLogs) { if (l.leadId) m[l.leadId] = (m[l.leadId] || 0) + 1 }
    return m
  }, [callLogs])

  const contatos = useMemo(() => {
    let list = leads.filter((l) => normTel(l.telefone))
    if (!permitirBR) list = list.filter((l) => !ehNumeroBR(l.telefone))
    if (fTexto.trim()) { const q = fTexto.toLowerCase(); list = list.filter((l) => (l.nome || '').toLowerCase().includes(q) || (l.telefone || '').includes(q) || (l.produto || '').toLowerCase().includes(q) || eventLabel(l.evento).toLowerCase().includes(q)) }
    return list
  }, [leads, fTexto, permitirBR])

  const contatosOrdenados = useMemo(() => {
    if (!sortKey) return contatos
    const val = (l) => {
      switch (sortKey) {
        case 'nome': return (l.nome || '').toLowerCase()
        case 'telefone': return normTel(l.telefone)
        case 'produto': return (l.produto || '').toLowerCase()
        case 'evento': return eventLabel(l.evento).toLowerCase()
        case 'status': return statusByLead[l.id]?.status || ''
        default: return ''
      }
    }
    return [...contatos].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [contatos, sortKey, sortDir, statusByLead])

  useEffect(() => { setPagina(1) }, [fTexto, canal, sortKey, sortDir])
  const totalPaginas = Math.max(1, Math.ceil(contatosOrdenados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const contatosPagina = contatosOrdenados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  const toggle = (id) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodos = () => {
    const validos = contatos.filter((l) => e164Valido(l.telefone, permitirBR))
    if (validos.every((l) => sel.has(l.id))) setSel(new Set())
    else setSel(new Set(validos.map((l) => l.id)))
  }

  const abrirConfig = (passo = 1) => { setPassoCfg(passo); setEditando(true) }
  const escolherGrupo = (g) => { setGrupoId(g.id); setGrupoNome(g.nome || ''); setProduto(''); setGruposOpen(false) }
  const podePasso2 = !!(objetivo && tom)
  const podePasso3 = !!(produtoEfetivo && categoria.trim())

  const aplicarConfig = () => { setEditando(false) } // fecha e mostra as tags

  const abrirSalvarNome = () => {
    if (!configCompleta) { toast.error('Complete a configuração.'); return }
    setNomeCfg(''); setNomeOpen(true)
  }
  const salvarConfigNomeada = async () => {
    const nome = nomeCfg.trim()
    if (!nome) { toast.error('Dê um nome à configuração.'); return }
    try {
      const data = { nome, objetivo, tom, idioma, produto, categoria, grupoId, grupoNome, voz, velocidade }
      const id = await saveCallConfig(user.uid, data)
      setConfigs((prev) => [{ id, ...data }, ...prev])
      toast.success('Configuração salva!')
      setNomeOpen(false); setEditando(false)
    } catch (err) { toast.error(err.message || 'Falha ao salvar.') }
  }
  const usarConfig = (c) => {
    setObjetivo(c.objetivo || ''); setTom(c.tom || ''); setIdioma(c.idioma || 'pt'); setProduto(c.produto || '')
    setCategoria(c.categoria || ''); setGrupoId(c.grupoId || ''); setGrupoNome(c.grupoNome || '')
    setVoz(c.voz || 'Polly.Camila-Neural'); setVelocidade(Number(c.velocidade) || 1)
    setSalvosOpen(false)
    toast.success(`Configuração "${c.nome}" aplicada.`)
  }
  const removerConfig = async (c) => {
    try { await deleteCallConfig(user.uid, c.id); setConfigs((prev) => prev.filter((x) => x.id !== c.id)) }
    catch (err) { toast.error(err.message || 'Falha ao excluir.') }
  }

  const gerarRoteiro = async () => {
    if (!configCompleta) { abrirConfig(1); toast.error('Configure a chamada primeiro.'); return }
    setGerando(true)
    try {
      const fn = httpsCallable(functions, 'callGerarRoteiro')
      const r = await fn({ objetivo, tom, idioma, produto: produtoEfetivo, categoria })
      setTexto(r.data?.texto || '')
      toast.success('Roteiro gerado! Ajuste como quiser.')
    } catch (err) { toast.error(err.message || 'Não consegui gerar o roteiro.') }
    finally { setGerando(false) }
  }

  const abrirConfirmar = () => {
    if (!audioTpl) {
      if (!texto.trim()) { toast.error('Gere ou escreva o roteiro da ligação.'); return }
      if (!voz) { abrirConfig(3); toast.error('Escolha a voz do atendente.'); return }
    }
    if (selValidos === 0) { toast.error('Selecione ao menos um contato válido.'); return }
    setConfirmar(true)
  }

  const ligar = async () => {
    const escolhidos = contatos.filter((l) => sel.has(l.id) && e164Valido(l.telefone, permitirBR))
    if (!escolhidos.length) { toast.error('Selecione ao menos um contato válido.'); return }
    setLigando(true)
    try {
      const fn = httpsCallable(functions, 'callDisparar')
      const r = await fn({
        canal, texto, voz, velocidade,
        audioUrl: audioTpl?.url || null, audioNome: audioTpl?.nome || '',
        agenteNome: audioTpl ? `Áudio · ${audioTpl.nome}` : (produtoEfetivo ? `IA · ${produtoEfetivo}` : 'Ligação IA'),
        contatos: escolhidos.map((l) => ({ telefone: l.telefone, nome: l.nome, produto: l.produto, email: l.email, leadId: l.id })),
      })
      const { iniciadas = 0, erros = [] } = r.data || {}
      toast.success(`${iniciadas} ligação(ões) iniciada(s)!${erros.length ? ` ${erros.length} com erro.` : ''}`)
      setSel(new Set()); setConfirmar(false); setTimeout(carregar, 4000)
    } catch (err) { toast.error(err.message || 'Falha ao iniciar as ligações.') }
    finally { setLigando(false) }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const semVoz = !plano?.isAdmin && !plano?.temCallVoz
  const selValidos = contatos.filter((l) => sel.has(l.id) && e164Valido(l.telefone, permitirBR)).length

  return (
    <PageShell badge={`Call · Campanha · ${canal === 'api' ? "API's" : 'EUA'}`}>
      {semVoz && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Você ainda não ativou a voz no seu chip. <Link to="/call/eua/integracao" className="font-semibold underline">Ativar agora</Link>.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Setup de ligação */}
        <div className="lg:col-span-4 flex">
          <Panel title="Setup de ligação" icon={Sparkles} flexFill className="h-full w-full">
            {/* Fonte da voz: config IA (Salvos) ou áudio próprio (Templates) */}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => { setSalvosQ(''); setSalvosPage(1); setSalvosOpen(true) }} className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-primary-600">
                <Bookmark className="w-3.5 h-3.5" /> Salvos{configs.length ? ` (${configs.length})` : ''}
              </button>
              <button onClick={() => setAudioPickerOpen(true)} className={`inline-flex items-center gap-1.5 text-xs ${audioTpl ? 'text-primary-600 font-medium' : 'text-stone-500 hover:text-primary-600'}`}>
                <FolderOpen className="w-3.5 h-3.5" /> Templates
              </button>
            </div>

            {audioTpl ? (
              <div className="rounded-xl bg-surface-50 border border-surface-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-primary-600 shrink-0" />
                  <span className="text-sm font-medium text-stone-800 truncate flex-1">Áudio: {audioTpl.nome || 'template'}</span>
                  <button onClick={() => setAudioTpl(null)} className="text-xs text-red-600 hover:underline shrink-0">Remover</button>
                </div>
                <AudioPlayer src={audioTpl.url} />
                <p className="text-[11px] text-stone-400">Áudio próprio selecionado — é só escolher os contatos e ligar.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Configuração da chamada</span>
                  {temAlgumaConfig && (
                    <button onClick={() => abrirConfig(1)} className={`inline-flex items-center gap-1 text-xs transition-colors ${configCompleta ? 'text-stone-400 hover:text-primary-600' : 'animate-hint'}`}><Settings2 className="w-3.5 h-3.5" /> Editar</button>
                  )}
                </div>
                {temAlgumaConfig ? (
                  <div className="flex flex-wrap gap-2">
                    {objetivo && <Tag icon={Target} texto={objLabel(objetivo)} onEdit={() => abrirConfig(1)} onRemove={() => setObjetivo('')} />}
                    {tom && <Tag icon={Smile} texto={tomLabel(tom)} onEdit={() => abrirConfig(1)} onRemove={() => setTom('')} />}
                    {idioma && <Tag icon={Languages} texto={idiomaLabel(idioma)} onEdit={() => abrirConfig(1)} onRemove={() => setIdioma('pt')} />}
                    {grupoNome && <Tag icon={Package} texto={grupoNome} onEdit={() => abrirConfig(2)} onRemove={() => { setGrupoId(''); setGrupoNome('') }} />}
                    {produto.trim() && <Tag icon={Package} texto={produto} onEdit={() => abrirConfig(2)} onRemove={() => setProduto('')} />}
                    {categoria.trim() && <Tag icon={Sparkles} texto={categoria} onEdit={() => abrirConfig(2)} onRemove={() => setCategoria('')} />}
                    {voz && <Tag icon={Phone} texto={vozSel.nome} onEdit={() => abrirConfig(3)} onRemove={() => setVoz('')} />}
                  </div>
                ) : (
                  <button onClick={() => abrirConfig(1)} className="btn-secondary w-full min-h-[46px]"><Settings2 className="w-4 h-4" /> Configurar chamada</button>
                )}

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide">Roteiro falado</label>
                    <button type="button" onClick={ouvirRoteiro} disabled={carregandoVoz} title={falando ? 'Parar' : 'Ouvir a voz da ligação'} className="p-1 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50">
                      {carregandoVoz ? <Loader2 className="w-4 h-4 animate-spin" /> : falando ? <Square className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="relative">
                    <button type="button" onClick={() => setVarsOpen((o) => !o)} title="Inserir variável" className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Braces className="w-4 h-4" /></button>
                    {varsOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setVarsOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-20 w-60 rounded-xl border border-surface-200 bg-white shadow-lg p-1.5">
                          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Variáveis</p>
                          {TEMPLATE_VARIABLES.map((v) => (
                            <button key={v.key} type="button" onClick={() => inserirVar(v.key)} className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left">
                              <span className="text-sm text-stone-700">{v.label}</span>
                              <code className="text-[11px] text-stone-400">{v.key}</code>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <textarea ref={textoRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Gere com a IA ou escreva você mesmo. Ex.: Olá {nome_cliente}! Vi que você se interessou por {nome_produto}..." className="w-full flex-1 min-h-[140px] resize-none rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />

                <button onClick={gerarRoteiro} disabled={gerando || !configCompleta} className="btn-secondary w-full min-h-[44px] disabled:opacity-50">
                  {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Gerar roteiro com IA
                </button>
              </>
            )}
            <div className="!mt-auto pt-3">
              <button onClick={abrirConfirmar} disabled={ligando || selValidos === 0 || semVoz || (!audioTpl && !texto.trim())} className="btn-primary w-full min-h-[46px]">
                <Phone className="w-4 h-4" /> Ligar ({selValidos})
              </button>
              {!audioTpl && temAlgumaConfig && !configCompleta && <p className="text-[11px] text-stone-400 text-center mt-2">Configuração incompleta</p>}
            </div>
            <AudioTemplatePicker uid={user?.uid} open={audioPickerOpen} onClose={() => setAudioPickerOpen(false)} onPick={(t) => setAudioTpl({ id: t.id, nome: t.nome, url: t.audioUrl })} currentId={audioTpl?.id} />
          </Panel>
        </div>

        {/* Contatos */}
        <div className="lg:col-span-8">
          <Panel
            title={`Contatos (${contatos.length})`}
            icon={Phone}
            noPadding
            right={
              <div className="flex items-center gap-1.5 shrink-0">
                <AnimatePresence initial={false}>
                  {buscaAberta && (
                    <motion.div key="busca" initial={{ width: 0, opacity: 0 }} animate={{ width: '9rem', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                      <input value={fTexto} onChange={(e) => setFTexto(e.target.value)} autoFocus placeholder="Nome, telefone…" className="w-36 h-8 px-3 rounded-lg border border-surface-200 text-sm outline-none focus:ring-0" />
                    </motion.div>
                  )}
                </AnimatePresence>
                <button type="button" onClick={() => { if (buscaAberta) setFTexto(''); setBuscaAberta((v) => !v) }} title={buscaAberta ? 'Fechar busca' : 'Buscar'} className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0">
                  {buscaAberta ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="border-b border-surface-100 text-left text-stone-500">
                    <th className="px-3 py-2.5 w-10">
                      <button type="button" onClick={toggleTodos} aria-label="Selecionar todos" className="inline-flex items-center justify-center p-1 -m-1 rounded-lg text-stone-400 hover:text-primary-500">
                        {selValidos > 0 && contatos.filter((l) => e164Valido(l.telefone, permitirBR)).every((l) => sel.has(l.id)) ? <CheckCircle2 className="w-5 h-5 text-primary-600" /> : <Circle className="w-5 h-5" />}
                      </button>
                    </th>
                    {[['nome', 'Nome'], ['telefone', 'Telefone'], ['produto', 'Produto'], ['evento', 'Evento'], ['status', 'Status']].map(([key, label]) => (
                      <th key={key} onClick={() => toggleSort(key)} className="px-3 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-stone-700 whitespace-nowrap">
                        {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contatos.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-stone-400">Nenhum contato com telefone.</td></tr>
                  ) : contatosPagina.map((l) => {
                    const valido = e164Valido(l.telefone, permitirBR)
                    const st = statusByLead[l.id]
                    return (
                      <tr key={l.id} className="border-b border-surface-50 hover:bg-surface-50/70">
                        <td className="px-3 py-2.5">
                          <button type="button" disabled={!valido} onClick={() => toggle(l.id)} aria-label={sel.has(l.id) ? 'Desmarcar contato' : 'Selecionar contato'} className={`inline-flex items-center justify-center p-1 -m-1 rounded-lg ${!valido ? 'opacity-30 cursor-not-allowed text-stone-400' : sel.has(l.id) ? 'text-primary-600' : 'text-stone-400 hover:text-primary-500'}`}>
                            {sel.has(l.id) ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                          </button>
                        </td>
                        <td className="px-3 py-2.5"><div className="font-medium text-stone-800 truncate max-w-[140px]">{l.nome || '—'}</div><div className="text-xs text-stone-400 truncate max-w-[140px]">{l.email || ''}</div></td>
                        <td className="px-3 py-2.5 font-mono text-xs text-stone-600">{l.telefone || '—'}{!valido && <span className="ml-1 text-red-400" title={permitirBR ? 'Inválido' : 'Número BR não é permitido no canal EUA'}>•</span>}</td>
                        <td className="px-3 py-2.5 text-stone-700 truncate max-w-[120px]">{l.produto || '—'}</td>
                        <td className="px-3 py-2.5"><span className="text-xs bg-surface-100 text-stone-600 px-2 py-0.5 rounded-full whitespace-nowrap">{eventLabel(l.evento)}</span></td>
                        <td className="px-3 py-2.5">{st ? <StatusBadge status={st.status} erro={st.erro} count={countByLead[l.id] || 0} /> : <span className="text-xs text-stone-400">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {contatos.length > POR_PAGINA && (
              <div className="px-3 py-2.5 border-t border-surface-100 flex items-center justify-between gap-3">
                <p className="text-xs text-stone-500">Página {paginaAtual} de {totalPaginas} · {contatos.length} contato(s)</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /> Anterior</button>
                  <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-40">Próxima <ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Popup de CONFIGURAÇÃO (3 etapas) */}
      <AnimatePresence>
        {editando && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={() => setEditando(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 border-b border-surface-100 bg-white z-10">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">{passoCfg}</span>
                  <h3 className="font-semibold text-stone-800">{passoCfg === 1 ? 'Objetivo e tom' : passoCfg === 2 ? 'Produto' : 'Voz e velocidade'}</h3>
                  <span className="text-xs text-stone-400">passo {passoCfg} de 3</span>
                </div>
                <button onClick={() => setEditando(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-5 space-y-4">
                {passoCfg === 1 && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Objetivo da campanha</label>
                      <div className="flex flex-wrap gap-2">
                        {OBJETIVOS.map((o) => <Etiqueta key={o.value} ativo={objetivo === o.value} onClick={() => setObjetivo(o.value)}>{o.label}</Etiqueta>)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Tom da mensagem</label>
                      <div className="flex flex-wrap gap-2">
                        {TONS.map((t) => <Etiqueta key={t.value} ativo={tom === t.value} onClick={() => setTom(t.value)}>{t.label}</Etiqueta>)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Idioma da ligação</label>
                      <div className="flex flex-wrap gap-2">
                        {IDIOMAS.map((i) => <Etiqueta key={i.value} ativo={idioma === i.value} onClick={() => setIdioma(i.value)}>{i.label}</Etiqueta>)}
                      </div>
                    </div>
                    <button onClick={() => setPassoCfg(2)} disabled={!podePasso2} className="btn-primary w-full min-h-[46px] disabled:opacity-50">Próximo <ChevronRight className="w-4 h-4" /></button>
                  </>
                )}

                {passoCfg === 2 && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Nome do produto</label>
                      <div className="relative">
                        <input value={produto} onChange={(e) => { setProduto(e.target.value); if (e.target.value) { setGrupoId(''); setGrupoNome('') } }} placeholder="Ex.: MEMO MAX" className="w-full rounded-xl border border-surface-200 pl-3 pr-10 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />
                        <button ref={grupoBtnRef} type="button" onClick={abrirGrupos} title="Escolher de um grupo de produtos" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50">
                          <Search className="w-4 h-4" />
                        </button>
                        {gruposOpen && gruposPos && createPortal(
                          <>
                            <div className="fixed inset-0 z-[70]" onClick={() => setGruposOpen(false)} />
                            <div style={{ position: 'fixed', top: gruposPos.top, left: gruposPos.left, width: 288 }} className="z-[71] relative rounded-xl border border-surface-200 bg-white shadow-xl overflow-hidden">
                              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Grupos de produtos</p>
                              <div className="max-h-56 overflow-y-auto p-1.5 pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {grupos.length === 0 ? (
                                  <p className="px-2 py-3 text-xs text-stone-400 text-center">Nenhum grupo criado.</p>
                                ) : grupos.map((g) => (
                                  <button key={g.id} type="button" onClick={() => escolherGrupo(g)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50 text-left">
                                    {g.imagem ? <img src={g.imagem} alt="" className="w-5 h-5 rounded object-cover shrink-0" /> : <Package className="w-4 h-4 text-primary-500 shrink-0" />}
                                    <span className="text-sm text-stone-700 truncate">{g.nome}</span>
                                  </button>
                                ))}
                              </div>
                              {grupos.length > 5 && (
                                <span className="pointer-events-none absolute bottom-1 right-2 opacity-50"><ChevronDown className="w-4 h-4 text-stone-500" /></span>
                              )}
                            </div>
                          </>,
                          document.body,
                        )}
                      </div>
                      {grupoNome && (
                        <div className="mt-2"><Tag icon={Package} texto={grupoNome} onEdit={() => setGruposOpen(true)} onRemove={() => { setGrupoId(''); setGrupoNome('') }} /></div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Categoria / o que é o produto</label>
                      <textarea value={categoria} onChange={(e) => setCategoria(e.target.value)} rows={2} placeholder="Ex.: Suplemento que ajuda na prevenção de doenças mentais" className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPassoCfg(1)} className="btn-secondary min-h-[46px]"><ChevronLeft className="w-4 h-4" /> Voltar</button>
                      <button onClick={() => setPassoCfg(3)} disabled={!podePasso3} className="btn-primary flex-1 min-h-[46px] disabled:opacity-50">Próximo <ChevronRight className="w-4 h-4" /></button>
                    </div>
                  </>
                )}

                {passoCfg === 3 && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Voz do atendente</label>
                      <div className="grid grid-cols-2 gap-3">
                        {VOZES.map((v) => {
                          const s = v.value === voz
                          return (
                            <button key={v.value} type="button" onClick={() => setVoz(v.value)} className="text-center focus:outline-none">
                              <div className="relative">
                                <AtendenteFoto voz={v} className={`w-full aspect-square transition ${s ? 'ring-2 ring-primary-500 border-primary-500' : 'hover:shadow-md'}`} />
                                {s && <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center shadow"><Check className="w-3.5 h-3.5" /></span>}
                              </div>
                              <p className={`mt-1.5 text-sm font-semibold ${s ? 'text-primary-700' : 'text-stone-700'}`}>{v.nome}</p>
                              <p className="text-[11px] text-stone-400">{v.desc}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wide"><Gauge className="w-3.5 h-3.5" /> Velocidade · {velocidade.toFixed(1)}x</label>
                      <input type="range" min="0.9" max="1.5" step="0.1" value={velocidade} onChange={(e) => setVelocidade(Number(e.target.value))} className="w-full mt-2 accent-primary-600" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPassoCfg(2)} className="btn-secondary min-h-[46px]"><ChevronLeft className="w-4 h-4" /> Voltar</button>
                      <button onClick={aplicarConfig} disabled={!configCompleta} className="btn-secondary min-h-[46px] disabled:opacity-50">Usar sem salvar</button>
                      <button onClick={abrirSalvarNome} disabled={!configCompleta} className="btn-primary flex-1 min-h-[46px] disabled:opacity-50"><Check className="w-4 h-4" /> Salvar</button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Popup: dar nome à configuração */}
      <AnimatePresence>
        {nomeOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={() => setNomeOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5">
              <h3 className="font-semibold text-stone-800 mb-1">Salvar configuração</h3>
              <p className="text-xs text-stone-500 mb-3">Dê um nome pra reutilizar depois.</p>
              <input value={nomeCfg} onChange={(e) => setNomeCfg(e.target.value)} autoFocus placeholder="Ex.: Carrinho MEMO MAX · Camila" className="w-full rounded-xl border border-surface-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-200" onKeyDown={(e) => e.key === 'Enter' && salvarConfigNomeada()} />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setNomeOpen(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
                <button onClick={salvarConfigNomeada} className="btn-primary flex-1 min-h-[44px]"><Check className="w-4 h-4" /> Salvar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Popup: configurações salvas */}
      <AnimatePresence>
        {salvosOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={() => setSalvosOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 border-b border-surface-100 bg-white">
                <div className="flex items-center gap-2"><Bookmark className="w-5 h-5 text-primary-600" /><h3 className="font-semibold text-stone-800">Configurações salvas</h3></div>
                <button onClick={() => setSalvosOpen(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-4 space-y-2">
                {configs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-stone-400">Nenhuma configuração salva ainda.</p>
                ) : (() => {
                  const q = salvosQ.trim().toLowerCase()
                  const filt = q ? configs.filter((c) => (c.nome || '').toLowerCase().includes(q) || (c.grupoNome || c.produto || '').toLowerCase().includes(q)) : configs
                  const totPag = Math.max(1, Math.ceil(filt.length / 5))
                  const pg = Math.min(salvosPage, totPag)
                  const itens = filt.slice((pg - 1) * 5, pg * 5)
                  return (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input value={salvosQ} onChange={(e) => { setSalvosQ(e.target.value); setSalvosPage(1) }} placeholder="Pesquisar configuração..." className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
                      </div>
                      {itens.length === 0 && <p className="py-6 text-center text-sm text-stone-400">Nada encontrado</p>}
                      {itens.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 p-3 rounded-xl border border-surface-200 hover:bg-surface-50">
                          <button onClick={() => usarConfig(c)} className="flex-1 min-w-0 text-left">
                            <p className="font-medium text-stone-800 truncate">{c.nome}</p>
                            <p className="text-xs text-stone-400 truncate">{objLabel(c.objetivo)} · {tomLabel(c.tom)} · {(c.grupoNome || c.produto || '')} · {VOZES.find((v) => v.value === c.voz)?.nome || ''}</p>
                          </button>
                          <button onClick={() => usarConfig(c)} className="btn-secondary text-xs px-3 min-h-[38px] shrink-0">Usar</button>
                          <button onClick={() => removerConfig(c)} title="Excluir" className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 shrink-0"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                      {filt.length > 5 && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-stone-500">Página {pg} de {totPag} · {filt.length}</span>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setSalvosPage((p) => Math.max(1, p - 1))} disabled={pg <= 1} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                            <button onClick={() => setSalvosPage((p) => Math.min(totPag, p + 1))} disabled={pg >= totPag} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmação de ligar */}
      <AnimatePresence>
        {confirmar && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={() => !ligando && setConfirmar(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100">
                <h3 className="font-semibold text-stone-800">Confirmar ligação</h3>
                <button onClick={() => setConfirmar(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 flex flex-col items-center text-center">
                <AtendenteFoto voz={vozSel} className="w-28 h-28" />
                <p className="mt-2.5 text-base font-semibold text-stone-800">{vozSel.nome}</p>
                <p className="text-xs text-stone-400">{vozSel.desc} · {velocidade.toFixed(1)}x</p>
                <p className="mt-3 text-sm text-stone-600">Vai ligar para <b>{selValidos}</b> contato(s).</p>
                <div className="flex gap-2 mt-5 w-full">
                  <button onClick={() => setConfirmar(false)} disabled={ligando} className="btn-secondary min-h-[46px]">Cancelar</button>
                  <button onClick={ligar} disabled={ligando} className="btn-primary flex-1 min-h-[46px]">
                    {ligando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />} Ligar ({selValidos})
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageShell>
  )
}

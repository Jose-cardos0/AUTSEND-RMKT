import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { listarNumerosComFuncoes } from '../../lib/smsNumeros'
import { criarRamal, listarRamais, revogarRamal, setFotoRamal, reassociarRamal, getRelatorioCallCenter, linkPareamento, PWA_ATENDENTE_URL } from '../../lib/callcenter'
import { useConfirm } from '../../components/ConfirmDialog'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Headphones, Plus, Loader2, QrCode, Trash2, Copy, Check, X, Smartphone, Phone, User, Camera, PhoneIncoming, PhoneOutgoing, PhoneMissed, BarChart3, Clock } from 'lucide-react'
import telnyxLogo from '../../assets/telnyx.png'

/** Formata segundos em tempo legível (2h 5min / 3min 20s / 45s). */
function fmtTempo(seg) {
  seg = Math.max(0, Math.round(seg || 0))
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  if (h) return `${h}h ${m}min`
  if (m) return `${m}min ${s}s`
  return `${s}s`
}
function fmtQuando(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  const d = new Date(ts)
  const hoje = new Date().toDateString() === d.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return hoje ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}

const _norm = (s) => String(s || '').replace(/\D/g, '')
/** Reduz a imagem escolhida pra ~256px e devolve um dataUrl JPEG (leve pra guardar no Firestore). */
function lerFotoResize(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')) }
    img.src = url
  })
}
function formatarNumero(n) {
  const d = _norm(n)
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return n
}
function tempoRelativo(ms) {
  if (!ms) return null
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 300) return 'online agora'
  if (s < 3600) return `visto há ${Math.floor(s / 60)} min`
  if (s < 86400) return `visto há ${Math.floor(s / 3600)} h`
  return `visto em ${new Date(ms).toLocaleDateString('pt-BR')}`
}

/** Botão de copiar com feedback. */
function BotaoCopiar({ texto, label = 'Copiar' }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500) }}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700">
      {ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {ok ? 'Copiado!' : label}
    </button>
  )
}

/** Modal do QR de pareamento do ramal. Quando o ramal pareia (status != aguardando), vira "✓ conectado" e fecha sozinho. */
function ModalQR({ ramal, ultimoAcesso, onClose }) {
  const link = linkPareamento(ramal.pairKey)
  // Fecha quando o atendente PAREA/CONECTA com o modal aberto — detectado por ultimoAcesso avançar.
  const abriuTs = useRef(ultimoAcesso || 0)
  const acabouDeParear = (ultimoAcesso || 0) > (abriuTs.current || 0)
  useEffect(() => {
    if (!acabouDeParear) return
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [acabouDeParear, onClose])
  const pareado = acabouDeParear
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="app-panel rounded-2xl w-full max-w-sm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
        {pareado ? (
          <div className="text-center py-6">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 mb-4"><Check className="w-8 h-8" /></span>
            <h3 className="text-lg font-bold text-stone-800">Atendente conectado!</h3>
            <p className="text-sm text-stone-500 mt-1"><strong>{ramal.nome}</strong> pareou o aparelho e já pode ligar e receber.</p>
          </div>
        ) : (
          <div className="text-center">
            <h3 className="text-lg font-bold text-stone-800">{ramal.nome}</h3>
            <p className="text-sm text-stone-500 tabular-nums">{formatarNumero(ramal.numero)}</p>
            <div className="mt-4 flex justify-center">
              <div className="p-3 bg-white rounded-xl border-2 border-surface-200">
                <QRCodeSVG value={link} size={196} level="M" />
              </div>
            </div>
            <p className="mt-4 text-xs text-stone-500">Código do ramal</p>
            <p className="text-2xl font-black tracking-widest text-stone-800 tabular-nums select-all">{ramal.pairKey}</p>
            <div className="mt-3 flex items-center justify-center gap-4">
              <BotaoCopiar texto={ramal.pairKey} label="Copiar código" />
              <BotaoCopiar texto={link} label="Copiar link" />
            </div>
            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-stone-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando o atendente parear…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CallCenter() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [ramais, setRamais] = useState([])
  const [numsByo, setNumsByo] = useState([])
  const [novoNum, setNovoNum] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [criando, setCriando] = useState(false)
  const [revogandoId, setRevogandoId] = useState(null)
  const [fotoLoadingId, setFotoLoadingId] = useState(null)
  const [fixandoId, setFixandoId] = useState(null)
  const [qrRamal, setQrRamal] = useState(null)
  const [view, setView] = useState('ramais') // ramais | relatorio
  const [relDias, setRelDias] = useState(30)
  const [rel, setRel] = useState(null)
  const [relLoading, setRelLoading] = useState(false)

  useEffect(() => {
    if (view !== 'relatorio' || !user?.uid) return
    let vivo = true
    setRelLoading(true)
    getRelatorioCallCenter(relDias).then((d) => { if (vivo) setRel(d) }).catch(() => {}).finally(() => { if (vivo) setRelLoading(false) })
    return () => { vivo = false }
  }, [view, relDias, user?.uid])

  const carregar = async () => {
    if (!user?.uid) return
    try {
      const [rr, rn] = await Promise.all([listarRamais(), listarNumerosComFuncoes()])
      setRamais(rr?.ramais || [])
      setNumsByo((rn?.numeros || []).filter((n) => n.fonte === 'byo'))
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [user?.uid])

  // Atualiza o status dos ramais a cada 6s (pega quando o atendente pareia/fica online).
  useEffect(() => {
    if (!user?.uid) return
    const id = setInterval(async () => {
      try { const rr = await listarRamais(); setRamais(rr?.ramais || []) } catch { /* silencioso */ }
    }, 6000)
    return () => clearInterval(id)
  }, [user?.uid])

  // Números BYO ainda sem ramal (1 número = 1 ramal).
  const usados = new Set(ramais.map((r) => _norm(r.numero)))
  const disponiveis = numsByo.filter((n) => !usados.has(_norm(n.numero)))

  const criar = async () => {
    if (!novoNum) { toast.error('Escolha um número.'); return }
    if (!novoNome.trim()) { toast.error('Dê um nome ao ramal.'); return }
    setCriando(true)
    try {
      const r = await criarRamal(novoNum, novoNome.trim())
      toast.success('Ramal criado! Compartilhe o QR com o atendente.')
      setNovoNum(''); setNovoNome('')
      await carregar()
      if (r?.ramalId) setQrRamal({ id: r.ramalId, nome: novoNome.trim(), numero: r.numero, pairKey: r.pairKey })
    } catch (err) {
      toast.error(err.message || 'Não consegui criar o ramal.')
    } finally { setCriando(false) }
  }

  const handleFoto = async (ramalId, file) => {
    if (!file) return
    setFotoLoadingId(ramalId)
    try {
      const dataUrl = await lerFotoResize(file)
      await setFotoRamal(ramalId, dataUrl)
      setRamais((prev) => prev.map((x) => (x.id === ramalId ? { ...x, fotoUrl: dataUrl } : x)))
      toast.success('Foto do atendente atualizada!')
    } catch (err) {
      toast.error(err.message || 'Não consegui salvar a foto.')
    } finally { setFotoLoadingId(null) }
  }

  const corrigirRecebimento = async (r) => {
    setFixandoId(r.id)
    try {
      const res = await reassociarRamal(r.id)
      const antes = res.connectionAntes ? `…${String(res.connectionAntes).slice(-6)}` : 'nenhuma'
      const agora = res.connectionAgora ? `…${String(res.connectionAgora).slice(-6)}` : '?'
      toast.success(`Entrada apontada pro softphone (${agora}). Antes ia pra: ${antes}. Abra o app e ligue de novo.`, { duration: 9000 })
    } catch (err) {
      toast.error(err.message || 'Não consegui corrigir o recebimento.')
    } finally { setFixandoId(null) }
  }

  const revogar = async (r) => {
    if (!(await confirm({ title: `Revogar "${r.nome}"?`, message: 'O atendente perde o acesso na hora e o número é liberado. Essa ação não pode ser desfeita.', confirmLabel: 'Revogar', danger: true }))) return
    setRevogandoId(r.id)
    try {
      await revogarRamal(r.id)
      setRamais((prev) => prev.filter((x) => x.id !== r.id))
      toast.success('Ramal revogado.')
    } catch (err) {
      toast.error(err.message || 'Não consegui revogar.')
    } finally { setRevogandoId(null) }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell badge="Call Center · Atendentes">
      {/* Como funciona + link do app */}
      <div className="app-panel rounded-2xl p-4 sm:p-5 relative overflow-hidden">
        <Headphones className="pointer-events-none absolute right-0 top-0 -mr-6 -mt-8 w-36 h-36 text-primary-500 opacity-[0.06]" />
        <div className="relative z-10">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-800"><Headphones className="w-5 h-5 text-primary-600" /> Central de atendentes</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={PWA_ATENDENTE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-surface-200">
              <Smartphone className="w-4 h-4 text-primary-600" /> {PWA_ATENDENTE_URL.replace('https://', '')}
            </a>
            <BotaoCopiar texto={PWA_ATENDENTE_URL} label="Copiar link do app" />
          </div>
        </div>
      </div>

      {/* Toggle Ramais / Relatório */}
      <div className="mt-4 inline-flex rounded-xl bg-surface-100 p-1">
        {[{ k: 'ramais', label: 'Ramais', icon: Headphones }, { k: 'relatorio', label: 'Relatório', icon: BarChart3 }].map((t) => (
          <button key={t.k} type="button" onClick={() => setView(t.k)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition ${view === t.k ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {view === 'ramais' && (<>
      {/* Criar ramal */}
      <div className="app-panel rounded-2xl p-4 sm:p-5 mt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800"><Plus className="w-4 h-4 text-primary-600" /> Novo ramal</h3>
        {numsByo.length === 0 ? (
          <div className="mt-3 rounded-xl bg-surface-50 border border-surface-200 p-4 text-center">
            <p className="text-sm text-stone-600">Você precisa conectar uma <strong>conta Telnyx própria</strong> com número pra criar ramais.</p>
            <Link to="/numeros" className="btn-primary mt-3 min-h-[40px] px-4 inline-flex text-sm"><Phone className="w-4 h-4" /> Ir para Números</Link>
          </div>
        ) : disponiveis.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Todos os seus números BYO já têm ramal. Conecte mais números na aba <Link to="/numeros" className="text-primary-600 font-semibold">Números</Link> pra criar novos.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Número (sua Telnyx)</label>
              <select value={novoNum} onChange={(e) => setNovoNum(e.target.value)}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2.5 text-sm text-stone-800 focus:border-primary-500 focus:outline-none">
                <option value="">Selecione…</option>
                {disponiveis.map((n) => <option key={n.id} value={n.id}>{formatarNumero(n.numero)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Nome do atendente</label>
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={60} placeholder="Ex.: João · Vendas"
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2.5 text-sm text-stone-800 focus:border-primary-500 focus:outline-none" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={criar} disabled={criando} className="btn-primary min-h-[42px] px-5 w-full sm:w-auto">
                {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar ramal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista de ramais */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-stone-700 mb-2 px-1">Ramais ({ramais.length})</h3>
        {ramais.length === 0 ? (
          <div className="app-panel rounded-2xl py-10 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100 text-stone-400 mb-3"><Headphones className="w-6 h-6" /></span>
            <p className="text-sm text-stone-600 font-medium">Nenhum ramal ainda.</p>
            <p className="text-xs text-stone-400 mt-1">Crie o primeiro ramal acima pra montar sua central.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ramais.map((r) => {
              const aguardando = r.status === 'aguardando'
              const rel = tempoRelativo(r.ultimoAcesso)
              const online = r.online === true
              return (
                <div key={r.id} className="app-panel rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    {/* Foto do atendente — só o cliente define aqui pelo web */}
                    <label className="relative shrink-0 cursor-pointer" title="Trocar foto do atendente">
                      <span className="block w-11 h-11 rounded-full bg-surface-100 overflow-hidden flex items-center justify-center ring-1 ring-surface-200">
                        {r.fotoUrl ? <img src={r.fotoUrl} alt={r.nome} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-stone-400" />}
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center ring-2 ring-white">
                        {fotoLoadingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                      </span>
                      <input type="file" accept="image/*" className="hidden" disabled={fotoLoadingId === r.id}
                        onChange={(e) => { handleFoto(r.id, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-stone-800 truncate">{r.nome}</p>
                      <p className="text-sm text-stone-500 tabular-nums flex items-center gap-1.5">
                        {formatarNumero(r.numero)}
                        <img src={telnyxLogo} alt="Sua Telnyx" title="Número da sua conta Telnyx" className="h-3.5 w-auto object-contain" />
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${aguardando ? 'bg-amber-100 text-amber-700' : online ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-stone-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${aguardando ? 'bg-amber-500' : online ? 'bg-green-500' : 'bg-stone-400'}`} />
                      {aguardando ? 'Aguardando' : online ? 'Online' : 'Pareado'}
                    </span>
                  </div>
                  {!aguardando && rel && <p className="text-xs text-stone-400 -mt-1">{rel}</p>}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button type="button" onClick={() => setQrRamal(r)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-surface-100 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-surface-200">
                      <QrCode className="w-4 h-4 text-primary-600" /> QR / código
                    </button>
                    <button type="button" onClick={() => revogar(r)} disabled={revogandoId === r.id} title="Revogar ramal"
                      className="inline-flex items-center justify-center rounded-lg bg-red-50 px-3 py-2 text-red-600 hover:bg-red-100 disabled:opacity-60">
                      {revogandoId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={() => corrigirRecebimento(r)} disabled={fixandoId === r.id}
                    className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-stone-400 hover:text-primary-600 disabled:opacity-60 -mt-1">
                    {fixandoId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneIncoming className="w-3.5 h-3.5" />}
                    Checar Integridade
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>)}

      {view === 'relatorio' && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-1.5">
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" onClick={() => setRelDias(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${relDias === d ? 'bg-primary-600 text-white' : 'bg-surface-100 text-stone-500 hover:bg-surface-200'}`}>
                {d} dias
              </button>
            ))}
          </div>

          {relLoading && !rel ? (
            <PageLoader className="py-10" />
          ) : !rel || (rel.totais.atendidas + rel.totais.perdidas + rel.totais.feitas === 0) ? (
            <div className="app-panel rounded-2xl py-10 text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100 text-stone-400 mb-3"><BarChart3 className="w-6 h-6" /></span>
              <p className="text-sm text-stone-600 font-medium">Sem ligações no período.</p>
              <p className="text-xs text-stone-400 mt-1">Assim que os atendentes usarem o app, aparece aqui.</p>
            </div>
          ) : (
            <>
              {/* Totais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Atendidas', value: rel.totais.atendidas, icon: PhoneIncoming, cor: 'text-green-600 bg-green-50' },
                  { label: 'Perdidas', value: rel.totais.perdidas, icon: PhoneMissed, cor: 'text-red-500 bg-red-50' },
                  { label: 'Feitas', value: rel.totais.feitas, icon: PhoneOutgoing, cor: 'text-primary-600 bg-primary-50' },
                  { label: 'Tempo total', value: fmtTempo(rel.totais.segundos), icon: Clock, cor: 'text-stone-600 bg-surface-100' },
                ].map((s) => (
                  <div key={s.label} className="app-panel rounded-xl p-4">
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${s.cor} mb-2`}><s.icon className="w-4 h-4" /></span>
                    <p className="text-xl font-bold text-stone-800 tabular-nums">{s.value}</p>
                    <p className="text-xs text-stone-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Por atendente */}
              <div className="app-panel rounded-2xl p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-stone-800 mb-3">Por atendente</h3>
                <div className="space-y-2">
                  {rel.ramais.map((r) => (
                    <div key={r.ramalId} className="flex items-center gap-3 rounded-xl bg-surface-50 border border-surface-200 p-3">
                      <span className="w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-primary-600" /></span>
                      <p className="font-semibold text-stone-800 truncate flex-1 min-w-0">{r.nome}</p>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="text-green-600 font-semibold" title="Atendidas"><PhoneIncoming className="w-3.5 h-3.5 inline -mt-0.5" /> {r.atendidas}</span>
                        <span className="text-red-500 font-semibold" title="Perdidas"><PhoneMissed className="w-3.5 h-3.5 inline -mt-0.5" /> {r.perdidas}</span>
                        <span className="text-primary-600 font-semibold" title="Feitas"><PhoneOutgoing className="w-3.5 h-3.5 inline -mt-0.5" /> {r.feitas}</span>
                        <span className="text-stone-500 tabular-nums hidden sm:inline" title="Tempo total"><Clock className="w-3.5 h-3.5 inline -mt-0.5" /> {fmtTempo(r.segundos)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recentes */}
              {rel.recentes.length > 0 && (
                <div className="app-panel rounded-2xl p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-stone-800 mb-3">Ligações recentes</h3>
                  <div className="divide-y divide-surface-100">
                    {rel.recentes.map((c, i) => {
                      const perdida = c.dir === 'in' && !c.atendida
                      const Icon = perdida ? PhoneMissed : c.dir === 'in' ? PhoneIncoming : PhoneOutgoing
                      const cor = perdida ? 'text-red-500' : c.dir === 'in' ? 'text-green-600' : 'text-primary-600'
                      return (
                        <div key={i} className="flex items-center gap-3 py-2.5">
                          <Icon className={`w-4 h-4 shrink-0 ${cor}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-stone-800 tabular-nums truncate">{formatarNumero(c.numero)}</p>
                            <p className="text-xs text-stone-400 truncate">{c.ramalNome} · {perdida ? 'Perdida' : c.atendida ? fmtTempo(c.segundos) : 'Não atendida'}</p>
                          </div>
                          <span className="text-xs text-stone-400 shrink-0">{fmtQuando(c.ts)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {qrRamal && <ModalQR ramal={qrRamal} ultimoAcesso={(ramais.find((r) => r.id === qrRamal.id) || {}).ultimoAcesso} onClose={() => setQrRamal(null)} />}
    </PageShell>
  )
}

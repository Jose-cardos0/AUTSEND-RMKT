import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { listarNumerosComFuncoes } from '../../lib/smsNumeros'
import { criarRamal, listarRamais, revogarRamal, linkPareamento, PWA_ATENDENTE_URL } from '../../lib/callcenter'
import { useConfirm } from '../../components/ConfirmDialog'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Headphones, Plus, Loader2, QrCode, Trash2, Copy, Check, X, Smartphone, Phone, Info } from 'lucide-react'
import telnyxLogo from '../../assets/telnyx.png'

const _norm = (s) => String(s || '').replace(/\D/g, '')
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

/** Modal do QR de pareamento do ramal. */
function ModalQR({ ramal, onClose }) {
  const link = linkPareamento(ramal.pairKey)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="app-panel rounded-2xl w-full max-w-sm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
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
          <p className="mt-5 text-xs text-stone-500 leading-relaxed">
            O atendente instala o app <strong>Autsend Atendente</strong> e escaneia este QR (ou digita o código). O acesso vale por <strong>30 dias</strong>.
          </p>
        </div>
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
  const [qrRamal, setQrRamal] = useState(null)

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
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed max-w-2xl">
            Crie um <strong>ramal</strong> pra cada atendente usando seus números da <strong>sua conta Telnyx</strong>. Cada atendente instala o app
            <strong> Autsend Atendente</strong> no celular, escaneia o QR do ramal e passa a <strong>ligar e receber</strong> pelo número — de qualquer lugar,
            sem precisar da sua conta do Autsend.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={PWA_ATENDENTE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-surface-200">
              <Smartphone className="w-4 h-4 text-primary-600" /> {PWA_ATENDENTE_URL.replace('https://', '')}
            </a>
            <BotaoCopiar texto={PWA_ATENDENTE_URL} label="Copiar link do app" />
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-stone-400"><Info className="w-3.5 h-3.5 mt-px shrink-0" /> A telefonia (ligações) é cobrada na sua própria conta Telnyx. O Autsend organiza a operação.</p>
        </div>
      </div>

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
              const online = rel === 'online agora'
              return (
                <div key={r.id} className="app-panel rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
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
                </div>
              )
            })}
          </div>
        )}
      </div>

      {qrRamal && <ModalQR ramal={qrRamal} onClose={() => setQrRamal(null)} />}
    </PageShell>
  )
}

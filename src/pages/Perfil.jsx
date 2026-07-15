import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import { getPerfilStats, criarCheckoutCreditoSMS, salvarFotoPerfil, PACOTES_CREDITO } from '../lib/perfil'
import { usePlano } from '../lib/PlanoContext'
import { User, Mail, MessageSquare, Zap, Loader2, Sparkles, Check, Camera, ShieldCheck } from 'lucide-react'
import img500 from '../assets/chip/emailautsend.png'
import img1000 from '../assets/chip/1000sms.png'
import img2500 from '../assets/chip/2500.png'
import euaFlag from '../assets/flags/euaflaglarge.png'

const PLANO_LABEL = { free: 'Free', inicial: 'Inicial', padrao: 'Padrão', pro: 'Pro' }
const PACOTE_IMG = { 500: img500, 1000: img1000, 2500: img2500 }

/** Redimensiona uma imagem pra um quadrado pequeno e devolve um data URL JPEG. */
function redimensionarImagem(file, tamanho = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = tamanho
        canvas.height = tamanho
        const ctx = canvas.getContext('2d')
        const min = Math.min(image.width, image.height)
        const sx = (image.width - min) / 2
        const sy = (image.height - min) / 2
        ctx.drawImage(image, sx, sy, min, min, 0, 0, tamanho, tamanho)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      image.onerror = reject
      image.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Barra de uso (azulzinha) com rótulo X / Y. limite = -1 → ilimitado (admin). */
function BarraUso({ icon: Icon, titulo, usados, limite, cor = 'primary' }) {
  const ilimitado = limite === -1
  const pct = ilimitado ? 100 : (limite > 0 ? Math.min(100, Math.round((usados / limite) * 100)) : 0)
  const cores = {
    primary: 'bg-primary-500',
    violet: 'bg-violet-500',
  }
  return (
    <div className="p-4 rounded-xl border border-surface-200 bg-surface-50/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          <Icon className="w-4 h-4 text-primary-600" /> {titulo}
        </span>
        <span className="text-sm font-semibold text-stone-800 tabular-nums">
          {usados.toLocaleString('pt-BR')} <span className="text-stone-400 font-normal">/ {ilimitado ? '∞' : limite.toLocaleString('pt-BR')}</span>
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-surface-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${ilimitado ? 'bg-gradient-to-r from-primary-400 to-violet-400 opacity-40' : cores[cor]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Perfil() {
  const [user] = useAuthState(auth)
  const { setFotoURL } = usePlano()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comprando, setComprando] = useState(null) // key do pacote em compra
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const fileRef = useRef(null)

  const escolherFoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite reescolher o mesmo arquivo
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Escolha uma imagem.'); return }
    setEnviandoFoto(true)
    try {
      const dataUrl = await redimensionarImagem(file, 256)
      const r = await salvarFotoPerfil(dataUrl)
      const url = r?.fotoURL || dataUrl
      setStats((s) => ({ ...(s || {}), fotoURL: url }))
      setFotoURL(url) // reflete no menu na hora
      toast.success('Foto atualizada!')
    } catch (err) {
      toast.error(err?.message || 'Falha ao salvar a foto.')
    } finally {
      setEnviandoFoto(false)
    }
  }

  const carregar = async () => {
    try {
      const s = await getPerfilStats()
      setStats(s)
    } catch (_) {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user?.uid) return
    carregar()
  }, [user?.uid])

  // Volta do checkout de recarga (?recarga=ok|cancelado)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const r = params.get('recarga')
    if (!r) return
    if (r === 'ok') {
      toast.success('Recarga confirmada! Seus créditos são adicionados em instantes.')
      setTimeout(carregar, 2500)
    } else if (r === 'cancelado') {
      toast('Recarga cancelada.', { icon: '↩️' })
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const comprar = async (key) => {
    setComprando(key)
    try {
      const r = await criarCheckoutCreditoSMS(key)
      if (r?.url) window.location.href = r.url
      else toast.error('Não consegui abrir o checkout. Tente de novo.')
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a recarga.')
    } finally {
      setComprando(null)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const nome = stats?.nome || ''
  const email = stats?.email || user?.email || ''
  const inicial = (nome || email || '?').trim().charAt(0).toUpperCase()
  const isAdmin = !!stats?.isAdmin
  const planoLabel = PLANO_LABEL[stats?.plano] || 'Free'
  const fotoURL = stats?.fotoURL || null
  const smsLimiteEfetivo = isAdmin ? -1 : ((stats?.smsLimite || 0) + (stats?.smsCreditos || 0))

  return (
    <PageShell badge="Conta · Perfil">
      <div className="space-y-3">
        {/* Cabeçalho do usuário */}
        <Panel title="Meu perfil" icon={User}>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={enviandoFoto}
              title="Trocar foto"
              className="group relative h-16 w-16 shrink-0 rounded-full overflow-hidden shadow-md focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              {fotoURL ? (
                <img src={fotoURL} alt="Foto de perfil" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-500 to-violet-500 text-white text-2xl font-bold">
                  {inicial}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
                {enviandoFoto ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={escolherFoto} className="hidden" />
            <div className="min-w-0">
              {nome && <p className="text-lg font-bold text-stone-800 truncate">{nome}</p>}
              <p className="text-sm text-stone-500 flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 shrink-0" /> {email}</p>
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700 border border-violet-200">
                  <ShieldCheck className="w-3 h-3" /> Admin · Ilimitado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 border border-primary-200">
                  <Sparkles className="w-3 h-3" /> Plano {planoLabel}
                </span>
              )}
            </div>
          </div>
        </Panel>

        {/* Uso do mês */}
        <Panel title="Uso deste mês" icon={Zap}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BarraUso icon={Mail} titulo="E-mails" usados={stats?.emailsUsados || 0} limite={isAdmin ? -1 : (stats?.emailsLimite || 0)} cor="primary" />
            <BarraUso icon={MessageSquare} titulo="SMS" usados={stats?.smsUsados || 0} limite={smsLimiteEfetivo} cor="violet" />
          </div>
          {isAdmin ? (
            <p className="text-xs text-stone-400 mt-2">Conta de administrador — envios ilimitados.</p>
          ) : (
            <p className="text-xs text-stone-400 mt-2">
              SMS: {stats?.smsLimite || 0} do plano{stats?.smsCreditos > 0 ? ` + ${stats.smsCreditos.toLocaleString('pt-BR')} de crédito` : ''}. Os limites do plano renovam todo mês; os créditos não expiram.
            </p>
          )}
        </Panel>

        {/* Recarga de SMS */}
        <Panel title="Recarregar créditos de SMS" icon={MessageSquare}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO.map((p) => (
              <div
                key={p.key}
                className={`relative flex flex-col p-5 rounded-2xl border-2 transition ${
                  p.destaque ? 'border-primary-400 bg-primary-50/40' : 'border-surface-200 bg-surface-50/60'
                }`}
              >
                {p.destaque && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary-600 text-white shadow-sm whitespace-nowrap">
                    MAIS POPULAR
                  </span>
                )}
                <div className="text-center">
                  <img src={PACOTE_IMG[p.quantidade]} alt="" className="h-16 w-auto mx-auto mb-2 object-contain" />
                  <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</p>
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-center gap-1">
                    <img src={euaFlag} alt="EUA" className="w-4 h-auto object-contain" /> SMS
                  </p>
                  <p className="text-lg font-bold text-primary-600 mt-2">{p.valor}</p>
                </div>
                <button
                  onClick={() => comprar(p.key)}
                  disabled={!!comprando}
                  className="btn-primary w-full mt-4 min-h-[42px] disabled:opacity-60"
                >
                  {comprando === p.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {comprando === p.key ? 'Abrindo…' : 'Comprar'}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </PageShell>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import { getPerfilStats, criarCheckoutCreditoSMS, criarCheckoutCreditoEmail, criarCheckoutCreditoCall, criarCheckoutCreditoSmsBr, criarCheckoutInstancia, salvarFotoPerfil, PACOTES_CREDITO, PACOTES_CREDITO_SMS_BR, PACOTES_CREDITO_EMAIL, PACOTES_CREDITO_CALL } from '../lib/perfil'
import { usePlano } from '../lib/PlanoContext'
import { User, Mail, MessageSquare, Zap, Loader2, Sparkles, Check, Camera, ShieldCheck, Globe, Phone } from 'lucide-react'
import img500 from '../assets/chip/emailautsend.png'
import img1000 from '../assets/chip/1000sms.png'
import img2500 from '../assets/chip/2500.png'
import imgEmail5000 from '../assets/email/5000email.png'
import imgEmail10000 from '../assets/email/10000email.png'
import imgEmail25000 from '../assets/email/25000email.png'
import imgCall30 from '../assets/minutes/30minutes.png'
import imgCall60 from '../assets/minutes/60minutes.png'
import imgCall120 from '../assets/minutes/120minutes.png'
import globoIcon from '../assets/global.png'
import euaFlag from '../assets/flags/euaflaglarge.png'
import imgSmsBr500 from '../assets/chip/500sms-brl.png'
import imgSmsBr1000 from '../assets/chip/1000sms-brl.png'
import imgSmsBr2500 from '../assets/chip/2500sms-brl.png'
import Bandeira from '../components/Bandeira'
import CheckoutModal from '../components/CheckoutModal'
import ComprarInstanciaModal from '../components/ComprarInstanciaModal'
import instanciaWhats from '../assets/whtatsicons/instancia-whats.png'

const PLANO_LABEL = { free: 'Free', inicial: 'Inicial', padrao: 'Padrão', pro: 'Pro' }
const PACOTE_IMG = { 500: img500, 1000: img1000, 2500: img2500 }
const PACOTE_IMG_SMS_BR = { 500: imgSmsBr500, 1000: imgSmsBr1000, 2500: imgSmsBr2500 }
const PACOTE_IMG_EMAIL = { 5000: imgEmail5000, 10000: imgEmail10000, 25000: imgEmail25000 }
const PACOTE_IMG_CALL = { 30: imgCall30, 60: imgCall60, 120: imgCall120 }

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
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
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

/** Faixa diagonal "MAIS POPULAR" no canto superior direito, com marquee infinito (ícone intercalado). */
function FaixaPopular({ tema = 'red' }) {
  const grad = tema === 'red' ? 'from-rose-500 via-red-500 to-red-600'
    : tema === 'green' ? 'from-emerald-500 via-emerald-500 to-green-600'
    : 'from-primary-500 via-primary-600 to-violet-600'
  // E-mail é global → globo branco; SMS EUA → bandeira EUA; SMS BR → globo (simples).
  const icone = () => tema === 'red'
    ? <Globe className="w-2.5 h-2.5 shrink-0" />
    : tema === 'green'
    ? <Bandeira code="BR" className="w-3 h-auto rounded-sm shrink-0" />
    : <img src={euaFlag} alt="" className="w-3 h-auto object-contain shrink-0" />
  return (
    <div className="absolute top-0 right-0 w-24 h-24 overflow-hidden pointer-events-none z-10">
      <div className={`absolute top-[15px] right-[-42px] w-[150px] rotate-45 bg-gradient-to-r ${grad} shadow-md py-1 overflow-hidden`}>
        <div className="faixa-marquee items-center text-[8.5px] font-extrabold uppercase tracking-wider text-white">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="inline-flex items-center gap-1 px-1.5">{icone()} Mais Popular</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Perfil() {
  const [user] = useAuthState(auth)
  const { setFotoURL, limiteDe, isAdmin: isAdminCtx } = usePlano()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comprando, setComprando] = useState(null) // key do pacote em compra
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [checkoutSecret, setCheckoutSecret] = useState(null) // client_secret do checkout embutido
  const [instModalOpen, setInstModalOpen] = useState(false) // modal de comprar instância
  const [comprandoInst, setComprandoInst] = useState(false)
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

  const comprar = async (canal, key) => {
    const id = `${canal}:${key}`
    setComprando(id)
    try {
      const r = canal === 'email' ? await criarCheckoutCreditoEmail(key)
        : canal === 'call' ? await criarCheckoutCreditoCall(key)
        : canal === 'smsbr' ? await criarCheckoutCreditoSmsBr(key)
        : await criarCheckoutCreditoSMS(key)
      if (r?.clientSecret) setCheckoutSecret(r.clientSecret) // abre o pagamento dentro do app
      else toast.error('Não consegui abrir o checkout. Tente de novo.')
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a recarga.')
    } finally {
      setComprando(null)
    }
  }

  const comprarInstancia = async (quantidade) => {
    setComprandoInst(true)
    try {
      const r = await criarCheckoutInstancia(quantidade)
      if (r?.clientSecret) setCheckoutSecret(r.clientSecret)
      else toast.error('Não consegui abrir o checkout. Tente de novo.')
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a compra.')
    } finally {
      setComprandoInst(false)
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
  const smsBrLimiteEfetivo = isAdmin ? -1 : (stats?.smsBrCreditos || 0) // BR é crédito-only
  const callLimiteEfetivo = isAdmin ? -1 : ((stats?.callMinLimite || 0) + Math.floor((stats?.callCreditosSeg || 0) / 60))
  const emailLimiteEfetivo = isAdmin ? -1 : ((stats?.emailsLimite || 0) + (stats?.emailCreditos || 0))
  const iaLimiteEfetivo = isAdmin ? -1 : (stats?.iaLimite || 0)
  const pausada = !!stats?.pausada

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
              {pausada && (
                <p className="mt-1.5 text-[11px] text-red-500/80">Pausada · Em Análise pelo Setor de Risco</p>
              )}
            </div>
          </div>
        </Panel>

        {/* Uso do mês */}
        <Panel title="Uso deste mês" icon={Zap}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BarraUso icon={Mail} titulo="E-mails" usados={stats?.emailsUsados || 0} limite={emailLimiteEfetivo} cor="primary" />
            <BarraUso icon={MessageSquare} titulo="SMS (EUA)" usados={stats?.smsUsados || 0} limite={smsLimiteEfetivo} cor="violet" />
            <BarraUso icon={MessageSquare} titulo="SMS (Brasil)" usados={stats?.smsBrUsados || 0} limite={smsBrLimiteEfetivo} cor="emerald" />
            <BarraUso icon={Phone} titulo="Ligação IA (min)" usados={stats?.callMinUsados || 0} limite={callLimiteEfetivo} cor="emerald" />
            <BarraUso icon={Sparkles} titulo="IA Construtor" usados={stats?.iaUsados || 0} limite={iaLimiteEfetivo} cor="amber" />
          </div>
          {isAdmin ? (
            <p className="text-xs text-stone-400 mt-2">Conta de administrador — envios ilimitados.</p>
          ) : (
            <p className="text-xs text-stone-400 mt-2">
              Cota do plano: {(stats?.emailsLimite || 0).toLocaleString('pt-BR')} e-mails · {(stats?.smsLimite || 0).toLocaleString('pt-BR')} SMS{(stats?.emailCreditos > 0 || stats?.smsCreditos > 0) ? ` + créditos (${(stats?.emailCreditos || 0).toLocaleString('pt-BR')} e-mail / ${(stats?.smsCreditos || 0).toLocaleString('pt-BR')} SMS)` : ''}. Os limites do plano renovam todo mês; os créditos não expiram.
            </p>
          )}
        </Panel>

        {/* Comprar instância de WhatsApp (assinatura mensal) */}
        <Panel title="Instâncias de WhatsApp" icon={MessageSquare}>
          <div className="flex flex-col sm:flex-row items-center gap-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-5">
            <img src={instanciaWhats} alt="" className="h-24 w-auto object-contain shrink-0 drop-shadow-sm" />
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <h3 className="text-lg font-bold text-stone-800">Instância de WhatsApp</h3>
                <Bandeira code="BR" className="w-5 h-auto rounded-sm" />
              </div>
              <p className="text-sm text-stone-600 mt-1">
                Cada instância é um número de WhatsApp a mais pra conectar nas automações e disparos.
              </p>
              <p className="text-lg font-bold text-emerald-600 mt-1">R$ 29,90<span className="text-sm font-medium text-stone-500">/mês cada</span></p>
              {!isAdminCtx && Number.isFinite(limiteDe('instancias')) && (
                <p className="text-xs text-stone-400 mt-1">Seu plano hoje permite <b>{limiteDe('instancias')}</b> instância(s) no total.</p>
              )}
            </div>
            <button
              onClick={() => setInstModalOpen(true)}
              className="w-full sm:w-auto min-h-[44px] px-6 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm shadow-emerald-500/25 transition"
            >
              <Check className="w-4 h-4" /> Comprar instância
            </button>
          </div>
        </Panel>

        {/* Recarga de e-mail */}
        <Panel title="Recarregar créditos de e-mail" icon={Mail}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO_EMAIL.map((p) => {
              const id = `email:${p.key}`
              return (
                <div
                  key={p.key}
                  className={`relative overflow-hidden flex flex-col p-5 rounded-2xl border-2 transition ${
                    p.destaque ? 'border-rose-300 bg-rose-50/50' : 'border-surface-200 bg-surface-50/60'
                  }`}
                >
                  {p.destaque && <FaixaPopular tema="red" />}
                  <div className="text-center">
                    <img src={PACOTE_IMG_EMAIL[p.quantidade]} alt="" className="h-16 w-auto mx-auto mb-2 object-contain" />
                    <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</p>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-center gap-1">
                      <img src={globoIcon} alt="" className="w-4 h-4 object-contain" /> E-mails
                    </p>
                    <p className="text-lg font-bold text-rose-500 mt-2">{p.valor}</p>
                  </div>
                  <button
                    onClick={() => comprar('email', p.key)}
                    disabled={!!comprando}
                    className="w-full mt-4 min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-rose-400 hover:bg-rose-500 shadow-sm shadow-rose-400/25 transition disabled:opacity-60"
                  >
                    {comprando === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {comprando === id ? 'Abrindo…' : 'Comprar'}
                  </button>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Recarga de SMS */}
        <Panel title="Recarregar créditos de SMS (EUA)" icon={MessageSquare}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO.map((p) => {
              const id = `sms:${p.key}`
              return (
                <div
                  key={p.key}
                  className={`relative overflow-hidden flex flex-col p-5 rounded-2xl border-2 transition ${
                    p.destaque ? 'border-primary-400 bg-primary-50/40' : 'border-surface-200 bg-surface-50/60'
                  }`}
                >
                  {p.destaque && <FaixaPopular tema="blue" />}
                  <div className="text-center">
                    <img src={PACOTE_IMG[p.quantidade]} alt="" className="h-16 w-auto mx-auto mb-2 object-contain" />
                    <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</p>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-center gap-1">
                      <img src={euaFlag} alt="EUA" className="w-4 h-auto object-contain" /> SMS EUA
                    </p>
                    <p className="text-lg font-bold text-primary-600 mt-2">{p.valor}</p>
                  </div>
                  <button
                    onClick={() => comprar('sms', p.key)}
                    disabled={!!comprando}
                    className="btn-primary w-full mt-4 min-h-[42px] disabled:opacity-60"
                  >
                    {comprando === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {comprando === id ? 'Abrindo…' : 'Comprar'}
                  </button>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Recarga de SMS BRASIL (SMSDev) */}
        <Panel title="Recarregar créditos de SMS (Brasil)" icon={MessageSquare}>
          {stats?.smsBrCreditos > 0 && (
            <p className="text-xs text-stone-500 -mt-1 mb-1">Você tem <b>{(stats.smsBrCreditos || 0).toLocaleString('pt-BR')}</b> crédito(s) de SMS Brasil.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO_SMS_BR.map((p) => {
              const id = `smsbr:${p.key}`
              return (
                <div key={p.key} className={`relative overflow-hidden flex flex-col p-5 rounded-2xl border-2 transition ${p.destaque ? 'border-emerald-400 bg-emerald-50/40' : 'border-surface-200 bg-surface-50/60'}`}>
                  {p.destaque && <FaixaPopular tema="green" />}
                  <div className="text-center">
                    <img src={PACOTE_IMG_SMS_BR[p.quantidade]} alt="" className="h-16 w-auto mx-auto mb-2 object-contain" />
                    <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</p>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-center gap-1.5">
                      <Bandeira code="BR" className="w-4 h-auto rounded-sm" /> SMS Brasil
                    </p>
                    <p className="text-lg font-bold text-emerald-600 mt-2">{p.valor}</p>
                  </div>
                  <button onClick={() => comprar('smsbr', p.key)} disabled={!!comprando} className="w-full mt-4 min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm shadow-emerald-500/25 transition disabled:opacity-60">
                    {comprando === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {comprando === id ? 'Abrindo…' : 'Comprar'}
                  </button>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Comprar minutos de Ligação (EUA)" icon={Phone}>
          {stats?.callCreditosSeg > 0 && (
            <p className="text-xs text-stone-500 -mt-1 mb-1">Você tem <b>{Math.floor((stats.callCreditosSeg || 0) / 60)} min</b> em crédito.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PACOTES_CREDITO_CALL.map((p) => {
              const id = `call:${p.key}`
              return (
                <div key={p.key} className={`relative overflow-hidden flex flex-col p-5 rounded-2xl border-2 transition ${p.destaque ? 'border-primary-400 bg-primary-50/40' : 'border-surface-200 bg-surface-50/60'}`}>
                  {p.destaque && <FaixaPopular tema="blue" />}
                  <div className="text-center">
                    <img src={PACOTE_IMG_CALL[p.minutos]} alt="" className="h-16 w-auto mx-auto mb-2 object-contain" />
                    <p className="text-3xl font-extrabold text-stone-800 tabular-nums">{p.minutos}</p>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" />
                      <Bandeira code="US" className="w-4 h-auto rounded-sm" />
                      Ligação (EUA)
                    </p>
                    <p className="text-lg font-bold text-primary-600 mt-2">{p.valor}</p>
                  </div>
                  <button onClick={() => comprar('call', p.key)} disabled={!!comprando} className="btn-primary w-full mt-4 min-h-[42px] disabled:opacity-60">
                    {comprando === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {comprando === id ? 'Abrindo…' : 'Comprar'}
                  </button>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      {instModalOpen && (
        <ComprarInstanciaModal
          comprando={comprandoInst}
          onConfirm={comprarInstancia}
          onClose={() => setInstModalOpen(false)}
        />
      )}

      {checkoutSecret && (
        <CheckoutModal
          clientSecret={checkoutSecret}
          onClose={() => setCheckoutSecret(null)}
          onComplete={() => {
            setCheckoutSecret(null)
            setInstModalOpen(false)
            toast.success('Pagamento concluído! Seu saldo é atualizado em instantes.')
            setTimeout(carregar, 2500)
          }}
        />
      )}
    </PageShell>
  )
}

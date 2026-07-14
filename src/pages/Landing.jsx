import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, LogIn, ChevronDown } from 'lucide-react'
import autsendLogo from '../assets/autsendlogo.png'
import gmailIcon from '../assets/iconshome/gmailicon.png'
import whatsappIcon from '../assets/iconshome/whtsappicon.png'
import smsIcon from '../assets/iconshome/smsicon.png'
import callIcon from '../assets/iconshome/callicon.png'
import mock1 from '../assets/carrosell/mockup-celular1.png'
import mock2 from '../assets/carrosell/mockup-celular2.png'
import mock3 from '../assets/carrosell/mockup-celular-3.png'
import mock4 from '../assets/carrosell/mockup-celular-4.png'
import mock5 from '../assets/carrosell/mockup-celular-5.png'
import mock6 from '../assets/carrosell/mockup-ceular-6.png'
import garantia from '../assets/garantia.png'
import astrosend from '../assets/astrosend/astrosend.png'
import astroFoguete from '../assets/astrosend/astro-foguete.png'
import astroCurioso from '../assets/astrosend/astrocurioso.png'
import ShootingStars from '../components/ShootingStars'
import WhatsAppIcon from '../components/WhatsAppIcon'
import { PLANOS, PLANO_CHECKOUT } from '../lib/plans'
import { SUPPORT_WHATSAPP } from '../lib/constants'

// Demo interativo do funil (lazy: só carrega o React Flow quando aparece)
const FunilDemoLazy = lazy(() => import('./FunilDemo'))

// Flutuação suave (loop infinito)
const Float = ({ children, className = '', delay = 0, dur = 4.5, y = 14 }) => (
  <motion.div className={className} animate={{ y: [0, -y, 0] }} transition={{ duration: dur, repeat: Infinity, ease: 'easeInOut', delay }}>
    {children}
  </motion.div>
)

// Carrossel coverflow de mockups (o do centro em destaque; passa sozinho pro lado)
const MOCKUPS = [mock1, mock2, mock3, mock4, mock5, mock6]
function MockupCarousel() {
  const [active, setActive] = useState(0)
  const prevRef = useRef(0)
  const n = MOCKUPS.length
  useEffect(() => {
    const iv = setInterval(() => setActive((a) => (a + 1) % n), 3000)
    return () => clearInterval(iv)
  }, [n])
  useEffect(() => { prevRef.current = active }, [active])
  const wrap = (o) => { if (o > n / 2) o -= n; if (o < -n / 2) o += n; return o }
  return (
    <div className="relative h-[360px] sm:h-[460px] lg:h-[520px] flex items-center justify-center select-none">
      {MOCKUPS.map((src, i) => {
        const off = wrap(i - active)
        const offPrev = wrap(i - prevRef.current)
        const teleporte = Math.abs(off - offPrev) > 1 // item que "dá a volta": reposiciona sem animar
        const abs = Math.abs(off)
        const escala = abs === 0 ? 1 : abs === 1 ? 0.82 : 0.64
        const opac = abs <= 1 ? 1 : abs === 2 ? 0.3 : 0
        return (
          <img
            key={i}
            src={src}
            alt=""
            onClick={() => setActive(i)}
            className="absolute h-full w-auto object-contain drop-shadow-2xl cursor-pointer"
            style={{
              transform: `translateX(${off * 52}%) scale(${escala})`,
              opacity: opac,
              zIndex: 30 - abs,
              transition: teleporte ? 'none' : 'transform 700ms cubic-bezier(0.22,1,0.36,1), opacity 700ms ease',
              pointerEvents: abs <= 2 ? 'auto' : 'none',
            }}
          />
        )
      })}
    </div>
  )
}

// Frase do hero em segmentos (com cores) pro efeito de digitação
const TAGLINE_SEGS = [
  { t: 'Venda mais no automático.\n' },
  { t: 'Mais ' },
  { t: 'vendas', c: 'text-primary-600' },
  { t: ', menos ' },
  { t: 'esforço', c: 'text-pink-500' },
  { t: '!' },
]
const TAGLINE_TOTAL = TAGLINE_SEGS.reduce((n, s) => n + s.t.length, 0)

const FEATURES = [
  { img: whatsappIcon, title: 'WhatsApp automático', desc: 'Dispare remarketing no WhatsApp na hora certa, sem operar na mão.' },
  { img: gmailIcon, title: 'E-mail marketing', desc: 'Campanhas e automações de e-mail com entrega e métricas de verdade.' },
  { img: smsIcon, title: 'SMS Marketing', desc: 'Mensagens diretas que chegam na hora — alta abertura e resposta.' },
  { img: callIcon, title: 'Call Marketing IA', desc: 'Ligações automáticas com IA pra reengajar e converter seus leads.' },
]

const PLANOS_LP = [
  { key: 'free', preco: 'R$0', tag: null, destaque: false, features: ['1 tracker', 'E-mail (50/mês) via sua API', '1 template + 1 grupo de produto', 'Automação de compra aprovada'] },
  { key: 'inicial', preco: 'R$67', tag: 'Entrada', destaque: false, features: ['2 trackers', 'WhatsApp ilimitado · 1 instância', '500 e-mails/mês', '300 SMS/mês (EUA)', 'Banco de Leads, Funil e Métricas'] },
  { key: 'padrao', preco: 'R$127', tag: 'Mais popular', destaque: true, features: ['10 trackers', 'WhatsApp ilimitado · 2 instâncias', '3.000 e-mails/mês · 1 domínio', '1.000 SMS/mês (EUA)', 'Tudo desbloqueado'] },
  { key: 'pro', preco: 'R$197', tag: 'Máximo', destaque: false, features: ['20 trackers', 'WhatsApp ilimitado · 4 instâncias', '10.000 e-mails/mês · 2 domínios', '2.000 SMS/mês (EUA)', 'Limites maiores e prioridade'] },
]


const FAQS = [
  { q: 'O que é o Autsend?', a: 'Uma plataforma de remarketing automático por WhatsApp e E-mail. Você captura os leads das suas vendas e dispara a mensagem certa na hora certa — recuperando vendas no automático.' },
  { q: 'Preciso saber programar pra usar?', a: 'Não. É tudo visual: você conecta sua plataforma de vendas, monta disparos e funis arrastando blocos, e o resto roda sozinho.' },
  { q: 'Como conecto minhas vendas?', a: 'Por webhook. Funciona com Kiwify, Hotmart, CartPanda, MundPay, Digistore24, ClickBank, BuyGoods, Hubla, Kirvano — e qualquer outra plataforma via webhook custom.' },
  { q: 'Meus e-mails caem em spam?', a: 'A gente segue as boas práticas de entregabilidade (SPF, DKIM, domínio verificado e descadastro). Você conecta seu próprio domínio no app e envia com a sua identidade e ótima entrega.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim. A cobrança é mensal e sem fidelidade — cancele a qualquer momento.' },
  { q: 'Serve pro meu nicho?', a: 'Sim. Foi feito para produtores e e-commerce de qualquer nicho — do lançamento ao dropshipping.' },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] } }),
}

export default function Landing() {
  const navigate = useNavigate()
  const irLogin = () => navigate('/login')
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  const [openFaq, setOpenFaq] = useState(0)
  // Efeito de digitação da frase: digita → espera 5s → apaga → repete
  const [typed, setTyped] = useState(0)
  const [apagando, setApagando] = useState(false)
  useEffect(() => {
    let timer
    if (!apagando && typed < TAGLINE_TOTAL) timer = setTimeout(() => setTyped((n) => n + 1), 55)
    else if (!apagando && typed >= TAGLINE_TOTAL) timer = setTimeout(() => setApagando(true), 5000)
    else if (apagando && typed > 0) timer = setTimeout(() => setTyped((n) => n - 1), 22)
    else timer = setTimeout(() => setApagando(false), 500)
    return () => clearTimeout(timer)
  }, [typed, apagando])
  const renderTagline = () => {
    let rem = typed
    return TAGLINE_SEGS.map((s, i) => {
      const show = Math.max(0, Math.min(s.t.length, rem))
      rem -= s.t.length
      return show > 0 ? <span key={i} className={s.c || ''}>{s.t.slice(0, show)}</span> : null
    })
  }

  return (
    <div className="relative min-h-dvh bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35 overflow-x-hidden">
      {/* ── Fundo decorativo fixo (mesmos elementos do login) ── */}
      <div aria-hidden className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.16) 1px, transparent 1.6px)', backgroundSize: '22px 22px' }} />
        <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-primary-400/25 blur-3xl animate-float" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-violet-400/20 blur-3xl animate-float-slow" />
        <div className="absolute bottom-4 left-1/3 w-72 h-72 rounded-full bg-sky-300/20 blur-3xl animate-float" />
        <ShootingStars />
      </div>
      {/* world.svg sangrando no rodapé — com fade no topo pra não cortar reto */}
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 h-[45%] z-0 pointer-events-none overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, #000 35%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 35%)',
        }}
      >
        <img src={`${import.meta.env.BASE_URL}world.svg`} alt="" className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-[60%] w-[120%] lg:w-[100%] max-w-none opacity-70 select-none" />
      </div>

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/50 border-b border-white/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <img src={autsendLogo} alt="Autsend" className="h-8 sm:h-9 w-auto" />
          <div className="flex items-center gap-2">
            <button onClick={() => scrollTo('planos')} className="hidden sm:inline-flex text-sm font-semibold text-stone-600 hover:text-primary-600 px-3 py-2 rounded-lg transition-colors">Planos</button>
            <button onClick={irLogin} className="inline-flex items-center gap-2 rounded-xl px-4 min-h-[42px] text-sm font-semibold text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-md shadow-primary-600/25 hover:brightness-105 transition">
              <LogIn className="w-4 h-4" /> Entrar
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── Hero (composição da marca, flutuante) ── */}
        <section className="relative w-full max-w-[1400px] mx-auto px-4 sm:px-6 min-h-[calc(100dvh-4rem)] flex flex-col justify-center py-8">
          <div className="relative mx-auto w-full max-w-6xl min-h-[520px] sm:min-h-[600px]">
            {/* Brilho suave atrás da logo (sem linha) */}
            <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[55%] rounded-full bg-gradient-to-br from-primary-400/20 via-violet-400/15 to-pink-400/15 blur-3xl pointer-events-none" />

            {/* Ícones flutuantes (PNG, sem fundo) — mobile menores + posições próprias, desktop maiores */}
            <Float className="absolute left-[4%] top-[46%] lg:left-[8%] lg:top-[24%] z-10" delay={0.5} y={14}>
              <img src={gmailIcon} alt="" className="w-11 lg:w-16 xl:w-20 h-auto" />
            </Float>
            <Float className="absolute right-[1%] top-[2%] lg:right-[7%] lg:top-[24%] z-10" delay={0.7} y={14}>
              <img src={whatsappIcon} alt="" className="w-[72px] lg:w-16 xl:w-20 h-auto" />
            </Float>
            <Float className="absolute left-[5%] bottom-[14%] lg:left-[8%] lg:bottom-[26%] z-10" delay={1.1} y={12}>
              <img src={callIcon} alt="" className="w-11 lg:w-16 xl:w-20 h-auto" />
            </Float>
            <Float className="absolute right-[4%] bottom-[36%] lg:right-[14%] lg:bottom-[22%] z-10" delay={1.5} y={12}>
              <img src={smsIcon} alt="" className="w-12 lg:w-16 xl:w-20 h-auto" />
            </Float>

            {/* Centro: logo + tagline + CTAs (maior) */}
            <div className="relative z-20 flex flex-col items-center text-center pt-8 sm:pt-16">
              <motion.img variants={fadeUp} initial="hidden" animate="show" src={autsendLogo} alt="Autsend" className="w-[85%] max-w-[620px] drop-shadow-[0_22px_34px_rgba(124,58,237,0.32)]" />
              <motion.p variants={fadeUp} initial="hidden" animate="show" custom={1} className="mt-5 text-xl sm:text-3xl font-semibold text-stone-700 leading-snug whitespace-pre-line min-h-[3.4em] sm:min-h-[2.9em]">
                {renderTagline()}
                <span className="inline-block w-[3px] h-[1em] align-[-0.12em] ml-0.5 bg-primary-500 animate-pulse" />
              </motion.p>
              <motion.div variants={fadeUp} initial="hidden" animate="show" custom={2} className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button onClick={irLogin} className="inline-flex items-center justify-center gap-2 rounded-xl px-7 min-h-[56px] text-base font-semibold text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-lg shadow-primary-600/25 hover:brightness-105 transition w-full sm:w-auto">
                  Começar agora <ArrowRight className="w-5 h-5" />
                </button>
                <button onClick={() => scrollTo('planos')} className="inline-flex items-center justify-center gap-2 rounded-xl px-7 min-h-[56px] text-base font-semibold text-stone-700 bg-white/70 border border-white/60 backdrop-blur hover:border-primary-300 transition w-full sm:w-auto">
                  Ver planos
                </button>
              </motion.div>
            </div>
          </div>

        </section>

        {/* ── Recursos ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="relative h-full">
                {f.title === 'Call Marketing IA' && (
                  <div aria-hidden className="hidden lg:block absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 w-[155%] -z-10 pointer-events-none">
                    <Float y={12} dur={5}><img src={astrosend} alt="" className="w-full max-w-none select-none" /></Float>
                  </div>
                )}
                {f.title === 'WhatsApp automático' && (
                  <div aria-hidden className="lg:hidden absolute left-1/2 -top-36 -translate-x-1/2 w-[58%] sm:w-[70%] -z-10 pointer-events-none">
                    <Float y={10} dur={5}><img src={astrosend} alt="" className="w-full select-none" /></Float>
                  </div>
                )}
                <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} custom={i}
                  className="h-full rounded-2xl p-5 bg-white/50 backdrop-blur-xl border border-white/50 shadow-[0_10px_30px_-12px_rgba(74,70,222,0.15)]">
                  <img src={f.img} alt="" className="w-12 h-12 object-contain mb-3" />
                  <h3 className="text-base font-bold text-stone-800 mb-1">{f.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
                </motion.div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Demo do funil (interativo) ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <motion.h2 variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-2xl sm:text-4xl font-extrabold text-stone-800 text-center text-balance mb-3">Experimente a real estratégia do Autsend</motion.h2>
          <motion.p variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1} className="text-stone-500 text-center max-w-xl mx-auto mb-28 sm:mb-40 lg:mb-24">Um funil de upsell montado igual ao que roda de verdade. Arraste os blocos, ligue caminhos e brinque à vontade — é só um exemplo, não afeta nada.</motion.p>
          <div className="relative">
            {/* Mascote peekando na borda de cima do canvas */}
            <img src={astroCurioso} alt="" aria-hidden className="block absolute left-1/2 -translate-x-1/2 bottom-full -mb-5 sm:-mb-7 w-72 sm:w-56 lg:w-72 xl:w-80 z-20 pointer-events-none select-none drop-shadow-[0_18px_28px_rgba(30,27,75,0.22)]" />
            <Suspense fallback={<div className="rounded-2xl border border-surface-200 bg-white/60 h-[420px] sm:h-[520px] flex items-center justify-center text-stone-400 text-sm">Carregando funil…</div>}>
              <FunilDemoLazy />
            </Suspense>
          </div>
        </section>

        {/* ── Carrossel de mockups ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <motion.h2 variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-2xl sm:text-4xl font-extrabold text-stone-800 text-center text-balance mb-3">Conheça algumas das nossas funções</motion.h2>
          <motion.p variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1} className="text-stone-500 text-center max-w-xl mx-auto mb-8 sm:mb-10">Tudo o que você precisa pra capturar, converter e recuperar vendas — num painel só, direto do seu celular ou computador.</motion.p>
          <MockupCarousel />
        </section>

        {/* ── Planos ── */}
        <section id="planos" className="relative max-w-6xl mx-auto px-4 mt-16 sm:px-6 py-12 sm:py-16 scroll-mt-20">
          <div aria-hidden className="hidden lg:block absolute left-[-3%] top-[26%] -translate-y-1/2 w-[260px] xl:w-[320px] -z-10 pointer-events-none">
            <Float y={16} dur={6}><img src={astroFoguete} alt="" className="w-full max-w-none select-none" style={{ transform: 'scaleX(-1)' }} /></Float>
          </div>
          <div aria-hidden className="lg:hidden absolute right-[-8%] top-[-5%] w-52 sm:w-72 -z-10 pointer-events-none">
            <Float y={14} dur={6}><img src={astroFoguete} alt="" className="w-full max-w-none select-none" /></Float>
          </div>
          <motion.h2 variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-2xl sm:text-4xl font-extrabold text-stone-800 text-center text-balance">Planos que crescem com você</motion.h2>
          <motion.p variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1} className="mt-3 text-stone-500 text-center max-w-xl mx-auto">Comece de graça e evolua quando precisar. Cobrança mensal, cancele quando quiser.</motion.p>

          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
            {PLANOS_LP.map((p, i) => (
              <motion.div key={p.key} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} custom={i}
                className={`relative rounded-2xl p-5 flex flex-col border-2 backdrop-blur-xl ${p.destaque ? 'border-primary-400 bg-white/70 shadow-xl shadow-primary-500/10' : 'border-white/60 bg-white/45'}`}>
                {p.tag && (
                  <span className={`absolute -top-2.5 right-4 z-10 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm ${p.destaque ? 'bg-primary-100 text-primary-700 border-primary-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>{p.tag}</span>
                )}
                <span className="text-base font-bold text-stone-800">{PLANOS[p.key].nome}</span>
                <div className="mt-1 mb-3">
                  <span className="text-3xl font-extrabold text-stone-800">{p.preco}</span>
                  {p.key !== 'free' && <span className="text-sm font-medium text-stone-400">/mês</span>}
                </div>
                <ul className="space-y-1.5 flex-1 mb-4">
                  {p.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-[13px] text-stone-600"><Check className={`w-4 h-4 shrink-0 mt-0.5 ${p.destaque ? 'text-primary-600' : 'text-emerald-600'}`} /> <span>{f}</span></li>
                  ))}
                </ul>
                {p.key === 'free' ? (
                  <button onClick={irLogin} className="w-full inline-flex items-center justify-center gap-2 rounded-xl min-h-[46px] text-sm font-semibold border border-surface-200 text-stone-700 bg-white/70 hover:border-primary-300 hover:text-primary-700 transition">Criar conta grátis</button>
                ) : (
                  <a href={PLANO_CHECKOUT[p.key]} target="_blank" rel="noreferrer" className={`w-full inline-flex items-center justify-center gap-2 rounded-xl min-h-[46px] text-sm font-semibold transition ${p.destaque ? 'text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-md shadow-primary-600/25 hover:brightness-105' : 'border border-surface-200 text-stone-700 bg-white/70 hover:border-primary-300 hover:text-primary-700'}`}>Assinar {PLANOS[p.key].nome}</a>
                )}
              </motion.div>
            ))}
          </div>

          {/* Selo de garantia */}
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="mt-10 flex justify-center">
            <img src={garantia} alt="Garantia" className="w-40 sm:w-48 h-auto object-contain" />
          </motion.div>
        </section>

        {/* ── FAQ ── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <motion.h2 variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-2xl sm:text-4xl font-extrabold text-stone-800 text-center text-balance mb-8 sm:mb-10">Perguntas frequentes</motion.h2>
          <div className="space-y-3">
            {FAQS.map((f, i) => {
              const aberto = openFaq === i
              return (
                <motion.div key={i} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.4 }} custom={i}
                  className="rounded-2xl border border-white/60 bg-white/55 backdrop-blur overflow-hidden shadow-sm">
                  <button onClick={() => setOpenFaq(aberto ? -1 : i)} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                    <span className="font-semibold text-stone-800 text-sm sm:text-base">{f.q}</span>
                    <ChevronDown className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                  </button>
                  {aberto && <p className="px-5 pb-4 -mt-1 text-sm text-stone-500 leading-relaxed">{f.a}</p>}
                </motion.div>
              )
            })}
          </div>
        </section>

        {/* ── CTA final ── */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="rounded-3xl p-8 sm:p-12 text-center bg-gradient-to-br from-primary-500 to-violet-600 shadow-2xl shadow-primary-600/25">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white text-balance">Pronto para vender mais no Direct Response?</h2>
            <p className="mt-3 text-white/80 max-w-lg mx-auto">Crie sua conta em minutos e comece a disparar remarketing hoje.</p>
            <button onClick={irLogin} className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-7 min-h-[52px] text-sm font-bold text-primary-700 bg-white hover:bg-white/90 transition">
              Começar agora <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-white/40 bg-white/40 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <img src={autsendLogo} alt="Autsend" className="h-7 w-auto" />
            <p className="text-xs text-stone-400">© {new Date().getFullYear()} Autsend. Todos os direitos reservados.</p>
            <button onClick={irLogin} className="text-sm font-semibold text-primary-600 hover:text-primary-700">Entrar →</button>
          </div>
        </footer>
      </main>

      {/* Suporte flutuante (igual login) */}
      <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5a] hover:scale-110 active:scale-95 transition-all bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte" aria-label="Falar com suporte no WhatsApp">
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>
    </div>
  )
}

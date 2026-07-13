import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Radar, Zap, GitBranch, BarChart3, Globe, Check, ArrowRight, Star, Database, Mail, LogIn } from 'lucide-react'
import logo from '../assets/logo.png'
import autsendLogo from '../assets/autsendlogo.png'
import ShootingStars from '../components/ShootingStars'
import WhatsAppIcon from '../components/WhatsAppIcon'
import { PLANOS, PLANO_CHECKOUT } from '../lib/plans'
import { SUPPORT_WHATSAPP } from '../lib/constants'

const FEATURES = [
  { icon: WhatsAppIcon, wa: true, title: 'WhatsApp + E-mail', desc: 'Remarketing nos dois canais que mais convertem, num lugar só.' },
  { icon: Radar, title: 'Captura por Webhook', desc: 'Conecte sua plataforma de vendas e puxe cada compra automaticamente.' },
  { icon: Database, title: 'Banco de Leads', desc: 'Um CRM que unifica o mesmo lead por e-mail ou telefone.' },
  { icon: Zap, title: 'Automações', desc: 'Dispare a mensagem certa no evento certo — sem operar na mão.' },
  { icon: GitBranch, title: 'Funil', desc: 'Sequências automáticas que recuperam venda enquanto você dorme.' },
  { icon: BarChart3, title: 'Métricas', desc: 'Receita atribuída, aberturas, cliques e estornos cruzados.' },
]

const PLANOS_LP = [
  { key: 'free', preco: 'R$0', tag: null, destaque: false, features: ['1 tracker', 'E-mail (50/mês) via sua API', '1 template + 1 grupo de produto', 'Automação de compra aprovada'] },
  { key: 'inicial', preco: 'R$67', tag: 'Entrada', destaque: false, features: ['2 trackers', 'WhatsApp completo · 1 instância', '500 e-mails/mês', 'Banco de Leads, Funil e Métricas'] },
  { key: 'padrao', preco: 'R$127', tag: 'Mais popular', destaque: true, features: ['10 trackers', 'WhatsApp · 2 instâncias', '3.000 e-mails/mês · 1 domínio', 'Tudo desbloqueado'] },
  { key: 'pro', preco: 'R$197', tag: 'Máximo', destaque: false, features: ['20 trackers', 'WhatsApp · 4 instâncias', '10.000 e-mails/mês · 2 domínios', 'Limites maiores e prioridade'] },
]

const DEPOIMENTOS = [
  { nome: 'Seu cliente aqui', papel: 'Infoprodutor', texto: 'Espaço para um depoimento real de quem usa o Autsend. Edite este texto quando tiver.' },
  { nome: 'Seu cliente aqui', papel: 'Afiliado', texto: 'Outro depoimento de resultado — recuperação de vendas, conversão, faturamento.' },
  { nome: 'Seu cliente aqui', papel: 'Agência', texto: 'Prova social de uma agência ou operação maior usando a plataforma no dia a dia.' },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] } }),
}

export default function Landing() {
  const navigate = useNavigate()
  const irLogin = () => navigate('/login')
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

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
        {/* ── Hero ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
          <motion.img variants={fadeUp} initial="hidden" animate="show" src={logo} alt="Autsend" className="h-16 sm:h-20 w-auto mx-auto mb-6 drop-shadow-sm" />
          <motion.h1 variants={fadeUp} initial="hidden" animate="show" custom={1} className="text-3xl sm:text-5xl font-extrabold text-stone-800 leading-tight text-balance max-w-3xl mx-auto">
            Recupere cada venda no <span className="bg-gradient-to-br from-primary-600 to-violet-600 bg-clip-text text-transparent">WhatsApp e no E-mail</span>
          </motion.h1>
          <motion.p variants={fadeUp} initial="hidden" animate="show" custom={2} className="mt-5 text-base sm:text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">
            Capture leads das suas vendas, dispare remarketing automático e acompanhe a receita recuperada — tudo num painel só.
          </motion.p>
          <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button onClick={irLogin} className="inline-flex items-center justify-center gap-2 rounded-xl px-6 min-h-[52px] text-sm font-semibold text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-lg shadow-primary-600/25 hover:brightness-105 transition w-full sm:w-auto">
              Começar agora <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={() => scrollTo('planos')} className="inline-flex items-center justify-center gap-2 rounded-xl px-6 min-h-[52px] text-sm font-semibold text-stone-700 bg-white/70 border border-white/60 backdrop-blur hover:border-primary-300 transition w-full sm:w-auto">
              Ver planos
            </button>
          </motion.div>
        </section>

        {/* ── Recursos ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <motion.div key={i} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} custom={i}
                  className="rounded-2xl p-5 bg-white/50 backdrop-blur-xl border border-white/50 shadow-[0_10px_30px_-12px_rgba(74,70,222,0.15)]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-violet-600 text-white mb-3">
                    {f.wa ? <WhatsAppIcon className="w-5 h-5" white /> : <Icon className="w-5 h-5" />}
                  </span>
                  <h3 className="text-base font-bold text-stone-800 mb-1">{f.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
                </motion.div>
              )
            })}
          </div>
        </section>

        {/* ── Planos ── */}
        <section id="planos" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
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
        </section>

        {/* ── Depoimentos ── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <motion.h2 variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-2xl sm:text-4xl font-extrabold text-stone-800 text-center text-balance">Quem usa, recomenda</motion.h2>
          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            {DEPOIMENTOS.map((d, i) => (
              <motion.div key={i} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} custom={i}
                className="rounded-2xl p-5 bg-white/50 backdrop-blur-xl border border-white/50 shadow-[0_10px_30px_-12px_rgba(74,70,222,0.12)]">
                <div className="flex gap-0.5 mb-3">{Array.from({ length: 5 }).map((_, s) => <Star key={s} className="w-4 h-4 fill-amber-400 text-amber-400" />)}</div>
                <p className="text-sm text-stone-600 leading-relaxed mb-4">“{d.texto}”</p>
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-violet-600 text-white text-sm font-bold">{d.nome.charAt(0)}</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold text-stone-800 truncate">{d.nome}</span><span className="block text-[11px] text-stone-400">{d.papel}</span></span>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── CTA final ── */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="rounded-3xl p-8 sm:p-12 text-center bg-gradient-to-br from-primary-500 to-violet-600 shadow-2xl shadow-primary-600/25">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white text-balance">Pronto para recuperar mais vendas?</h2>
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

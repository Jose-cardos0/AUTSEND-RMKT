import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation, useOutlet } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut, Link2, MessageCircle, MessageSquare, Send, Zap, Users, Menu, X, Mail, Radar, LayoutTemplate, ChevronDown, ChevronLeft, ChevronRight, BarChart3, GitBranch, Package, Settings, ShoppingBag, Database, ShieldCheck, Smartphone, Clock, Lock, User, Globe, Phone, PhoneCall, Rocket } from 'lucide-react'
import GlobeCheckIcon from './GlobeCheckIcon'
import { auth } from '../lib/firebase'
import { isAdmin, adminGetSecurityReport } from '../lib/admin'
import { usePlano } from '../lib/PlanoContext'
import { ROTA_FEATURE } from '../lib/plans'
import { signOut } from 'firebase/auth'
import clsx from 'clsx'
import sendlyLogo from '../assets/autsendlogo.png'
import euaflag from '../assets/euaflag.png'
import brlflag from '../assets/flags/br-flag.png'
import WhatsAppIcon from './WhatsAppIcon'
import ParticlesBackground from './ParticlesBackground'
import { SUPPORT_WHATSAPP } from '../lib/constants'
import MelhorarPlano from './MelhorarPlano'
import FireonPromoCard from './FireonPromoCard'
import gifteImg from '../assets/gifte.webp'

// Navegação por canal. Cada grupo vira uma seção colapsável na sidebar (desktop) e no menu mobile.
const navGroups = [
  {
    key: 'geral',
    label: 'Geral',
    icon: Settings,
    items: [
      { to: '/tracker', label: 'Webhooks', icon: Radar },
      { to: '/banco-leads', label: 'Banco de Leads', icon: Database },
      { to: '/produtos', label: 'Produtos', icon: Package },
      { to: '/checkouts', label: 'Checkouts', icon: ShoppingBag },
      { to: '/templates', label: 'Templates', icon: MessageSquare },
      { to: '/numeros', label: 'Números', icon: Phone, img: euaflag },
    ],
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: WhatsAppIcon,
    items: [
      { to: '/integracoes', label: 'Integrações', icon: Link2 },
      { to: '/automacoes', label: 'Automações', icon: Zap },
      { to: '/remarketing', label: 'Remarketing', icon: MessageCircle },
      // Disparo para grupos removido (não portado pro WAHA — não vamos mais usar).
      // { to: '/remarketing-grupos', label: 'Grupos', icon: Users },
      { to: '/enviar-mensagem', label: 'Disparos', icon: Send },
      { to: '/funil', label: 'Funil', icon: GitBranch },
      { to: '/metricas', label: 'Métricas', icon: BarChart3 },
    ],
  },
  {
    key: 'atendentes',
    label: 'Comercial',
    icon: GlobeCheckIcon,
    items: [
      { to: '/atendentes', label: 'Vendedores', icon: Rocket, end: true },
      { to: '/atendentes/relatorio', label: 'Relatório', icon: BarChart3 },
    ],
  },
  {
    key: 'email',
    label: 'E-mail',
    icon: Mail,
    items: [
      { to: '/email/integracoes', label: 'Integrações', icon: Link2 },
      { to: '/email/construtor', label: 'Construtor', icon: LayoutTemplate },
      { to: '/email/automacoes', label: 'Automações', icon: Zap },
      { to: '/email/disparos', label: 'Disparos', icon: Send },
      { to: '/email/funil', label: 'Funil', icon: GitBranch },
      { to: '/email/metricas', label: 'Métricas', icon: BarChart3 },
    ],
  },
  {
    key: 'sms',
    label: 'SMS',
    icon: Smartphone,
    // Integração/números migrou pra Geral → Números (gerenciador único). SMS só tem os subgrupos operacionais.
    items: [],
    subgroups: [
      {
        key: 'sms-eua',
        label: 'EUA',
        img: euaflag,
        items: [
          { to: '/sms/eua/automacoes', label: 'Automações', icon: Zap },
          { to: '/sms/eua/remarketing', label: 'Remarketing', icon: MessageCircle },
          { to: '/sms/eua/disparos', label: 'Disparos', icon: Send },
          { to: '/sms/eua/funil', label: 'Funil', icon: GitBranch },
          { to: '/sms/eua/metricas', label: 'Métricas', icon: BarChart3 },
        ],
      },
      {
        // SMS Brasil (+55) via SMSDev — crédito-only.
        key: 'sms-brl',
        label: 'BRL',
        img: brlflag,
        items: [
          { to: '/sms/brl/automacoes', label: 'Automações', icon: Zap },
          { to: '/sms/brl/remarketing', label: 'Remarketing', icon: MessageCircle },
          { to: '/sms/brl/disparos', label: 'Disparos', icon: Send },
          { to: '/sms/brl/funil', label: 'Funil', icon: GitBranch },
          { to: '/sms/brl/metricas', label: 'Métricas', icon: BarChart3 },
        ],
      },
      {
        // Só aparece pra quem conectou a própria conta Telnyx (BYO). Envia pra qualquer país (mundial).
        key: 'sms-api',
        label: "API's",
        icon: Globe,
        soApi: true,
        items: [
          { to: '/sms/api/automacoes', label: 'Automações', icon: Zap },
          { to: '/sms/api/remarketing', label: 'Remarketing', icon: MessageCircle },
          { to: '/sms/api/disparos', label: 'Disparos', icon: Send },
          { to: '/sms/api/funil', label: 'Funil', icon: GitBranch },
          { to: '/sms/api/metricas', label: 'Métricas', icon: BarChart3 },
        ],
      },
    ],
  },
  {
    key: 'call',
    label: 'Ligação IA',
    icon: Phone,
    // Ativar voz/números migrou pra Geral → Números. Ligação IA só tem os subgrupos operacionais.
    items: [],
    subgroups: [
      {
        key: 'call-eua',
        label: 'EUA',
        img: euaflag,
        items: [
          { to: '/call/eua/campanha', label: 'Campanha', icon: PhoneCall },
          { to: '/call/eua/automacoes', label: 'Automações', icon: Zap },
          { to: '/call/eua/funil', label: 'Funil', icon: GitBranch },
          { to: '/call/eua/metricas', label: 'Métricas', icon: BarChart3 },
        ],
      },
    ],
  },
]

const allGroupItems = (group) => [...(group.items || []), ...(group.subgroups || []).flatMap((sg) => sg.items || [])]
const isGroupActive = (group, pathname) =>
  allGroupItems(group).some((it) => pathname === it.to || pathname.startsWith(it.to + '/'))

// Item usado no menu mobile (drawer).
function ItemLink({ to, label, icon: Icon, img, soon, locked, badge, onNavigate, onLocked }) {
  if (locked) {
    return (
      <button type="button" onClick={onLocked} title="Disponível em planos superiores"
        className="relative w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold text-stone-400 hover:text-primary-700 hover:bg-primary-50/70 transition-all duration-200">
        {img ? <img src={img} alt="" className="w-4 h-auto rounded-sm shrink-0 opacity-70" /> : <Icon className="w-4 h-4 opacity-70 shrink-0" />}
        <span className="flex-1">{label}</span>
        <Lock className="w-4 h-4 shrink-0 opacity-70" />
      </button>
    )
  }
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200',
          isActive
            ? 'text-white shadow-md shadow-primary-600/20 bg-gradient-to-br from-primary-500 to-primary-700 ring-1 ring-white/20'
            : 'text-stone-600 hover:text-primary-700 hover:bg-primary-50/80'
        )
      }
    >
      {img ? <img src={img} alt="" className="w-4 h-auto rounded-sm shrink-0 opacity-90" /> : <Icon className="w-4 h-4 opacity-90 shrink-0" />}
      <span className="flex-1">{label}</span>
      {badge && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" title="Alertas de segurança" />}
      {soon && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100/80 px-1.5 py-0.5 rounded-full shrink-0">
          Em breve
        </span>
      )}
    </NavLink>
  )
}

// Subitem (NavLink) da sidebar desktop.
function SubItemLink({ item, onLocked }) {
  const SubIcon = item.icon
  if (item.locked) {
    return (
      <button type="button" onClick={onLocked} title="Disponível em planos superiores"
        className="relative w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-lg text-[13px] font-medium text-stone-400 hover:text-primary-600 hover:bg-primary-50/60 transition-all duration-200">
        {item.img ? <img src={item.img} alt="" className="w-4 h-auto rounded-sm shrink-0 opacity-70" /> : <SubIcon className="w-4 h-4 shrink-0 opacity-70" />}
        <span className="flex-1 text-left">{item.label}</span>
        <Lock className="w-3.5 h-3.5 shrink-0 opacity-70" />
      </button>
    )
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        clsx(
          'relative flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-lg text-[13px] transition-all duration-200',
          isActive
            ? 'text-white font-semibold bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm shadow-primary-600/25'
            : 'text-stone-500 font-medium hover:text-primary-700 hover:bg-primary-50/70'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={clsx('absolute -left-[13px] top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-colors', isActive ? 'bg-primary-600' : 'bg-transparent')} />
          {item.img ? <img src={item.img} alt="" className="w-4 h-auto rounded-sm shrink-0 opacity-90" /> : <SubIcon className="w-4 h-4 shrink-0 opacity-90" />}
          <span className="flex-1">{item.label}</span>
          {item.badge && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" title="Alertas de segurança" />}
        </>
      )}
    </NavLink>
  )
}

// Subgrupo aninhado (ex.: EUA colapsável, BR congelado) — desktop e mobile.
function NestedSubGroup({ sg, mobile, onNavigate, onLocked }) {
  const location = useLocation()
  const active = (sg.items || []).some((it) => location.pathname === it.to || location.pathname.startsWith(it.to + '/'))
  const [open, setOpen] = useState(active)
  useEffect(() => { if (active) setOpen(true) }, [active])

  if (sg.soon) {
    return (
      <div className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-lg text-[13px] font-medium text-stone-400 cursor-not-allowed select-none" title="Em breve">
        {sg.img && <img src={sg.img} alt="" className="h-4 w-auto rounded-[3px] object-contain shrink-0 opacity-50" />}
        <span className="flex-1">{sg.label}</span>
        <Clock className="w-3.5 h-3.5 shrink-0" />
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-lg text-[13px] font-semibold text-stone-600 hover:bg-surface-100/70 transition-colors" aria-expanded={open}>
        {sg.img
          ? <img src={sg.img} alt="" className="h-4 w-auto rounded-[3px] object-contain shrink-0" />
          : sg.icon && <sg.icon className="w-4 h-4 text-primary-600 shrink-0" />}
        <span className="flex-1 text-left">{sg.label}</span>
        <ChevronDown className={clsx('w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="ml-3 pl-3 flex flex-col gap-0.5 mt-0.5 mb-1">
              {(sg.items || []).map((item) => (
                mobile ? <ItemLink key={item.to} {...item} onNavigate={onNavigate} onLocked={onLocked} /> : <SubItemLink key={item.to} item={item} onLocked={onLocked} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Grupo colapsável da sidebar (desktop).
function SidebarGroup({ group, open, onToggle, onLocked }) {
  const location = useLocation()
  const active = isGroupActive(group, location.pathname)
  const Icon = group.icon

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200',
          active ? 'text-primary-700' : 'text-stone-600 hover:text-stone-900 hover:bg-surface-100/70'
        )}
        aria-expanded={open}
      >
        <span
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors',
            active
              ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-600/30'
              : 'bg-surface-100 text-stone-500'
          )}
        >
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={clsx('w-4 h-4 text-stone-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[1.4rem] mt-0.5 mb-1 pl-3 border-l border-surface-200 flex flex-col gap-0.5">
              {(group.items || []).map((item) => <SubItemLink key={item.to} item={item} onLocked={onLocked} />)}
              {(group.subgroups || []).map((sg) => <NestedSubGroup key={sg.key} sg={sg} onLocked={onLocked} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const adminGroup = {
  key: 'admin',
  label: 'Admin',
  icon: ShieldCheck,
  items: [{ to: '/admin', label: 'Clientes', icon: Users }],
}

// Tela mostrada quando o plano do cliente não libera o recurso.
function UpgradeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center py-10">
      <div className="app-panel rounded-3xl p-8 sm:p-10 max-w-md text-center">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-violet-600 text-white mb-4 shadow-lg shadow-primary-600/25">
          <ShieldCheck className="w-8 h-8" />
        </span>
        <h2 className="text-xl font-bold text-stone-800 mb-1.5">Recurso do plano superior</h2>
        <p className="text-sm text-stone-500 leading-relaxed mb-6">Esse recurso não está incluído no seu plano atual. Faça upgrade pra desbloquear e turbinar seus resultados.</p>
        <div className="flex justify-center">
          <MelhorarPlano label="Ver planos disponíveis" />
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const outlet = useOutlet()
  const [authUser] = useAuthState(auth)
  const { temFeature, fotoURL, temSmsApi } = usePlano()
  const [secAlerta, setSecAlerta] = useState(false)
  useEffect(() => {
    if (!isAdmin(authUser)) return
    let vivo = true
    const puxar = () => adminGetSecurityReport().then((r) => { if (vivo) setSecAlerta(!!r?.naoVisto) }).catch(() => {})
    puxar()
    const id = setInterval(puxar, 5 * 60 * 1000) // re-checa a cada 5 min
    return () => { vivo = false; clearInterval(id) }
  }, [authUser?.uid])
  const adminGroupBadge = { ...adminGroup, items: adminGroup.items.map((it) => ({ ...it, badge: secAlerta })) }
  const baseGroups = isAdmin(authUser) ? [...navGroups, adminGroupBadge] : navGroups
  // Mostra TUDO no menu; o que o plano não libera vira bloqueado (cadeado + popup de upgrade).
  const podeItem = (it) => { const f = ROTA_FEATURE[it.to]; return !f || temFeature(f) }
  const marcar = (it) => ({ ...it, locked: !podeItem(it) })
  const groups = baseGroups.map((g) => ({
    ...g,
    items: (g.items || []).map(marcar),
    // Subgrupo "API's" (soApi) só aparece se o cliente conectou a própria conta Telnyx.
    subgroups: g.subgroups
      ? g.subgroups.filter((sg) => !sg.soApi || temSmsApi || isAdmin(authUser)).map((sg) => ({ ...sg, items: (sg.items || []).map(marcar) }))
      : undefined,
  }))
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const abrirUpgrade = () => setUpgradeOpen(true)
  const [fireonOpen, setFireonOpen] = useState(false) // popup da oferta Fireon (disparado pelo gift ou por qualquer página)
  useEffect(() => {
    const abrir = () => setFireonOpen(true)
    window.addEventListener('open-fireon', abrir)
    return () => window.removeEventListener('open-fireon', abrir)
  }, [])
  // Rota bloqueada pelo plano (acesso direto por URL)
  const rotaBloqueada = (() => {
    const k = Object.keys(ROTA_FEATURE).find((k) => location.pathname === k || location.pathname.startsWith(k + '/'))
    return k ? !temFeature(ROTA_FEATURE[k]) : false
  })()
  const [menuOpen, setMenuOpen] = useState(false)
  // Grupos abertos na sidebar. Começa com o grupo da rota atual aberto.
  const [openGroups, setOpenGroups] = useState(() => {
    const g = groups.find((gr) => isGroupActive(gr, location.pathname))
    return g ? { [g.key]: true } : {}
  })
  // O construtor de e-mail, o funil e o remarketing usam mais largura (lista/editor lado a lado)
  const wide = location.pathname.startsWith('/email/construtor') || location.pathname.startsWith('/email/funil') || location.pathname.startsWith('/funil') || location.pathname.startsWith('/remarketing') || location.pathname.startsWith('/automacoes') || location.pathname.startsWith('/email/automacoes') || location.pathname.startsWith('/email/metricas') || location.pathname.startsWith('/metricas') || /\/sms\/(eua|api|brl)?\/?(funil|automacoes|remarketing|metricas)/.test(location.pathname) || /\/call\/(eua|api)?\/?(campanha|automacoes|funil|metricas)/.test(location.pathname)

  // Ao navegar, garante que o grupo da rota atual esteja aberto.
  useEffect(() => {
    const g = groups.find((gr) => isGroupActive(gr, location.pathname))
    if (g) setOpenGroups((s) => (s[g.key] ? s : { ...s, [g.key]: true }))
  }, [location.pathname])

  const toggleGroup = (key) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }))

  // Esconder/expandir a sidebar no desktop (persistido).
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('autsend:sidebarHidden') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('autsend:sidebarHidden', sidebarHidden ? '1' : '0') } catch (_) {}
  }, [sidebarHidden])

  const handleLogout = async () => {
    setMenuOpen(false)
    await signOut(auth)
    navigate('/login')
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <ParticlesBackground
      variant="app"
      className="bg-gradient-to-br from-surface-50 via-blue-50/50 to-violet-100/35"
    >
    <div className="app-viewport bg-transparent md:flex-row">
      {/* SIDEBAR — desktop */}
      <aside className={clsx('md:flex-col w-[15.5rem] shrink-0 border-r border-surface-200/70 bg-white/70 backdrop-blur-xl', sidebarHidden ? 'hidden' : 'hidden md:flex')}>
        <div className="h-[4.25rem] shrink-0 flex items-center justify-center px-4 border-b border-surface-200/60">
          <img src={sendlyLogo} alt="Autsend" className="h-11 w-auto" />
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-3 space-y-1">
          {groups.map((group) => (
            <SidebarGroup
              key={group.key}
              group={group}
              open={!!openGroups[group.key]}
              onToggle={() => toggleGroup(group.key)}
              onLocked={abrirUpgrade}
            />
          ))}
        </nav>

        <div className="shrink-0 border-t border-surface-200/60 p-2.5 space-y-1.5">
          <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
          <MelhorarPlano className="w-full" />
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleLogout}
              className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-stone-500 hover:text-red-600 hover:bg-red-50/80 transition-all text-[13px] font-semibold border border-transparent hover:border-red-100"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
            <button
              onClick={() => setSidebarHidden(true)}
              title="Esconder menu"
              aria-label="Esconder menu"
              className="shrink-0 p-2.5 rounded-xl text-stone-500 hover:text-primary-600 hover:bg-primary-50 border border-transparent hover:border-primary-100 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <NavLink
              to="/perfil"
              title="Meu perfil"
              aria-label="Meu perfil"
              className={({ isActive }) => clsx(
                'shrink-0 rounded-full border transition-all overflow-hidden',
                fotoURL ? 'p-0.5' : 'p-2.5',
                isActive
                  ? 'text-primary-600 bg-primary-50 border-primary-100'
                  : 'text-stone-500 hover:text-primary-600 hover:bg-primary-50 border-transparent hover:border-primary-100'
              )}
            >
              {fotoURL
                ? <img src={fotoURL} alt="Perfil" className="w-7 h-7 rounded-full object-cover" />
                : <User className="w-4 h-4" />}
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Botão flutuante para reabrir a sidebar (desktop) */}
      {sidebarHidden && (
        <button
          onClick={() => setSidebarHidden(false)}
          title="Expandir menu"
          aria-label="Expandir menu"
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-2 px-1.5 py-3 rounded-r-xl bg-white/90 backdrop-blur-xl border border-l-0 border-surface-200 shadow-md text-stone-600 hover:text-primary-600 hover:bg-white opacity-50 hover:opacity-100 transition-all"
        >
          <ChevronRight className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">Menu</span>
        </button>
      )}

      {/* COLUNA PRINCIPAL */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Topbar — mobile */}
        <header className="md:hidden shrink-0 z-40 border-b border-white/40 bg-white/75 backdrop-blur-xl shadow-[0_1px_0_rgba(255,255,255,0.8)]">
          <div className="px-4 h-[3.75rem] flex items-center justify-between gap-3">
            <div className="flex items-center min-w-0">
              <img src={sendlyLogo} alt="Autsend" className="h-7 w-auto" />
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-700 bg-white/90 border border-surface-200 shadow-sm hover:shadow touch-manipulation"
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {menuOpen && (
            <>
              <div
                className="fixed top-[3.75rem] left-0 right-0 bottom-0 bg-slate-900/35 backdrop-blur-[2px] z-40"
                onClick={closeMenu}
                aria-hidden="true"
              />
              <div className="fixed top-[3.75rem] left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-b border-surface-200 shadow-xl py-4 px-4 sm:px-6 max-h-[calc(100vh-3.75rem)] overflow-y-auto overscroll-contain space-y-2">
                {groups.map((group) => {
                  const Icon = group.icon
                  const open = !!openGroups[group.key]
                  return (
                    <div key={group.key} className="rounded-xl border border-surface-200/70 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className="w-full flex items-center gap-2 px-3 min-h-[48px] text-[12px] font-bold uppercase tracking-widest text-stone-500 hover:bg-surface-50 transition-colors"
                        aria-expanded={open}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left">{group.label}</span>
                        <ChevronDown className={clsx('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && (
                        <div className="flex flex-col gap-1 px-2 pb-2">
                          {(group.items || []).length > 0 && (
                            <div className="flex flex-col gap-1 [&>a]:min-h-[48px] [&>a]:px-4 [&>a]:py-3 [&>button]:min-h-[48px] [&>button]:px-4 [&>button]:py-3">
                              {group.items.map((item) => (
                                <ItemLink key={item.to} {...item} onNavigate={closeMenu} onLocked={abrirUpgrade} />
                              ))}
                            </div>
                          )}
                          {(group.subgroups || []).map((sg) => <NestedSubGroup key={sg.key} sg={sg} mobile onNavigate={closeMenu} onLocked={abrirUpgrade} />)}
                        </div>
                      )}
                    </div>
                  )
                })}
                <MelhorarPlano className="w-full mt-2" />
                <NavLink
                  to="/perfil"
                  onClick={closeMenu}
                  className="flex items-center gap-2 w-full min-h-[48px] px-4 py-3 mt-2 rounded-xl text-stone-600 hover:bg-primary-50 hover:text-primary-600 font-semibold text-[13px] touch-manipulation border border-surface-200"
                >
                  {fotoURL
                    ? <img src={fotoURL} alt="Perfil" className="w-5 h-5 rounded-full object-cover" />
                    : <User className="w-4 h-4" />}
                  Meu perfil
                </NavLink>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full min-h-[48px] px-4 py-3 mt-2 rounded-xl text-red-600 hover:bg-red-50 font-semibold text-[13px] touch-manipulation border border-red-100"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </div>
            </>
          )}
        </header>

        <main className="app-main w-full min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={clsx(
                'w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col flex-1 min-h-0',
                location.pathname.startsWith('/admin') ? 'lg:max-w-[95%]' : location.pathname.startsWith('/banco-leads') ? 'lg:max-w-[95%]' : location.pathname === '/atendentes/relatorio' ? 'lg:max-w-[85%]' : wide ? 'lg:max-w-[92%]' : 'max-w-6xl'
              )}
            >
              {rotaBloqueada ? <UpgradeScreen /> : outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-600/30 hover:scale-105 active:scale-95 transition-all duration-200 touch-manipulation bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte"
        aria-label="Falar com suporte no WhatsApp"
      >
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>

      {/* Gift flutuante (acima do WhatsApp) → abre a oferta do Fireon */}
      <motion.button
        type="button"
        onClick={() => setFireonOpen(true)}
        whileHover={{ scale: 1.28 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 300, damping: 16 }}
        className="fixed z-50 w-14 h-14 sm:w-16 sm:h-16 bottom-[4.5rem] right-[max(0.9rem,env(safe-area-inset-right))] sm:bottom-24 sm:right-[1.9rem] touch-manipulation"
        title="Oferta exclusiva pra você"
        aria-label="Ver oferta exclusiva do Fireon"
      >
        <motion.img
          src={gifteImg} alt="Presente" draggable="false"
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          className="w-full h-full object-contain select-none pointer-events-none"
        />
      </motion.button>

      {/* Popup da oferta Fireon */}
      <AnimatePresence>
        {fireonOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setFireonOpen(false)}
            className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                onClick={() => setFireonOpen(false)}
                className="absolute top-3 right-3 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white backdrop-blur transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
              <FireonPromoCard />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </ParticlesBackground>
  )
}

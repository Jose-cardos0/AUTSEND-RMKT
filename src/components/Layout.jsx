import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, Link2, MessageCircle, Send, Zap, Users, Menu, X } from 'lucide-react'
import { auth } from '../lib/firebase'
import { signOut } from 'firebase/auth'
import clsx from 'clsx'
import logo from '../assets/logo.png'
import WhatsAppIcon from './WhatsAppIcon'
import { SUPPORT_WHATSAPP } from '../lib/constants'

const nav = [
  { to: '/integracoes', label: 'Integrações', icon: Link2 },
  { to: '/automacoes', label: 'Automações', icon: Zap },
  { to: '/remarketing', label: 'Remarketing', icon: MessageCircle },
  { to: '/remarketing-grupos', label: 'Grupos', icon: Users },
  { to: '/enviar-mensagem', label: 'Disparos', icon: Send },
]

function NavLinks({ onNavigate, className = '' }) {
  return (
    <nav className={clsx('flex flex-col md:flex-row md:items-center gap-1 md:gap-1', className)}>
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'relative flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200',
              isActive
                ? 'text-white shadow-lg shadow-primary-600/25 bg-gradient-to-br from-primary-500 to-primary-700 ring-1 ring-white/20'
                : 'text-stone-600 hover:text-primary-700 hover:bg-white/80 hover:shadow-sm'
            )
          }
        >
          <Icon className="w-4 h-4 opacity-90" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    setMenuOpen(false)
    await signOut(auth)
    navigate('/login')
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="app-viewport bg-surface-50">
      <header className="shrink-0 z-40 border-b border-white/40 bg-white/75 backdrop-blur-xl shadow-[0_1px_0_rgba(255,255,255,0.8)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[3.75rem] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-primary-400/20 to-violet-400/20 blur-md" />
              <img src={logo} alt="CODE NXT" className="relative h-8 sm:h-9 w-auto" />
            </div>
            <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600/80 truncate">
              Remarketing
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1 p-1 rounded-2xl bg-surface-100/80 border border-surface-200/60">
            <NavLinks />
          </div>

          <div className="hidden md:flex items-center">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-stone-500 hover:text-red-600 hover:bg-red-50/80 transition-all text-[13px] font-semibold border border-transparent hover:border-red-100"
              aria-label="Sair"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-700 bg-white/90 border border-surface-200 shadow-sm hover:shadow touch-manipulation"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <>
            <div
              className="fixed top-[3.75rem] left-0 right-0 bottom-0 bg-slate-900/35 backdrop-blur-[2px] z-40 md:hidden"
              onClick={closeMenu}
              aria-hidden="true"
            />
            <div className="fixed top-[3.75rem] left-0 right-0 z-50 md:hidden bg-white/95 backdrop-blur-xl border-b border-surface-200 shadow-xl py-4 px-4 sm:px-6 max-h-[calc(100vh-3.75rem)] overflow-y-auto overscroll-contain">
              <NavLinks onNavigate={closeMenu} className="gap-1 [&>a]:min-h-[48px] [&>a]:px-4 [&>a]:py-3" />
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
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col flex-1 min-h-0">
          <Outlet />
        </div>
      </main>

      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-lg shadow-emerald-600/30 hover:scale-105 active:scale-95 transition-all duration-200 touch-manipulation bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6 ring-2 ring-white/40"
        title="Falar com suporte"
        aria-label="Falar com suporte no WhatsApp"
      >
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>
    </div>
  )
}

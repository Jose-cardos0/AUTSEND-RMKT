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
    <nav className={clsx('flex flex-col md:flex-row md:items-center gap-0 md:gap-0.5', className)}>
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all duration-200',
              isActive
                ? 'bg-primary-50 text-primary-700 shadow-sm'
                : 'text-stone-500 hover:text-stone-700 hover:bg-surface-100'
            )
          }
        >
          <Icon className="w-3.5 h-3.5" />
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
    <div className="min-h-screen flex flex-col bg-surface-50">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-surface-200/80 shadow-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center">
            <img src={logo} alt="CODE NXT" className="h-7 w-auto" />
          </div>

          {/* Desktop: nav + logout */}
          <div className="hidden md:flex items-center gap-0.5">
            <NavLinks />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-stone-500 hover:text-stone-700 hover:bg-surface-100 transition-all text-[13px] font-medium"
              aria-label="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>

          {/* Mobile: hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-600 hover:bg-surface-100 active:bg-surface-200 transition-colors touch-manipulation"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile menu: overlay só na página (abaixo do header); menu em cima */}
        {menuOpen && (
          <>
            <div
              className="fixed top-14 left-0 right-0 bottom-0 bg-black/40 z-40 md:hidden"
              onClick={closeMenu}
              aria-hidden="true"
            />
            <div className="fixed top-14 left-0 right-0 z-50 md:hidden bg-white border-b border-surface-200 shadow-lg py-4 px-4 sm:px-6 max-h-[calc(100vh-3.5rem)] overflow-y-auto overscroll-contain">
              <NavLinks onNavigate={closeMenu} className="gap-0.5 [&>a]:min-h-[44px] [&>a]:items-center [&>a]:px-4 [&>a]:py-3" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 w-full min-h-[44px] px-4 py-3 mt-2 rounded-xl text-stone-500 hover:text-stone-700 hover:bg-surface-100 active:bg-surface-200 transition-all text-[13px] font-medium touch-manipulation"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair
              </button>
            </div>
          </>
        )}
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5a] hover:scale-110 active:scale-95 transition-all duration-200 touch-manipulation bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte"
        aria-label="Falar com suporte no WhatsApp"
      >
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>
    </div>
  )
}

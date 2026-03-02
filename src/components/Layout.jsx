import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, Link2, MessageCircle, Send, Zap } from 'lucide-react'
import { auth } from '../lib/firebase'
import { signOut } from 'firebase/auth'
import clsx from 'clsx'

const nav = [
  { to: '/integracoes', label: 'Integrações', icon: Link2 },
  { to: '/automacoes', label: 'Automações', icon: Zap },
  { to: '/remarketing', label: 'Remarketing', icon: MessageCircle },
  { to: '/enviar-mensagem', label: 'Enviar mensagem', icon: Send },
]

export default function Layout() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-surface-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary-600 font-semibold">
            <LayoutDashboard className="w-6 h-6" />
            <span>Remarketing</span>
          </div>
          <nav className="flex items-center gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-gray-600 hover:bg-surface-100 hover:text-gray-800'
                  )
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-surface-100 hover:text-gray-800 transition-colors"
            aria-label="Sair"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Sair</span>
          </button>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

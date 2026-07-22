import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Menu, X, ChevronLeft, ChevronRight, BookOpen, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { DOCS, ARTIGOS_FLAT } from './docs/data'
import autsendLogo from '../assets/autsendlogo.png'
import { SUPPORT_WHATSAPP } from '../lib/constants'
import WhatsAppIcon from '../components/WhatsAppIcon'

/** Documentação pública do Autsend (/docs) — sidebar por grupos, busca e artigos didáticos. */
export default function Docs() {
  const navigate = useNavigate()
  const [sel, setSel] = useState(() => {
    // Deep-link: /docs#id-do-artigo
    const hash = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '')
    const hit = ARTIGOS_FLAT.find((x) => x.artigo.id === hash)
    return hit ? hit.artigo.id : ARTIGOS_FLAT[0].artigo.id
  })
  const [busca, setBusca] = useState('')
  const [menuAberto, setMenuAberto] = useState(false)

  const atualIdx = ARTIGOS_FLAT.findIndex((x) => x.artigo.id === sel)
  const atual = ARTIGOS_FLAT[Math.max(0, atualIdx)]
  const anterior = ARTIGOS_FLAT[atualIdx - 1] || null
  const proximo = ARTIGOS_FLAT[atualIdx + 1] || null

  const abrir = (id) => {
    setSel(id)
    setMenuAberto(false)
    setBusca('')
    try { window.history.replaceState(null, '', `#${id}`) } catch (_) {}
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => { document.title = 'Documentação · Autsend' }, [])

  // Busca simples por título + descrição.
  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return null
    return ARTIGOS_FLAT.filter(({ grupo, artigo }) =>
      `${grupo.label} ${artigo.titulo} ${artigo.desc}`.toLowerCase().includes(q)
    )
  }, [busca])

  const Sidebar = ({ compact = false }) => (
    <nav className={clsx('space-y-5', compact && 'pb-8')}>
      {resultados ? (
        <div>
          <p className="px-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">
            {resultados.length} resultado(s)
          </p>
          <div className="space-y-0.5">
            {resultados.map(({ grupo, artigo }) => (
              <button key={artigo.id} onClick={() => abrir(artigo.id)}
                className="w-full text-left px-3 py-2 rounded-xl text-[13px] hover:bg-primary-50/80 transition">
                <span className="block font-semibold text-stone-700">{artigo.titulo}</span>
                <span className="block text-[11px] text-stone-400">{grupo.label}</span>
              </button>
            ))}
            {resultados.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">Nada encontrado.</p>}
          </div>
        </div>
      ) : (
        DOCS.map((g) => (
          <div key={g.key}>
            <p className="px-2 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
              <g.icon className="w-3.5 h-3.5" /> {g.label}
            </p>
            <div className="space-y-0.5">
              {g.artigos.map((a) => (
                <button key={a.id} onClick={() => abrir(a.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-xl text-[13px] font-semibold transition-all duration-150',
                    sel === a.id
                      ? 'text-white shadow-md shadow-primary-600/20 bg-gradient-to-br from-primary-500 to-primary-700'
                      : 'text-stone-600 hover:text-primary-700 hover:bg-primary-50/80'
                  )}>
                  {a.titulo}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </nav>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 via-blue-50/40 to-violet-100/30 text-stone-800">
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b border-white/50 bg-white/70 backdrop-blur-xl">
        <div className="max-w-[88rem] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <button onClick={() => setMenuAberto(true)} className="lg:hidden p-2 -ml-2 text-stone-500 hover:text-stone-700" aria-label="Abrir menu">
            <Menu className="w-5 h-5" />
          </button>
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <img src={autsendLogo} alt="Autsend" className="h-7 w-auto" />
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-primary-100 text-primary-700 border border-primary-200">
            <BookOpen className="w-3 h-3" /> Documentação
          </span>
          <div className="flex-1" />
          <div className="relative w-full max-w-[240px] sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar na documentação…"
              className="w-full pl-9 pr-3 min-h-[38px] rounded-xl border border-surface-200 bg-white/80 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <button onClick={() => navigate('/login')} className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:text-primary-700 shrink-0">
            Entrar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="max-w-[88rem] mx-auto px-4 sm:px-6 py-6 lg:py-8 flex gap-8">
        {/* Sidebar desktop */}
        <aside className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <Sidebar />
          </div>
        </aside>

        {/* Drawer mobile */}
        <AnimatePresence>
          {menuAberto && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setMenuAberto(false)}>
              <motion.div initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: 'tween', duration: 0.2 }}
                className="h-full w-[300px] bg-white shadow-xl p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <img src={autsendLogo} alt="Autsend" className="h-6 w-auto" />
                  <button onClick={() => setMenuAberto(false)} className="p-1.5 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
                </div>
                <Sidebar compact />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Conteúdo */}
        <main className="flex-1 min-w-0">
          <motion.article key={atual.artigo.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className="app-panel rounded-2xl bg-white/80 backdrop-blur-xl border border-white/60 shadow-[0_10px_30px_-12px_rgba(74,70,222,0.12)] p-5 sm:p-8 lg:p-10">
            <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-primary-600 mb-2">
              <atual.grupo.icon className="w-3.5 h-3.5" /> {atual.grupo.label}
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-800 text-balance">{atual.artigo.titulo}</h1>
            <p className="mt-2 text-[15px] text-stone-500">{atual.artigo.desc}</p>
            <div className="mt-2 border-t border-surface-100 pt-2">{atual.artigo.corpo}</div>

            {/* Navegação anterior / próximo */}
            <div className="mt-10 pt-5 border-t border-surface-100 flex flex-col sm:flex-row gap-3">
              {anterior ? (
                <button onClick={() => abrir(anterior.artigo.id)}
                  className="flex-1 group flex items-center gap-2 rounded-xl border border-surface-200 bg-white px-4 py-3 text-left hover:border-primary-300 transition">
                  <ChevronLeft className="w-4 h-4 text-stone-400 group-hover:text-primary-600 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-400">Anterior</span>
                    <span className="block text-sm font-semibold text-stone-700 truncate">{anterior.artigo.titulo}</span>
                  </span>
                </button>
              ) : <span className="flex-1" />}
              {proximo ? (
                <button onClick={() => abrir(proximo.artigo.id)}
                  className="flex-1 group flex items-center justify-end gap-2 rounded-xl border border-surface-200 bg-white px-4 py-3 text-right hover:border-primary-300 transition">
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-400">Próximo</span>
                    <span className="block text-sm font-semibold text-stone-700 truncate">{proximo.artigo.titulo}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-primary-600 shrink-0" />
                </button>
              ) : <span className="flex-1" />}
            </div>
          </motion.article>

          <p className="text-center text-xs text-stone-400 mt-6">
            Ficou com dúvida? <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-600 hover:underline">Chama o suporte no WhatsApp</a> — a gente configura junto com você.
          </p>
        </main>
      </div>

      {/* Suporte flutuante */}
      <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer"
        className="fixed z-50 flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5a] hover:scale-110 active:scale-95 transition-all bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6"
        title="Falar com suporte" aria-label="Falar com suporte no WhatsApp">
        <WhatsAppIcon className="w-6 h-6 sm:w-7 sm:h-7" white />
      </a>
    </div>
  )
}

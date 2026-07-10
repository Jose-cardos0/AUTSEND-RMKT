import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { AnimatePresence, motion } from 'framer-motion'
import { auth } from '../lib/firebase'
import { getCheckoutStores } from '../lib/firestore'
import { lojaByKey } from '../lib/lojas'
import { ShoppingBag, Search, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const PAGE_SIZE = 5

/** Botão "Checkout" + popup com busca/paginação. Ao escolher, chama onPick(link). */
export default function CheckoutPicker({ onPick, buttonClassName }) {
  const [user] = useAuthState(auth)
  const [open, setOpen] = useState(false)
  const [checkouts, setCheckouts] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const abrir = async () => {
    setOpen(true); setQ(''); setPage(1)
    if (!user?.uid) return
    setLoading(true)
    try {
      const stores = await getCheckoutStores(user.uid)
      const flat = (stores || [])
        .filter((s) => s.ativo !== false)
        .flatMap((s) => (s.produtos || []).filter((p) => p.link).map((p) => ({ ...p, loja: s.loja })))
      setCheckouts(flat)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? checkouts.filter((c) => (c.nome || '').toLowerCase().includes(t) || (c.link || '').toLowerCase().includes(t)) : checkouts
  }, [q, checkouts])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pg = Math.min(page, totalPages)
  const itens = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE)

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title="Inserir checkout"
        className={buttonClassName || 'flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-primary-600 hover:bg-primary-50 text-xs font-semibold transition-colors'}
      >
        <ShoppingBag className="w-3.5 h-3.5" /> Checkout
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ShoppingBag className="w-4 h-4" /></span>
                <h3 className="text-sm font-semibold text-stone-800 flex-1">Inserir checkout</h3>
                <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>
              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
              ) : checkouts.length === 0 ? (
                <p className="px-2 py-6 text-sm text-stone-500 text-center leading-relaxed">Nenhum checkout salvo.<br />Cadastre em <Link to="/checkouts" className="text-primary-600 underline">Checkouts</Link>.</p>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Pesquisar checkout..." autoFocus className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
                  </div>
                  <ul className="space-y-1 min-h-[60px]">
                    {itens.length === 0 && <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>}
                    {itens.map((c, i) => {
                      const loja = lojaByKey(c.loja)
                      return (
                        <li key={c.id || i}>
                          <button type="button" onClick={() => { onPick?.(c.link); setOpen(false) }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-100 text-left transition-colors">
                            {loja?.logo ? <img src={loja.logo} alt="" className="w-7 h-7 object-contain shrink-0" /> : <ShoppingBag className="w-5 h-5 text-stone-400 shrink-0" />}
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-stone-800 truncate">{c.nome}</span>
                              <span className="block text-[11px] text-stone-400 truncate">{c.link}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-stone-500">Página {pg} de {totalPages}</span>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pg <= 1} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pg >= totalPages} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

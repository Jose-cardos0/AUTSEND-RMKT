import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { auth } from '../lib/firebase'
import { getMessageTemplates } from '../lib/firestore'
import { FileText, Search, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const PAGE_SIZE = 5

/**
 * Botão + popup pra escolher um template de mensagem salvo (copy).
 * Ao escolher, chama onPick(textoDaMensagem).
 */
export default function TemplatePicker({ onPick, label = 'Usar template', className }) {
  const [user] = useAuthState(auth)
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const abrir = async () => {
    setOpen(true); setQ(''); setPage(1)
    if (!user?.uid) return
    setLoading(true)
    try { setTemplates(await getMessageTemplates(user.uid)) } finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? templates.filter((x) => (x.nome || '').toLowerCase().includes(t) || (x.mensagem || '').toLowerCase().includes(t)) : templates
  }, [q, templates])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pg = Math.min(page, totalPages)
  const itens = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE)

  const pick = (t) => { onPick?.(t.mensagem || ''); setOpen(false) }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={clsx('inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white text-stone-600 hover:text-primary-700 hover:border-primary-200 hover:bg-primary-50/50 text-sm font-medium transition-colors', className)}
      >
        <FileText className="w-4 h-4" /> {label}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><FileText className="w-4 h-4" /></span>
                <h3 className="text-sm font-semibold text-stone-800 flex-1">Usar template salvo</h3>
                <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>

              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
              ) : templates.length === 0 ? (
                <p className="px-2 py-6 text-sm text-stone-500 text-center leading-relaxed">Nenhum template salvo.<br />Crie em <Link to="/templates" className="text-primary-600 underline">Templates</Link>.</p>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Pesquisar template..." autoFocus className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
                  </div>
                  <ul className="space-y-1 min-h-[60px]">
                    {itens.length === 0 && <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>}
                    {itens.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => pick(t)} className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-xl hover:bg-surface-100 text-left transition-colors">
                          <span className="text-sm font-medium text-stone-800 truncate">{t.nome || 'Sem título'}</span>
                          <span className="text-[11px] text-stone-400 line-clamp-2 leading-snug">{t.mensagem}</span>
                        </button>
                      </li>
                    ))}
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

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { auth } from '../lib/firebase'
import { getMessageTemplates } from '../lib/firestore'
import { FileText, Search, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const PAGE_SIZE = 5

// Prévia estilo WhatsApp (variáveis com exemplo + formatação)
const SAMPLE = { nome_cliente: 'João', numero_cliente: '+55 11 99999-9999', email_cliente: 'joao@email.com', nome_produto: 'Gekko Pan' }
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function renderWhatsapp(text) {
  let t = escapeHtml(text || '')
  t = t
    .replace(/\{nome_cliente\}/gi, SAMPLE.nome_cliente)
    .replace(/\{numero_cliente\}/gi, SAMPLE.numero_cliente)
    .replace(/\{email_cliente\}/gi, SAMPLE.email_cliente)
    .replace(/\{nome_produto\}/gi, SAMPLE.nome_produto)
  t = t
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~(.+?)~/g, '<del>$1</del>')
    .replace(/\n/g, '<br/>')
  return t
}

/**
 * Botão + popup pra escolher um template de mensagem salvo (copy).
 * Ao escolher, chama onPick(textoDaMensagem).
 */
export default function TemplatePicker({ onPick, label = 'Usar template', className, iconOnly = false }) {
  const [user] = useAuthState(auth)
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [hoverId, setHoverId] = useState(null)

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
      {iconOnly ? (
        <button type="button" onClick={abrir} title={label} className={clsx('p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation', className)}>
          <FileText className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          className={clsx('inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white text-stone-600 hover:text-primary-700 hover:border-primary-200 hover:bg-primary-50/50 text-sm font-medium transition-colors', className)}
        >
          <FileText className="w-4 h-4" /> {label}
        </button>
      )}

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
                      <li
                        key={t.id}
                        className="relative"
                        onMouseEnter={() => setHoverId(t.id)}
                        onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
                      >
                        <button type="button" onClick={() => pick(t)} className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-xl hover:bg-surface-100 text-left transition-colors">
                          <span className="text-sm font-medium text-stone-800 truncate">{t.nome || 'Sem título'}</span>
                          <span className="text-[11px] text-stone-400 line-clamp-2 leading-snug">{t.mensagem}</span>
                        </button>

                        {/* Balão de prévia ao passar o mouse */}
                        <AnimatePresence>
                          {hoverId === t.id && (
                            <motion.div
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -6 }}
                              transition={{ duration: 0.15 }}
                              className="hidden sm:block absolute left-full bottom-0 -ml-16 w-64 z-50 pointer-events-none rounded-xl overflow-hidden bg-white shadow-[0_14px_44px_-6px_rgba(0,0,0,0.5)]"
                            >
                              <div className="px-2.5 py-1.5 bg-[#075E54] text-white text-[10px] font-semibold">Prévia no WhatsApp</div>
                              <div className="p-2.5 bg-[#ece5dd] flex">
                                <div className="max-w-full ml-auto bg-[#d9fdd3] rounded-lg rounded-tr-sm px-2.5 py-1.5 shadow-sm">
                                  <p className="text-[12px] text-stone-800 break-words wa-preview leading-snug line-clamp-[12]" dangerouslySetInnerHTML={{ __html: renderWhatsapp(t.mensagem) }} />
                                  <span className="block text-right text-[9px] text-stone-500 mt-0.5">23:15 ✓✓</span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
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

import { useState, useRef, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Check, Search, X, ChevronLeft, ChevronRight, Package } from 'lucide-react'
import clsx from 'clsx'

const PAGE_SIZE = 5

/** Miniatura do produto (imagem ou caixinha padrão) */
function Thumb({ image, size = 'w-7 h-7' }) {
  if (image) return <img src={image} alt="" className={clsx('rounded-lg object-contain shrink-0', size)} />
  return (
    <span className={clsx('flex items-center justify-center rounded-lg bg-surface-100 text-stone-400 shrink-0', size)}>
      <Package className="w-1/2 h-1/2" />
    </span>
  )
}

/**
 * Select custom que abre um POPUP centralizado com busca e paginação (5 por página).
 *
 * @param {any} value valor selecionado
 * @param {(val:any)=>void} onChange recebe o valor direto (não o evento)
 * @param {{value:any,label:string}[]} options
 * @param {string} [placeholder]
 * @param {string} [className] aplicado no wrapper do gatilho (use pra largura)
 * @param {boolean} [disabled]
 * @param {boolean} [searchable] mostra o campo de busca (default: true)
 * @param {string} [title] título do popup
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Selecione',
  className,
  disabled = false,
  searchable = true,
  title = 'Selecionar',
  withThumb = false,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const inputRef = useRef(null)

  const selected = options.find((o) => String(o.value) === String(value))

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => String(o.label).toLowerCase().includes(t)) : options
  }, [q, options])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [q, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    if (searchable) setTimeout(() => inputRef.current?.focus(), 60)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, searchable])

  const pick = (val) => { onChange?.(val); setOpen(false); setQ('') }

  return (
    <>
      <div className={clsx('relative', className)}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="listbox"
          className={clsx(
            'w-full flex items-center justify-between gap-2 px-3 py-2.5 min-h-[44px] rounded-xl border bg-white text-sm text-left transition-colors',
            disabled
              ? 'border-surface-200 opacity-60 cursor-not-allowed'
              : open
                ? 'border-primary-400 ring-2 ring-primary-500/30'
                : 'border-surface-200 hover:border-primary-300'
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {withThumb && selected && <Thumb image={selected.image} size="w-6 h-6" />}
            <span className={clsx('truncate', selected ? 'text-stone-800' : 'text-stone-400')}>
              {selected ? selected.label : placeholder}
            </span>
          </span>
          <ChevronDown className={clsx('w-4 h-4 text-stone-400 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-3.5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold text-stone-800 flex-1 truncate">{title}</h3>
                <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>

              {searchable && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Pesquisar..."
                    className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400"
                  />
                </div>
              )}

              <ul role="listbox" className="space-y-1 min-h-[60px]">
                {pageItems.length === 0 && (
                  <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>
                )}
                {pageItems.map((o) => {
                  const sel = String(o.value) === String(value)
                  return (
                    <li key={String(o.value)}>
                      <button
                        type="button"
                        onClick={() => pick(o.value)}
                        role="option"
                        aria-selected={sel}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-xl text-sm text-left transition-colors',
                          sel ? 'bg-primary-50 text-primary-700 font-medium ring-1 ring-primary-200' : 'text-stone-700 hover:bg-surface-100'
                        )}
                      >
                        {withThumb && <Thumb image={o.image} />}
                        <span className="flex-1 truncate">{o.label}</span>
                        {sel && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                      </button>
                    </li>
                  )
                })}
              </ul>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-stone-500">Página {pageSafe} de {totalPages} · {filtered.length} opções</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pageSafe <= 1}
                      className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={pageSafe >= totalPages}
                      className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

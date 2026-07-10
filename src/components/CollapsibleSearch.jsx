import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'

/** Lupinha que expande um input inline (sem alterar a altura do header). */
export default function CollapsibleSearch({ value, onChange, placeholder = 'Pesquisar...' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-1 shrink-0">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="s"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '11rem', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
              placeholder={placeholder}
              className="w-44 h-7 px-3 rounded-lg border border-surface-200 text-sm outline-none focus:outline-none focus:ring-0"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => { if (open) onChange(''); setOpen((v) => !v) }}
        title={open ? 'Fechar busca' : 'Buscar'}
        className="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
      >
        {open ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
      </button>
    </div>
  )
}

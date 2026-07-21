import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameDay, isSameMonth, isWithinInterval, isBefore, startOfDay, endOfDay, subDays,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import clsx from 'clsx'

const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/** Filtro de período (calendário + presets) no visual do app. value = {de, ate}(ms) | null. */
export default function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [mes, setMes] = useState(startOfMonth(value?.de ? new Date(value.de) : new Date()))
  const [de, setDe] = useState(value?.de ? new Date(value.de) : null)
  const [ate, setAte] = useState(value?.ate ? new Date(value.ate) : null)

  const abrir = () => {
    setDe(value?.de ? new Date(value.de) : null)
    setAte(value?.ate ? new Date(value.ate) : null)
    setMes(startOfMonth(value?.de ? new Date(value.de) : new Date()))
    setOpen(true)
  }

  const dias = eachDayOfInterval({ start: startOfWeek(startOfMonth(mes)), end: endOfWeek(endOfMonth(mes)) })

  const clickDia = (d) => {
    if (!de || (de && ate)) { setDe(d); setAte(null) }
    else if (isBefore(d, de)) { setAte(de); setDe(d) }
    else setAte(d)
  }
  const aplicar = () => {
    if (de) onChange({ de: startOfDay(de).getTime(), ate: endOfDay(ate || de).getTime() })
    setOpen(false)
  }
  const preset = (v) => {
    if (v === null) { onChange(null); setOpen(false); return }
    const hoje = new Date()
    const d = v === 'mes' ? startOfMonth(hoje) : subDays(startOfDay(hoje), v - 1)
    onChange({ de: startOfDay(d).getTime(), ate: endOfDay(hoje).getTime() })
    setOpen(false)
  }

  const label = value?.de ? `${format(new Date(value.de), 'dd/MM')} – ${format(new Date(value.ate), 'dd/MM')}` : 'Todo o período'

  return (
    <>
      <button type="button" onClick={abrir} title="Filtrar por período" className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:border-primary-300 text-sm text-stone-600 shrink-0 transition-colors">
        <CalendarDays className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
              <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} className="bg-white rounded-2xl shadow-xl w-full max-w-[340px] p-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-stone-800">Filtrar por período</h3>
                  <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {[['Hoje', 1], ['7 dias', 7], ['30 dias', 30], ['Este mês', 'mes'], ['Tudo', null]].map(([lb, v]) => (
                    <button key={lb} onClick={() => preset(v)} className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-200 text-stone-600 hover:border-primary-300 hover:text-primary-600 transition-colors">{lb}</button>
                  ))}
                </div>

                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setMes(addMonths(mes, -1))} className="p-1.5 rounded-lg hover:bg-surface-100 text-stone-500"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="text-sm font-medium text-stone-700 capitalize">{format(mes, 'MMMM yyyy', { locale: ptBR })}</span>
                  <button onClick={() => setMes(addMonths(mes, 1))} className="p-1.5 rounded-lg hover:bg-surface-100 text-stone-500"><ChevronRight className="w-4 h-4" /></button>
                </div>

                <div className="grid grid-cols-7 mb-1">{WD.map((w, i) => <span key={i} className="text-[11px] text-stone-400 text-center py-1">{w}</span>)}</div>
                <div className="grid grid-cols-7 gap-0.5">
                  {dias.map((d, i) => {
                    const foraMes = !isSameMonth(d, mes)
                    const hoje = isSameDay(d, new Date())
                    const isDe = de && isSameDay(d, de)
                    const isAte = ate && isSameDay(d, ate)
                    const dentro = de && ate && isWithinInterval(d, { start: de, end: ate })
                    return (
                      <button key={i} type="button" onClick={() => clickDia(d)}
                        className={clsx('h-9 text-sm rounded-lg transition-colors',
                          foraMes ? 'text-stone-300' : 'text-stone-700',
                          (isDe || isAte) ? 'bg-primary-600 text-white font-semibold shadow-sm' : dentro ? 'bg-primary-50 text-primary-700' : 'hover:bg-surface-100',
                          hoje && !isDe && !isAte && !dentro && 'ring-1 ring-inset ring-primary-300')}>
                        {format(d, 'd')}
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-100">
                  <span className="text-xs text-stone-500 tabular-nums">{de ? format(de, 'dd/MM/yyyy') : '—'}{ate ? ` – ${format(ate, 'dd/MM/yyyy')}` : ''}</span>
                  <button onClick={aplicar} disabled={!de} className="btn-primary text-xs min-h-[36px] px-4 disabled:opacity-50">Aplicar</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

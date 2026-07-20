import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Braces } from 'lucide-react'
import { TEMPLATE_VARIABLES } from '../lib/constants'

/**
 * Botão de "chaves"/variáveis ({nome_cliente}, {nome_produto}…) + popup em portal.
 * @param {(key:string)=>void} onPick
 */
export default function ChavesPicker({ onPick, buttonClassName, title = 'Inserir variável', variables }) {
  const lista = Array.isArray(variables) && variables.length > 0 ? variables : TEMPLATE_VARIABLES
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const W = 280, H = 220
      let left = r.left
      if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
      if (left < 8) left = 8
      const openUp = r.bottom + H > window.innerHeight - 8
      const top = openUp ? r.top - H - 6 : r.bottom + 6
      setPos({ top, left })
    }
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-chaves-pop]')) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} title={title} className={buttonClassName || 'p-2 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50'}>
        <Braces className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <div data-chaves-pop className="fixed z-[80] w-[280px] bg-white rounded-xl shadow-xl border border-surface-200 p-1.5" style={{ top: pos.top, left: pos.left }}>
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">Variáveis</p>
          {lista.map((v) => (
            <button key={v.key} type="button" onClick={() => { onPick(v.key); setOpen(false) }} className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left text-sm hover:bg-surface-50">
              <span className="text-stone-700 whitespace-nowrap">{v.label}</span>
              <span className="text-[11px] font-mono text-stone-400 whitespace-nowrap">{v.key}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Smile } from 'lucide-react'
import clsx from 'clsx'
import { EMOJIS } from '../lib/emojis'

/**
 * Botão de emoji + popup (renderizado em PORTAL, então nunca é cortado por overflow).
 * @param {(emoji:string)=>void} onPick
 */
export default function EmojiPicker({ onPick, buttonClassName, title = 'Emoji' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const W = 296
      const H = 300
      let left = r.left
      if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
      if (left < 8) left = 8
      // abre pra baixo; se não couber, abre pra cima
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
      if (e.target.closest?.('[data-emoji-pop]')) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    // Fecha ao rolar a PÁGINA (popup é fixed), mas ignora rolagem vinda de dentro do próprio popup
    const onScroll = (e) => { if (e.target?.closest?.('[data-emoji-pop]')) return; setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className={buttonClassName || 'p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors'}
      >
        <Smile className="w-4 h-4" />
      </button>

      {open && pos && createPortal(
        <div
          data-emoji-pop
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 296 }}
          className="p-2 rounded-xl bg-white border border-surface-200 shadow-xl grid grid-cols-8 gap-0.5"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onPick?.(e); setOpen(false) }}
              className="text-xl hover:bg-surface-100 rounded-lg p-1 transition-colors"
            >
              {e}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

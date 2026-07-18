import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Envolve um filho (ex.: um badge "Falhou") e mostra um tooltip flutuante vermelho
 * com a mensagem de erro ao passar o mouse. Se `msg` for vazio, só renderiza o filho.
 * Mesmo visual do tooltip de erro das Automações de SMS.
 */
export default function ErroTip({ msg, children }) {
  const [tip, setTip] = useState(null) // { x, y } quando o mouse está em cima
  if (!msg) return children

  const mostrar = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top })
  }

  return (
    <span className="relative inline-flex cursor-help" onMouseEnter={mostrar} onMouseLeave={() => setTip(null)}>
      {children}
      {tip && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', left: tip.x, top: tip.y - 10, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
          className="pointer-events-none w-60 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium leading-snug text-red-700 shadow-xl"
        >
          {msg}
          <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-1 h-2.5 w-2.5 rotate-45 border-b border-r border-red-200 bg-red-50" />
        </div>,
        document.body,
      )}
    </span>
  )
}

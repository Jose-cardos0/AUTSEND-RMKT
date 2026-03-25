import { useState, useRef } from 'react'
import { Bold, Italic, Smile, User } from 'lucide-react'

const EMOJIS = ['😀', '😊', '👍', '❤️', '🔥', '✅', '📱', '💰', '🎉', '⭐', '📢', '👋']

export default function MessageEditor({ value, onChange, placeholder = 'Digite sua mensagem...', showNomeButton = false }) {
  const ref = useRef(null)
  const [showEmojis, setShowEmojis] = useState(false)

  const insertAtCursor = (before, after = '') => {
    const ta = ref.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const text = value || ''
    const selected = text.slice(start, end)
    const newText = text.slice(0, start) + before + selected + after + text.slice(end)
    onChange(newText)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  const addEmoji = (emoji) => {
    const ta = ref.current
    if (!ta) return
    const start = ta.selectionStart
    const text = value || ''
    const newText = text.slice(0, start) + emoji + text.slice(start)
    onChange(newText)
    ta.focus()
    ta.setSelectionRange(start + emoji.length, start + emoji.length)
  }

  return (
    <div className="border border-surface-200 rounded-xl overflow-hidden bg-white shadow-card">
      <div className="flex items-center gap-0.5 px-1 sm:px-2 py-1.5 border-b border-surface-200 bg-surface-50/80 flex-wrap">
        <button
          type="button"
          onClick={() => insertAtCursor('*', '*')}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-200 text-stone-500 hover:text-stone-700 transition-colors touch-manipulation"
          title="Negrito"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => insertAtCursor('_', '_')}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-200 text-stone-500 hover:text-stone-700 transition-colors touch-manipulation"
          title="Itálico"
        >
          <Italic className="w-4 h-4" />
        </button>
        {showNomeButton && (
          <button
            type="button"
            onClick={() => insertAtCursor('{nome}', '')}
            className="flex items-center gap-1 px-2.5 py-2 min-h-[44px] rounded-lg hover:bg-primary-50 text-primary-600 hover:text-primary-700 text-xs font-semibold transition-colors touch-manipulation"
            title="Inserir nome do contato"
          >
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>{'{nome}'}</span>
          </button>
        )}
        <div className="relative ml-auto sm:ml-0">
          <button
            type="button"
            onClick={() => setShowEmojis((s) => !s)}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-200 text-stone-500 hover:text-stone-700 transition-colors touch-manipulation"
            title="Emoji"
          >
            <Smile className="w-4 h-4" />
          </button>
          {showEmojis && (
            <div className="absolute right-0 sm:left-0 top-full mt-1.5 p-2.5 rounded-xl bg-white border border-surface-200 shadow-lg z-10 flex flex-wrap gap-1 w-52 max-w-[calc(100vw-2rem)]">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { addEmoji(e); setShowEmojis(false) }}
                  className="text-xl hover:bg-surface-100 rounded-lg p-1.5 transition-colors"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={5}
        className="w-full p-4 resize-none focus:ring-0 focus:outline-none text-stone-800 placeholder:text-stone-400 text-sm leading-relaxed"
      />
    </div>
  )
}

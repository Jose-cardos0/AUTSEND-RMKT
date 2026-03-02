import { useState, useRef } from 'react'
import { Bold, Italic, Smile } from 'lucide-react'

const EMOJIS = ['😀', '😊', '👍', '❤️', '🔥', '✅', '📱', '💰', '🎉', '⭐', '📢', '👋']

export default function MessageEditor({ value, onChange, placeholder = 'Digite sua mensagem...' }) {
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
    <div className="border border-surface-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-1 p-2 border-b border-surface-200 bg-surface-50">
        <button
          type="button"
          onClick={() => insertAtCursor('*', '*')}
          className="p-2 rounded-lg hover:bg-surface-200 text-gray-600"
          title="Negrito"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => insertAtCursor('_', '_')}
          className="p-2 rounded-lg hover:bg-surface-200 text-gray-600"
          title="Itálico"
        >
          <Italic className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowEmojis((s) => !s)}
            className="p-2 rounded-lg hover:bg-surface-200 text-gray-600"
            title="Emoji"
          >
            <Smile className="w-4 h-4" />
          </button>
          {showEmojis && (
            <div className="absolute left-0 top-full mt-1 p-2 rounded-lg bg-white border border-surface-200 shadow-lg z-10 flex flex-wrap gap-1 w-48">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    addEmoji(e)
                    setShowEmojis(false)
                  }}
                  className="text-xl hover:bg-surface-100 rounded p-1"
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
        className="w-full p-4 resize-none focus:ring-0 focus:outline-none text-gray-800 placeholder:text-gray-400"
      />
    </div>
  )
}

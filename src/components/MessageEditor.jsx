import { useRef, forwardRef, useImperativeHandle } from 'react'
import clsx from 'clsx'
import { Bold, Italic, Strikethrough, Code } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import CheckoutPicker from './CheckoutPicker'
import ChavesPicker from './ChavesPicker'

const MessageEditor = forwardRef(function MessageEditor({
  value,
  onChange,
  placeholder = 'Digite sua mensagem...',
  /** Mostra o botão {} (Braces) que abre a listinha de variáveis ({nome_cliente}, {nome_produto}…) */
  showChaves = false,
  /** Lista custom de variáveis pro botão {} (default = todas). Ex.: disparo só usa nome/número. */
  chavesVars,
  /** Nós extras (ícones) renderizados na barra, ao lado do botão {} de variáveis. */
  toolbarExtra,
  /** Nó extra renderizado entre o botão {} e o emoji (ex.: ícone de template). */
  toolbarBeforeEmoji,
  /** Chips de variáveis na barra (ex.: [{ key: '{nome_cliente}' }]) — legado (SMS) */
  variables,
  /** Mostra o botão "Checkout" na barra (insere link de checkout salvo) */
  showCheckout = false,
  rows = 5,
  textareaClassName = '',
  className = '',
  /** Quando true, o editor preenche altura do pai flex (use com className flex-1 min-h-0 no pai). */
  fillHeight = false,
}, extRef) {
  const ref = useRef(null)

  // Envolve a seleção (negrito/itálico/etc.)
  const insertAtCursor = (before, after = '') => {
    const ta = ref.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const text = value || ''
    const selected = text.slice(start, end)
    onChange(text.slice(0, start) + before + selected + after + text.slice(end))
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + selected.length) }, 0)
  }

  // Insere um texto (emoji, variável, link) na posição do cursor
  const addText = (str) => {
    const ta = ref.current
    if (!ta) { onChange((value || '') + str); return }
    const start = ta.selectionStart
    const text = value || ''
    onChange(text.slice(0, start) + str + text.slice(start))
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + str.length, start + str.length) }, 0)
  }

  useImperativeHandle(extRef, () => ({
    insert: (str) => addText(str),
    focus: () => ref.current?.focus(),
  }))

  const btn = 'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-200 text-stone-500 hover:text-stone-700 transition-colors touch-manipulation'

  return (
    <div
      className={clsx(
        'border border-surface-200/90 rounded-2xl overflow-hidden bg-white/95 shadow-inner shadow-slate-200/40 ring-1 ring-white/80',
        fillHeight && 'flex flex-col min-h-0',
        className
      )}
    >
      <div className="flex items-center gap-0.5 px-1 sm:px-2 py-1.5 border-b border-surface-200/80 bg-gradient-to-r from-surface-50/90 to-primary-50/30 flex-wrap">
        <button type="button" onClick={() => insertAtCursor('*', '*')} className={btn} title="Negrito"><Bold className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertAtCursor('_', '_')} className={btn} title="Itálico"><Italic className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertAtCursor('~', '~')} className={btn} title="Tachado"><Strikethrough className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertAtCursor('```', '```')} className={btn} title="Monoespaçado"><Code className="w-4 h-4" /></button>

        <div className="ml-auto flex items-center gap-0.5">
          {toolbarExtra}
          {showChaves && <ChavesPicker onPick={addText} buttonClassName={btn} variables={chavesVars} />}
          {toolbarBeforeEmoji}
          <EmojiPicker onPick={addText} buttonClassName={btn} />
          {showCheckout && (
            <>
              <div className="w-px h-5 bg-surface-200 mx-0.5" />
              <CheckoutPicker onPick={addText} buttonClassName="flex items-center gap-1.5 px-2.5 py-2 min-h-[40px] rounded-lg text-primary-600 hover:bg-primary-50 text-xs font-semibold transition-colors" />
            </>
          )}
        </div>
      </div>
      {Array.isArray(variables) && variables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 py-1.5 border-b border-surface-200/80 bg-surface-50/40">
          {variables.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => addText(v.key)}
              title={v.label || v.key}
              className="text-[11px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200/70 rounded-full px-2.5 py-1 transition-colors"
            >
              {v.key}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={clsx(
          'w-full p-3 sm:p-4 resize-none focus:ring-0 focus:outline-none text-stone-800 placeholder:text-stone-400 text-sm leading-relaxed',
          fillHeight ? 'min-h-0 flex-1' : 'min-h-[120px]',
          textareaClassName
        )}
      />
    </div>
  )
})

export default MessageEditor

import { createContext, useContext, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

const ConfirmContext = createContext(null)

/**
 * Provider de confirmação via popup custom (NUNCA usar window.confirm/alert no app).
 * Uso: const confirm = useConfirm(); if (!(await confirm({ title, message, confirmLabel, danger }))) return
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)

  const confirm = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        setState({
          title: opts.title || 'Tem certeza?',
          message: opts.message || '',
          confirmLabel: opts.confirmLabel || 'Confirmar',
          cancelLabel: opts.cancelLabel || 'Cancelar',
          danger: opts.danger ?? true,
          resolve,
        })
      }),
    []
  )

  const close = (val) => {
    setState((s) => {
      s?.resolve(val)
      return null
    })
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
            onClick={() => close(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${
                    state.danger ? 'bg-red-100 text-red-600' : 'bg-primary-100 text-primary-600'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-stone-800">{state.title}</h3>
                  {state.message && (
                    <p className="text-sm text-stone-500 mt-1 leading-relaxed">{state.message}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => close(false)} className="btn-secondary min-h-[44px]">
                  {state.cancelLabel}
                </button>
                <button
                  onClick={() => close(true)}
                  className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-xl font-semibold text-white transition-colors ${
                    state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
                  }`}
                >
                  {state.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>')
  return ctx
}

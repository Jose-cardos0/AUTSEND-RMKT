import { useState } from 'react'
import { Mail, Check, X, Server, ChevronDown } from 'lucide-react'

/**
 * Seletor de remetente reutilizável (cards clicáveis, sem <select>).
 * value = remetenteId selecionado (ou null = padrão automático).
 * providers = array de { id, nome, remetentes: [{ id, email, nome }] }.
 */
export default function RemetentePicker({ providers = [], value, onChange, label = 'Remetente' }) {
  const [open, setOpen] = useState(false)

  let selected = null
  let selectedProv = null
  for (const p of providers) {
    const r = (p.remetentes || []).find((x) => x.id === value)
    if (r) { selected = r; selectedProv = p; break }
  }
  const display = selected ? (selected.nome || selected.email) : 'Remetente padrão (automático)'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 bg-white text-left text-sm hover:border-primary-300 transition"
      >
        <Mail className="w-4 h-4 text-primary-500 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {display}
          {selectedProv && <span className="text-stone-400"> · {selectedProv.nome}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Mail className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">Escolher {label.toLowerCase()}</h3>
              <button onClick={() => setOpen(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Padrão automático */}
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className={`w-full flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${!value ? 'border-primary-500 bg-primary-50' : 'border-surface-200 hover:border-primary-200'}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100 text-stone-500 shrink-0"><Mail className="w-4 h-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-stone-800">Remetente padrão</span><span className="block text-[11px] text-stone-400">Usa o 1º provedor automaticamente</span></span>
              {!value && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
            </button>

            {providers.length === 0 && <p className="text-sm text-stone-400 text-center py-3">Nenhum provedor. Configure em Integrações de E-mail.</p>}

            {providers.map((p) => {
              const rems = (p.remetentes || []).filter((r) => r.email)
              if (!rems.length) return null
              return (
                <div key={p.id} className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 flex items-center gap-1.5 pt-1"><Server className="w-3.5 h-3.5" /> {p.nome}</p>
                  {rems.map((r) => {
                    const sel = value === r.id
                    return (
                      <button
                        key={r.id}
                        onClick={() => { onChange(r.id); setOpen(false) }}
                        className={`w-full flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 hover:border-primary-200'}`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${sel ? 'bg-primary-500 text-white' : 'bg-surface-100 text-stone-500'}`}><Mail className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-stone-800 truncate">{r.nome || r.email}</span>
                          {r.nome && <span className="block text-[11px] text-stone-400 truncate">{r.email}</span>}
                        </span>
                        {sel && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

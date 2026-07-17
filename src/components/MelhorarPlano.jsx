import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { usePlano } from '../lib/PlanoContext'
import { PLANOS, PLANO_CHECKOUT, PLANO_ORDEM } from '../lib/plans'
import { SUPPORT_WHATSAPP } from '../lib/constants'
import { X, Check, Sparkles } from 'lucide-react'
import WhatsAppIcon from './WhatsAppIcon'
import foguete from '../assets/foguetes/foguete1.png'

const CARD = {
  inicial: {
    tag: 'Entrada',
    preco: 'R$67',
    features: ['✨ 30 e-mails com IA/mês (construtor)', '2 trackers', 'Banco de Leads, Produtos, Checkouts, Templates', 'WhatsApp ilimitado · 1 instância', '500 e-mails/mês · 1 domínio', '200 SMS/mês (EUA)', 'Construtor, Funil e Métricas de e-mail'],
  },
  padrao: {
    tag: 'Mais popular',
    preco: 'R$147',
    features: ['✨ 100 e-mails com IA/mês (construtor)', '10 trackers', 'Banco de Leads, Produtos, Checkouts, Templates', 'WhatsApp ilimitado · 2 instâncias', '2.500 e-mails/mês · 1 domínio', '500 SMS/mês (EUA)', 'Construtor, Funil e Métricas de e-mail'],
  },
  pro: {
    tag: 'Máximo',
    preco: 'R$197',
    features: ['✨ 200 e-mails com IA/mês (construtor)', '20 trackers', 'Tudo do Padrão, sem travas', 'WhatsApp ilimitado · 4 instâncias', '5.000 e-mails/mês · 2 domínios', '1.000 SMS/mês (EUA)', 'Limites maiores e prioridade'],
  },
}

// Uso controlado (a partir de uma trava de limite): passe `open` + `onClose` e `trigger={false}`.
export default function MelhorarPlano({ className = '', label = 'Melhorar plano', trigger = true, open: openProp, onClose }) {
  const { plano, isAdmin } = usePlano()
  const [openState, setOpenState] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const setOpen = (v) => { if (controlled) { if (!v) onClose?.() } else setOpenState(v) }
  if (isAdmin || plano === 'pro') return null
  // Mostra todos os planos ACIMA do atual (na ordem free → inicial → padrão → pro).
  const idx = PLANO_ORDEM.indexOf(plano)
  const alvos = PLANO_ORDEM.slice(idx < 0 ? 1 : idx + 1)
  if (alvos.length === 0) return null

  return (
    <>
      {trigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={clsx('inline-flex items-center justify-center gap-2 rounded-xl px-3.5 min-h-[42px] text-sm font-semibold text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-md shadow-primary-600/25 hover:brightness-105 transition', className)}
        >
          <Sparkles className="w-4 h-4" /> {label}
        </button>
      )}

      {createPortal(
        <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} className={clsx('bg-white rounded-3xl shadow-2xl w-full p-5 sm:p-6 max-h-[90vh] overflow-y-auto scroll-y-soft', alvos.length >= 3 ? 'max-w-4xl' : 'max-w-2xl')} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-5">
                <img src={foguete} alt="" className="h-10 w-10 object-contain shrink-0" />
                <h3 className="text-lg font-bold text-stone-800">Melhorar plano</h3>
                <button onClick={() => setOpen(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
              </div>

              <div className={clsx('grid gap-3', alvos.length >= 3 ? 'sm:grid-cols-3' : alvos.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1 max-w-sm mx-auto')}>
                {alvos.map((k) => {
                  const isPro = k === 'pro'
                  return (
                    <div key={k} className={clsx('relative rounded-2xl border-2 p-5 flex flex-col', isPro ? 'border-primary-400 bg-gradient-to-b from-primary-50/60 to-white' : 'border-surface-200')}>
                      <span className={clsx('absolute -top-2 right-3 z-10 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm', isPro ? 'bg-primary-100 text-primary-700 border-primary-200' : 'bg-amber-100 text-amber-700 border-amber-200')}>{CARD[k].tag}</span>
                      <span className="text-base font-bold text-stone-800">{PLANOS[k].nome}</span>
                      <div className="mt-1 mb-1">
                        <span className="text-3xl font-extrabold text-stone-800">{CARD[k].preco}</span>
                        <span className="text-sm font-medium text-stone-400">/mês</span>
                      </div>
                      <ul className="space-y-1.5 my-4 flex-1">
                        {CARD[k].features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px] text-stone-600"><Check className={clsx('w-4 h-4 shrink-0 mt-0.5', isPro ? 'text-primary-600' : 'text-emerald-600')} /> <span>{f}</span></li>
                        ))}
                      </ul>
                      <a href={PLANO_CHECKOUT[k]} target="_blank" rel="noreferrer" className={clsx('w-full inline-flex items-center justify-center gap-2 rounded-xl min-h-[46px] text-sm font-semibold transition', isPro ? 'text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-md shadow-primary-600/25 hover:brightness-105' : 'border border-surface-200 text-stone-700 hover:border-primary-300 hover:text-primary-700')}>
                        Assinar {PLANOS[k].nome}
                      </a>
                    </div>
                  )
                })}
              </div>

              {/* Plano Business — horizontal, fala com o suporte no WhatsApp */}
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer"
                className="group mt-3 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl p-4 sm:p-5 bg-gradient-to-br from-stone-900 to-stone-800 text-white shadow-lg"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 shrink-0">
                    <WhatsAppIcon className="w-5 h-5" white />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold">Business</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary-500/90 text-white">Sob medida</span>
                    </div>
                    <p className="text-[13px] text-white/70">Alto volume e limites personalizados. Fale com a gente.</p>
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] px-5 text-sm font-semibold bg-white text-stone-900 group-hover:bg-white/90 transition">
                  <WhatsAppIcon className="w-4 h-4" /> Falar com o suporte
                </span>
              </a>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

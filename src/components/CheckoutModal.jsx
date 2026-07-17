import { createPortal } from 'react-dom'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { X } from 'lucide-react'

// Carrega o Stripe uma única vez. A chave publishable é PÚBLICA por design (feita pra viver no frontend);
// preferimos a env VITE_STRIPE_PK, mas caímos no fallback fixo pra não quebrar se a env não subiu no build.
const PK = import.meta.env.VITE_STRIPE_PK || 'pk_live_51RJDCqLvVsGXtCnTXdtr7H0YwCAlHz5uPUcfq9Np9t94Ys2TV3t66QMOwpDmwR5P1EGHbeWTJ7T9ZmuYXrjbeVBF00W1VRcIb1'
const stripePromise = PK ? loadStripe(PK) : null

/**
 * Modal de pagamento Stripe EMBUTIDO (o cliente paga dentro do app, sem sair).
 * @param {string} clientSecret — vindo do backend (checkout session ui_mode:'embedded')
 * @param {() => void} onComplete — chamado quando o pagamento é concluído
 * @param {() => void} onClose
 */
export default function CheckoutModal({ clientSecret, onComplete, onClose }) {
  // Portal no body: escapa de qualquer ancestral com transform (ex.: framer-motion do "Melhorar plano"),
  // que "prende" elementos fixed e bugava a posição do popup.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-100">
          <h3 className="font-semibold text-stone-800">Pagamento seguro</h3>
          <button onClick={onClose} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 scroll-y-soft">
          {!stripePromise ? (
            <p className="text-sm text-red-600 text-center py-10 px-4">Pagamento não configurado (falta a chave publishable). Avise o suporte.</p>
          ) : (
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

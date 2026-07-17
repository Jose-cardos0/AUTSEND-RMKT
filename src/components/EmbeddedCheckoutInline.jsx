import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'

// Chave publishable (pública por design). Prefere a env; cai no fallback fixo se o build não a tiver.
const PK = import.meta.env.VITE_STRIPE_PK || 'pk_live_51RJDCqLvVsGXtCnTXdtr7H0YwCAlHz5uPUcfq9Np9t94Ys2TV3t66QMOwpDmwR5P1EGHbeWTJ7T9ZmuYXrjbeVBF00W1VRcIb1'
const stripePromise = PK ? loadStripe(PK) : null

/**
 * Checkout Stripe embutido INLINE (renderiza direto onde for colocado — ex.: div que expande abaixo dos planos).
 * @param {string} clientSecret
 * @param {() => void} onComplete
 */
export default function EmbeddedCheckoutInline({ clientSecret, onComplete }) {
  if (!stripePromise) return <p className="text-sm text-red-600 text-center py-6">Pagamento não configurado. Avise o suporte.</p>
  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  )
}

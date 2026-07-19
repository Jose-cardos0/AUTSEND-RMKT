export const SUPPORT_WHATSAPP = '5579988521880'

// WAHA / servidor autsend (WF3 = instâncias, WF1 = envio). Disparo e remarketing usam o MESMO webhook (WF1).
export const WEBHOOK_EVOLUTION = 'https://n8n.autsend.online/webhook/instancia-waha'
export const WEBHOOK_REMARKETING = 'https://n8n.autsend.online/webhook/remarketing'
export const WEBHOOK_MSG_WHATSAPP = 'https://n8n.autsend.online/webhook/remarketing'

export const KIWIFY_EVENTS = [
  { id: 'abandoned_cart', label: 'Carrinho Abandonado', color: 'amber' },
  { id: 'order_status.boleto_issued', label: 'Boleto Emitido', color: 'blue' },
  { id: 'order_status.pix_issued', label: 'Pix Emitido', color: 'cyan' },
  { id: 'order_status.purchase_declined', label: 'Compra Recusada', color: 'red' },
  { id: 'order_status.purchase_approved', label: 'Compra Aprovada', color: 'green' },
  { id: 'order_status.refund', label: 'Reembolso', color: 'orange' },
  { id: 'order_status.chargeback', label: 'Chargeback', color: 'rose' },
  { id: 'subscription_canceled', label: 'Assinatura Cancelada', color: 'gray' },
  { id: 'subscription_overdue', label: 'Assinatura Vencida', color: 'yellow' },
  { id: 'subscription_renewed', label: 'Assinatura Renovada', color: 'emerald' },
]

/** Normaliza apelidos de evento para o id canônico (ex.: order_rejected = Compra Recusada). */
export function canonicalEvento(ev) {
  if (!ev) return ev
  const s = String(ev).toLowerCase()
  if (s === 'order_rejected' || s.includes('reject')) return 'order_status.purchase_declined'
  return ev
}

export const TEMPLATE_VARIABLES = [
  { key: '{nome_cliente}', label: 'Nome do cliente' },
  { key: '{numero_cliente}', label: 'Número do cliente' },
  { key: '{email_cliente}', label: 'E-mail do cliente' },
  { key: '{nome_produto}', label: 'Nome do produto' },
]

// Presets globais de webhook por loja.
// Como o JSON de cada plataforma é sempre o mesmo, já deixamos o setup pronto
// (mapeamento de campos + regras de gatilho). Ao criar um webhook custom dessa
// loja, o app pré-preenche tudo — o user só confere e ativa.
//
// fieldMap  → chaves: nome, email, telefone, produto, produtoId, orderId, valor (ver ROLES no Tracker)
// eventRules → { path, op ('equals'|'contains'|'exists'), value, evento (id KIWIFY_EVENTS), ativo }

export const WEBHOOK_PRESETS = {
  mundpay: {
    fieldMap: {
      nome: 'customer.name',
      email: 'customer.email',
      telefone: 'customer.phone',
      produto: 'offers.0.product.name',
      produtoId: 'offers.0.product.id',
      orderId: 'id',
      // OBS: "amount" vem em CENTAVOS (13251 = R$ 132,51). Usamos o campo já formatado
      // (valor + moeda corretos) pra não inflar o valor. (offer principal; order bump não soma).
      valor: 'offers.0.total_formatted',
    },
    eventRules: [
      { path: 'event_type', op: 'equals', value: 'order.paid', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event_type', op: 'equals', value: 'order.not_authorized', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event_type', op: 'equals', value: 'order.chargeback', evento: 'order_status.chargeback', ativo: true },
      { path: 'event_type', op: 'equals', value: 'order.refunded', evento: 'order_status.refund', ativo: true },
      { path: 'event_type', op: 'contains', value: 'abandoned', evento: 'abandoned_cart', ativo: true },
    ],
  },

  cartpanda: {
    fieldMap: {
      nome: 'order.customer.full_name',
      email: 'order.customer.email',
      telefone: 'order.customer.phone',
      produto: 'order.line_items.0.title',
      produtoId: 'order.line_items.0.product_id',
      orderId: 'order.id',
      valor: 'order.total_price',
    },
    // Campo do gatilho = "event". Segundo a doc oficial, a CartPanda só emite estes eventos de
    // webhook: order.created, order.paid, order.updated, order.refunded (+ product.*).
    // NÃO há evento de recusa nem de carrinho abandonado (abandono é via API REST, não webhook).
    // Chargeback não tem evento próprio → detectamos pelo campo chargeback_received (vem no order.updated).
    eventRules: [
      { path: 'event', op: 'equals', value: 'order.paid', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event', op: 'equals', value: 'order.refunded', evento: 'order_status.refund', ativo: true },
      { path: 'order.chargeback_received', op: 'equals', value: '1', evento: 'order_status.chargeback', ativo: true },
    ],
  },

  kiwify: {
    // Kiwify manda o corpo FLAT (Customer/Product/Commissions no raiz).
    fieldMap: {
      nome: 'Customer.full_name',
      email: 'Customer.email',
      telefone: 'Customer.mobile',
      produto: 'Product.product_name',
      produtoId: 'Product.product_id',
      orderId: 'order_id',
      valor: 'Commissions.charge_amount',
    },
    // Gatilho = webhook_event_type. Obs.: charge_amount vem em CENTAVOS (6790 = R$67,90).
    // Carrinho abandonado NÃO entra aqui: a Kiwify manda um payload totalmente diferente
    // (campos no raiz: name/email/phone/product_name, status:'abandoned'), incompatível com este mapa.
    eventRules: [
      { path: 'webhook_event_type', op: 'equals', value: 'order_approved', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'order_rejected', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'order_refunded', evento: 'order_status.refund', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'chargeback', evento: 'order_status.chargeback', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'pix_created', evento: 'order_status.pix_issued', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'boleto_created', evento: 'order_status.boleto_issued', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'subscription_canceled', evento: 'subscription_canceled', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'subscription_late', evento: 'subscription_overdue', ativo: true },
      { path: 'webhook_event_type', op: 'equals', value: 'subscription_renewed', evento: 'subscription_renewed', ativo: true },
    ],
  },

  hotmart: {
    // Hotmart Webhook 2.0: { event, version, data:{ buyer, product, purchase, ... } }.
    fieldMap: {
      nome: 'data.buyer.name',
      email: 'data.buyer.email',
      telefone: 'data.buyer.checkout_phone',
      produto: 'data.product.name',
      produtoId: 'data.product.id',
      orderId: 'data.purchase.transaction',
      valor: 'data.purchase.price.value',
    },
    // Gatilho = event (MAIÚSCULAS). PURCHASE_CANCELED é o mais próximo de "recusada".
    eventRules: [
      { path: 'event', op: 'equals', value: 'PURCHASE_APPROVED', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event', op: 'equals', value: 'PURCHASE_CANCELED', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event', op: 'equals', value: 'PURCHASE_REFUNDED', evento: 'order_status.refund', ativo: true },
      { path: 'event', op: 'equals', value: 'PURCHASE_CHARGEBACK', evento: 'order_status.chargeback', ativo: true },
      { path: 'event', op: 'equals', value: 'PURCHASE_BILLET_PRINTED', evento: 'order_status.boleto_issued', ativo: true },
      { path: 'event', op: 'equals', value: 'PURCHASE_OUT_OF_SHOPPING_CART', evento: 'abandoned_cart', ativo: true },
      { path: 'event', op: 'equals', value: 'SUBSCRIPTION_CANCELLATION', evento: 'subscription_canceled', ativo: true },
    ],
  },

  digistore24: {
    // Setup via integração "Webhook" do Digistore24 — POST com JSON FLAT (tem tudo, inclusive telefone).
    // Nome vem separado (first_name + last_name); usamos o primeiro nome.
    fieldMap: {
      nome: 'first_name',
      email: 'email',
      telefone: 'phone_no',
      produto: 'product_name',
      produtoId: 'product_id',
      orderId: 'order_id',
      valor: 'amount_brutto',
    },
    // Gatilho = event. Cobrimos os dois formatos possíveis do valor (on_payment / payment) com
    // matches EXATOS, pra não confundir "payment" com "payment_missed". Confirmar com compra real.
    eventRules: [
      { path: 'event', op: 'equals', value: 'on_payment', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event', op: 'equals', value: 'payment', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event', op: 'equals', value: 'on_refund', evento: 'order_status.refund', ativo: true },
      { path: 'event', op: 'equals', value: 'refund', evento: 'order_status.refund', ativo: true },
      { path: 'event', op: 'equals', value: 'on_chargeback', evento: 'order_status.chargeback', ativo: true },
      { path: 'event', op: 'equals', value: 'chargeback', evento: 'order_status.chargeback', ativo: true },
      { path: 'event', op: 'equals', value: 'on_payment_missed', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event', op: 'equals', value: 'payment_missed', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event', op: 'equals', value: 'payment_denial', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event', op: 'equals', value: 'on_rebill_cancelled', evento: 'subscription_canceled', ativo: true },
      { path: 'event', op: 'equals', value: 'rebill_cancelled', evento: 'subscription_canceled', ativo: true },
    ],
  },

  clickbank: {
    // O payload do INS vem CRIPTOGRAFADO (AES-256). O backend descriptografa usando a
    // INS Secret Key do webhook ANTES de aplicar este mapa (campos = estrutura já decifrada).
    fieldMap: {
      nome: 'customer.billing.fullName',
      email: 'customer.billing.email',
      telefone: 'customer.billing.phoneNumber',
      produto: 'lineItems.0.productTitle',
      produtoId: 'lineItems.0.itemNo',
      orderId: 'receipt',
      valor: 'totalOrderAmount',
    },
    // Gatilho = transactionType. Telefone costuma vir vazio (produto digital).
    eventRules: [
      { path: 'transactionType', op: 'equals', value: 'SALE', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'TEST_SALE', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'BILL', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'RFND', evento: 'order_status.refund', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'CGBK', evento: 'order_status.chargeback', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'INSF', evento: 'order_status.chargeback', ativo: true },
      { path: 'transactionType', op: 'equals', value: 'CANCEL-REBILL', evento: 'subscription_canceled', ativo: true },
    ],
  },

  buygoods: {
    // ATENÇÃO: a BuyGoods não publica o schema do webhook de vendedor. Este é um ESQUELETO
    // (melhor palpite) — confirme os nomes reais dos campos com 1 payload de teste capturado
    // (o app salva o payload na seção de teste) e ajuste aqui/na UI.
    fieldMap: {
      nome: 'first_name',
      email: 'email',
      telefone: 'phone',
      produto: 'product_name',
      produtoId: 'product_codename',
      orderId: 'order_id',
      valor: 'amount',
    },
    // Gatilho provável = type (confirmar valores reais).
    eventRules: [
      { path: 'type', op: 'equals', value: 'SALE', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'type', op: 'equals', value: 'REFUND', evento: 'order_status.refund', ativo: true },
      { path: 'type', op: 'equals', value: 'CHARGEBACK', evento: 'order_status.chargeback', ativo: true },
      { path: 'type', op: 'equals', value: 'CANCEL', evento: 'order_status.purchase_declined', ativo: true },
    ],
  },

  hubla: {
    // Hubla Webhook v1 (version "1.0.0"): { type, event: {...} }. Gatilho = top-level "type".
    // OBS: totalAmount vem em REAIS (não centavos).
    fieldMap: {
      nome: 'event.userName',
      email: 'event.userEmail',
      telefone: 'event.userPhone',
      produto: 'event.groupName',
      produtoId: 'event.groupId',
      orderId: 'event.transactionId',
      valor: 'event.totalAmount',
    },
    // PendingSale = aguardando pagamento (pix/boleto) → mapeado como pix (mesmo comportamento de
    // recuperação; boleto pendente também cai aqui). CanceledSale ≈ recusada/cancelada.
    eventRules: [
      { path: 'type', op: 'equals', value: 'NewSale', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'type', op: 'equals', value: 'PendingSale', evento: 'order_status.pix_issued', ativo: true },
      { path: 'type', op: 'equals', value: 'RefundRequested', evento: 'order_status.refund', ativo: true },
      { path: 'type', op: 'equals', value: 'InProtestSale', evento: 'order_status.chargeback', ativo: true },
      { path: 'type', op: 'equals', value: 'AbandonedCheckout', evento: 'abandoned_cart', ativo: true },
      { path: 'type', op: 'equals', value: 'CanceledSubscription', evento: 'subscription_canceled', ativo: true },
      { path: 'type', op: 'equals', value: 'CanceledSale', evento: 'order_status.purchase_declined', ativo: true },
    ],
  },

  kirvano: {
    // Kirvano webhook JSON. Gatilho = "event". OBS: total_price vem como STRING "R$ 297,00".
    fieldMap: {
      nome: 'customer.name',
      email: 'customer.email',
      telefone: 'customer.phone_number',
      produto: 'products.0.name',
      produtoId: 'products.0.id',
      orderId: 'sale_id',
      valor: 'total_price',
    },
    eventRules: [
      { path: 'event', op: 'equals', value: 'SALE_APPROVED', evento: 'order_status.purchase_approved', ativo: true },
      { path: 'event', op: 'equals', value: 'SALE_REFUSED', evento: 'order_status.purchase_declined', ativo: true },
      { path: 'event', op: 'equals', value: 'SALE_REFUNDED', evento: 'order_status.refund', ativo: true },
      { path: 'event', op: 'equals', value: 'SALE_CHARGEBACK', evento: 'order_status.chargeback', ativo: true },
      { path: 'event', op: 'equals', value: 'ABANDONED_CART', evento: 'abandoned_cart', ativo: true },
      { path: 'event', op: 'equals', value: 'PIX_GENERATED', evento: 'order_status.pix_issued', ativo: true },
      { path: 'event', op: 'equals', value: 'BANK_SLIP_GENERATED', evento: 'order_status.boleto_issued', ativo: true },
      { path: 'event', op: 'equals', value: 'SUBSCRIPTION_CANCELED', evento: 'subscription_canceled', ativo: true },
    ],
  },
}

/** Retorna uma cópia profunda do preset da loja (ou null se não houver). */
export function getWebhookPreset(lojaKey) {
  const p = WEBHOOK_PRESETS[lojaKey]
  if (!p) return null
  return {
    fieldMap: { ...p.fieldMap },
    eventRules: p.eventRules.map((r) => ({ ...r })),
  }
}

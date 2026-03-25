const functions = require('firebase-functions')
const admin = require('firebase-admin')
admin.initializeApp()

const db = admin.firestore()

const N8N_REMARKETING_URL = 'https://n8n.iacodenxt.online/webhook/REMARKETING'

/** Eventos que só enviam automação após 5 min, e só se NÃO houver order_approved do mesmo pedido (recuperar quem desistiu de pagar). */
const EVENTOS_RECUPERACAO_ATRASADA = ['order_status.boleto_issued', 'order_status.pix_issued']
const ATRASO_MINUTOS = 2

/** Retorna a config Evolution a usar (instância selecionada ou primeira ou config antiga). */
async function getEvolutionConfigForUser(userId) {
  const configSnap = await db.doc(`users/${userId}/config/evolution`).get()
  const config = configSnap.exists ? configSnap.data() : null
  const selectedId = config?.selectedInstanceId
  if (selectedId) {
    const instSnap = await db.doc(`users/${userId}/instances/${selectedId}`).get()
    if (instSnap.exists) return instSnap.data()
  }
  const instancesSnap = await db.collection(`users/${userId}/instances`).get()
  if (!instancesSnap.empty) {
    const sorted = instancesSnap.docs.sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0))
    return sorted[0].data()
  }
  if (config && (config.nomeInstancia || config.hash)) return config
  return null
}

function extractCustomer(body) {
  const cart = body.cart ?? body.checkout ?? {}
  const customer = body.Customer ?? body.customer ?? cart ?? {}
  const lead = body.Lead ?? body.lead ?? {}
  const checkout = body.checkout ?? body.Checkout ?? cart ?? {}
  const phoneRaw =
    body.customer_phone ?? body.phone_number ?? body.telefone ?? body.phone ?? body.numero ??
    body.mobile ?? cart.phone ?? customer.mobile ?? customer.phone ?? customer.phone_number ?? customer.telefone ??
    lead.phone ?? lead.telefone ?? lead.mobile ?? lead.phone_number ??
    checkout.phone ?? checkout.telefone ?? checkout.customer_phone ?? ''
  return {
    nome: (
      body.customer_name ?? cart.name ?? customer.full_name ?? customer.name ?? body.nome ?? body.name ??
      lead.name ?? lead.nome ?? ''
    ).toString().trim(),
    email: (
      body.customer_email ?? cart.email ?? customer.email ?? body.email ?? lead.email ?? checkout.email ?? ''
    ).toString().trim(),
    telefone: phoneRaw.toString().replace(/\D/g, ''),
  }
}

function extractProduct(body) {
  const cart = body.cart ?? body.checkout ?? {}
  const product = body.Product ?? body.product ?? cart ?? {}
  return {
    nome: product.product_name ?? product.name ?? body.product_name ?? cart.product_name ?? '',
    id: product.product_id ?? product.id ?? body.product_id ?? cart.product_id ?? '',
  }
}

/** ID do pedido/carrinho para vincular eventos e deduplicação. */
function extractOrderId(body) {
  const data = body.data ?? body.payload ?? {}
  const cart = body.cart ?? body.checkout ?? {}
  const id = body.order_id ?? body.orderId ?? body.id ?? body.transaction_id ?? body.purchase_id ?? body.sale_id ?? body.reference ?? body.uuid ?? body.order_number ?? data.order_id ?? data.orderId ?? data.id ?? data.reference ?? cart.id ?? ''
  return (id && String(id).trim()) ? String(id).trim() : ''
}

/** Extrai o evento real. Kiwify pode enviar trigger/triggers, cart.status, ou status direto no body. */
function extractEvent(body) {
  const cart = body.cart ?? body.checkout ?? body.data?.cart ?? body.payload?.cart
  const statusDireto = String(body.status || '').toLowerCase().trim()
  const statusCart = cart && typeof cart === 'object' ? String(cart.status || '').toLowerCase().trim() : ''

  if (statusDireto === 'abandoned' || statusCart === 'abandoned') return 'abandoned_cart'
  if (statusDireto === 'approved' || statusCart === 'approved') return 'order_status.purchase_approved'
  if (statusDireto === 'refused' || statusDireto === 'declined' || statusCart === 'refused' || statusCart === 'declined') return 'order_status.purchase_declined'
  if (statusDireto === 'refunded' || statusCart === 'refunded') return 'order_status.refund'
  if (statusDireto === 'chargedback' || statusCart === 'chargedback') return 'order_status.chargeback'
  if (statusDireto.includes('billet') || statusCart.includes('billet')) return 'order_status.boleto_issued'
  if (statusDireto === 'waiting_payment' || statusCart === 'waiting_payment') {
    if ((body.payment_method || body.cart?.payment_method || '').toLowerCase().includes('boleto')) return 'order_status.boleto_issued'
    if ((body.payment_method || body.cart?.payment_method || '').toLowerCase().includes('pix')) return 'order_status.pix_issued'
  }

  const data = body.data ?? body.payload ?? body
  const eventObj = body.event ?? data.event
  const triggerFromObj = typeof eventObj === 'object' && eventObj !== null ? (eventObj.trigger ?? eventObj.type) : null
  const candidates = [
    body.trigger,
    typeof body.event === 'string' ? body.event : null,
    Array.isArray(body.triggers) && body.triggers[0],
    triggerFromObj,
    body.webhook_event_type,
    body.event_type,
    body.event_name,
    body.tipo_evento,
    body.evento,
    body.order_status,
    data.trigger,
    typeof data.event === 'string' ? data.event : null,
    Array.isArray(data.triggers) && data.triggers[0],
    data.webhook_event_type,
    data.event_type,
    data.event_name,
    data.order_status,
    body.Event,
    data.Event,
  ]
  const raw = candidates.find((v) => v != null && v !== false && String(v).toLowerCase().trim() !== 'false') ?? 'unknown'
  return normalizeEventType(raw)
}

/** Normaliza o tipo de evento da Kiwify para o id usado no app.
 *  Kiwify usa: carrinho_abandonado, boleto_gerado, pix_gerado, compra_aprovada, compra_recusada, compra_reembolsada, etc.
 */
function normalizeEventType(raw) {
  if (raw == null || raw === false) return 'unknown'
  const s = String(raw).toLowerCase().trim().replace(/\s+/g, '_')
  if (!s || s === 'false') return 'unknown'
  if (s === 'abandoned_cart' || s === 'carrinho_abandonado' || s === 'cart_abandoned' || s.includes('carrinho_abandonado') || s.includes('abandoned_cart') || s.includes('abandoned_checkout') || s.includes('checkout_abandoned') || s === 'abandoned') return 'abandoned_cart'
  if (s === 'boleto_gerado' || s.includes('boleto') || s.includes('billet') || s === 'order_status.boleto_issued') return 'order_status.boleto_issued'
  if (s === 'pix_gerado' || s.includes('pix') || s === 'order_status.pix_issued') return 'order_status.pix_issued'
  if (s === 'compra_recusada' || s.includes('purchase_declined') || s.includes('recusad')) return 'order_status.purchase_declined'
  if (s === 'compra_aprovada' || s === 'order_approved' || s.includes('purchase_approved') || s.includes('aprovad')) return 'order_status.purchase_approved'
  if (s === 'compra_reembolsada' || s.includes('refund') || s.includes('reembolso')) return 'order_status.refund'
  if (s.includes('chargeback')) return 'order_status.chargeback'
  if (s === 'subscription_canceled' || s.includes('cancelad')) return 'subscription_canceled'
  if (s === 'subscription_late' || s.includes('subscription_overdue') || s.includes('vencida') || s.includes('late')) return 'subscription_overdue'
  if (s === 'subscription_renewed' || s.includes('subscription_renewed') || s.includes('renovad')) return 'subscription_renewed'
  return s
}

function replaceVariables(template, lead, product) {
  return template
    .replace(/\{nome_cliente\}/gi, lead.nome || '')
    .replace(/\{numero_cliente\}/gi, lead.telefone || '')
    .replace(/\{email_cliente\}/gi, lead.email || '')
    .replace(/\{nome_produto\}/gi, product.nome || '')
}

async function tryAutoSend(userId, leadRef, evento, customer, product) {
  try {
    // Busca todas as automações do evento (não filtra ativo aqui).
    // Se existe regra para o produto exato, ela manda: inativa = não envia (nem cai na global).
    const autoMsgSnap = await db
      .collection('users').doc(userId).collection('autoMessages')
      .where('evento', '==', evento)
      .limit(50)
      .get()

    if (autoMsgSnap.empty) return

    const docs = autoMsgSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const productName = (product.nome || '').trim()
    const productId = (product.id || '').trim()
    const norm = (p) => (p == null ? '' : String(p).trim())

    const exactMatch = docs.find(
      (d) => norm(d.produto) === productName || norm(d.produto) === productId
    )
    const globalMatch = docs.find((d) => !norm(d.produto))

    let autoMsg = null
    if (exactMatch) {
      if (exactMatch.ativo === true) autoMsg = exactMatch
    } else if (globalMatch && globalMatch.ativo === true) {
      autoMsg = globalMatch
    }

    if (!autoMsg) return
    const evolution = await getEvolutionConfigForUser(userId)
    if (!evolution?.nomeInstancia || !customer.telefone) return

    const mensagemFinal = replaceVariables(autoMsg.mensagem || '', customer, product)
    const numeroWhatsApp = (evolution.numeroWhatsapp || evolution.numeroWhatsApp || '').toString().replace(/\D/g, '')

    const payload = {
      tipoAcao: 'enviar_remarketing',
      contatos: [{ nome: customer.nome, telefone: customer.telefone, email: customer.email }],
      mensagem: mensagemFinal,
      nomeInstancia: evolution.nomeInstancia || '',
      hash: evolution.hash || '',
      instanciaId: evolution.instanceId || evolution.hash || '',
      numeroWhatsApp: numeroWhatsApp || undefined,
      evento,
      produto: product.nome || '',
    }

    const n8nRes = await fetch(N8N_REMARKETING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    let body = {}
    try {
      const text = await n8nRes.text()
      if (text && text.trim()) body = JSON.parse(text)
    } catch (_) {}

    const httpOk = n8nRes.ok
    let ok = httpOk
    if (httpOk && body && typeof body === 'object') {
      if (body.success === false || body.enviado === false || body.sent === false) ok = false
      else if (body.success === true || body.enviado === true || body.sent === true || body.ok === true) ok = true
    }

    const statusFinal = ok ? 'enviado' : 'erro'
    const erroMsgFinal = ok ? null : (body.erro || body.error || body.message || `n8n respondeu ${n8nRes.status}`)

    await leadRef.update({
      status: statusFinal,
      erroMsg: erroMsgFinal,
      mensagemEnviada: mensagemFinal,
      enviadoEm: admin.firestore.FieldValue.serverTimestamp(),
    })

    await db.collection('users').doc(userId).collection('messageLogs').add({
      leadId: leadRef.id,
      evento,
      produto: product.nome,
      telefone: customer.telefone,
      nome: customer.nome,
      status: statusFinal,
      erroMsg: erroMsgFinal,
      mensagem: mensagemFinal,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('Erro no auto-send:', err)
    await leadRef.update({ status: 'erro', erroMsg: err.message || 'Erro interno no auto-send' })
  }
}

exports.kiwifyAbandonedCheckout = functions.https.onRequest(async (req, res) => {
  const { webhookId, userId } = req.query
  if (!userId || !webhookId) {
    res.status(400).json({ error: 'userId e webhookId são obrigatórios na query' })
    return
  }

  const webhookRef = db.doc(`users/${userId}/webhooks/${webhookId}`)
  const webhookSnap = await webhookRef.get()
  if (!webhookSnap.exists) {
    res.status(404).json({ error: 'Webhook não encontrado' })
    return
  }

  let body = {}
  if (req.method === 'POST') {
    if (typeof req.body === 'object' && req.body !== null) {
      body = req.body
    } else if (typeof req.rawBody === 'string') {
      try {
        body = JSON.parse(req.rawBody)
      } catch {
        body = {}
      }
    } else if (req.body && typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body)
      } catch {
        body = {}
      }
    }
  }
  const evento = extractEvent(body)
  const customer = extractCustomer(body)
  const product = extractProduct(body)
  const orderId = extractOrderId(body)
  if (evento === 'unknown') {
    console.warn('Kiwify webhook: evento unknown. Body keys:', Object.keys(body).join(', '), '| trigger:', body.trigger, '| event:', body.event, '| triggers:', body.triggers, '| data:', body.data ? Object.keys(body.data) : null)
  }

  // Deduplicação: não criar lead nem enviar de novo se já existe para este pedido/evento (ou mesmo telefone+evento recente)
  let leadRef = null
  if (orderId) {
    const existentes = await db.collection('users').doc(userId).collection('leads')
      .where('orderId', '==', orderId)
      .where('evento', '==', evento)
      .limit(2)
      .get()
    if (!existentes.empty) {
      const qualquer = existentes.docs[0]
      res.status(200).json({ ok: true, evento, skip: 'duplicado_mesmo_pedido', leadId: qualquer.id })
      return
    }
  }
  if (!orderId && customer.telefone) {
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const recentes = await db.collection('users').doc(userId).collection('leads')
      .where('telefone', '==', customer.telefone)
      .where('evento', '==', evento)
      .where('status', '==', 'enviado')
      .limit(20)
      .get()
    const jaEnviadoRecentemente = recentes.docs.some((d) => {
      const createdAt = d.data().createdAt
      return createdAt && (createdAt.toMillis ? createdAt.toMillis() : createdAt) >= duasHorasAtras.getTime()
    })
    if (jaEnviadoRecentemente) {
      res.status(200).json({ ok: true, evento, skip: 'duplicado_telefone_recente' })
      return
    }
  }

  if (!leadRef) {
    const leadData = {
      nome: customer.nome,
      email: customer.email,
      telefone: customer.telefone,
      produto: product.nome,
      produtoId: product.id,
      evento,
      status: 'pendente',
      orderId: orderId || undefined,
      rawPayload: body,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    const newRef = await db.collection('users').doc(userId).collection('leads').add(leadData)
    leadRef = newRef
  }

  if (product.nome || product.id) {
    const prodDocId = product.id || product.nome.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
    if (prodDocId) {
      await db.collection('users').doc(userId).collection('products').doc(prodDocId).set(
        { nome: product.nome, kiwifyId: product.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )
    }
  }

  // Backward compat: also save to abandonedCarts if event matches
  if (evento === 'abandoned_cart' || evento === 'cart_abandoned') {
    await db.collection('users').doc(userId).collection('abandonedCarts').add({
      ...customer,
      name: customer.nome,
      phone: customer.telefone,
      numero: customer.telefone,
      produto: product.nome,
      ...body,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const isRecuperacaoAtrasada = EVENTOS_RECUPERACAO_ATRASADA.includes(evento)

  if (isRecuperacaoAtrasada) {
    let jaTemRecuperacaoPendente = false
    if (orderId) {
      const pendentes = await db.collection('users').doc(userId).collection('pendingRecovery')
        .where('orderId', '==', orderId)
        .where('evento', '==', evento)
        .limit(1)
        .get()
      jaTemRecuperacaoPendente = !pendentes.empty
    }
    if (!jaTemRecuperacaoPendente) {
      const sendAfter = new Date(Date.now() + ATRASO_MINUTOS * 60 * 1000)
      const orderKey = orderId || `lead_${leadRef.id}`
      await db.collection('users').doc(userId).collection('pendingRecovery').add({
        leadId: leadRef.id,
        orderId: orderId || null,
        orderKey,
        evento,
        sendAfter: admin.firestore.Timestamp.fromDate(sendAfter),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  } else {
    let jaEnviadoParaEstePedido = false
    if (orderId) {
      const enviadoSnap = await db.collection('users').doc(userId).collection('leads')
        .where('orderId', '==', orderId)
        .where('evento', '==', evento)
        .where('status', '==', 'enviado')
        .limit(1)
        .get()
      jaEnviadoParaEstePedido = !enviadoSnap.empty
    }
    if (!jaEnviadoParaEstePedido) {
      await tryAutoSend(userId, leadRef, evento, customer, product)
    }
  }

  res.status(200).json({ ok: true, evento, leadId: leadRef.id })
})

/** A cada 1 minuto: processa recuperações atrasadas (PIX/Boleto). Só envia se NÃO existir order_approved do mesmo pedido. */
exports.processarRecuperacaoAtrasada = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now()
    const snapshot = await db.collectionGroup('pendingRecovery')
      .where('sendAfter', '<=', now)
      .limit(100)
      .get()

    if (snapshot.empty) return null

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const userId = doc.ref.path.split('/')[1]
      const { leadId, orderId, orderKey, evento } = data

      let deveEnviar = true
      if (orderId) {
        const aprovadoSnap = await db.collection('users').doc(userId).collection('leads')
          .where('orderId', '==', orderId)
          .where('evento', '==', 'order_status.purchase_approved')
          .limit(1)
          .get()
        if (!aprovadoSnap.empty) deveEnviar = false
      }

      const leadRef = db.collection('users').doc(userId).collection('leads').doc(leadId)
      const leadSnap = await leadRef.get()
      if (!leadSnap.exists) {
        await doc.ref.delete()
        continue
      }

      const lead = leadSnap.data()
      const customer = { nome: lead.nome, email: lead.email, telefone: lead.telefone }
      const product = { nome: lead.produto || '', id: lead.produtoId || '' }

      if (deveEnviar) {
        await tryAutoSend(userId, leadRef, evento, customer, product)
      } else {
        await leadRef.update({ status: 'cancelado_recovery', erroMsg: 'Compra aprovada no prazo; recuperação não enviada' })
      }

      await doc.ref.delete()
    }
    return null
  })

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
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

// ───────────────────────── E-mail (Resend) ─────────────────────────

/** Envia um e-mail via API do Resend. Lança erro com a mensagem do Resend se falhar. */
async function sendEmailViaResend({ apiKey, from, to, subject, html, replyTo, headers, tags }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo || undefined,
      headers: headers || undefined,
      tags: tags || undefined,
    }),
  })
  const text = await res.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
  if (!res.ok) throw new Error(body?.message || body?.error?.message || body?.error || `Resend respondeu ${res.status}`)
  return body
}

/** Lê a config de e-mail (Resend) do usuário. */
async function getEmailConfigForUser(userId) {
  const snap = await db.doc(`users/${userId}/config/email`).get()
  return snap.exists ? snap.data() : null
}

/** Monta o "from" no formato "Nome <email>" (ou só email). */
function montarRemetente(cfg) {
  if (!cfg?.fromEmail) return null
  return cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail
}

/** Envia um e-mail de teste usando a config do usuário autenticado. */
exports.sendTestEmail = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login para enviar o teste.')
  const to = (request.data?.to || '').toString().trim()
  if (!to) throw new HttpsError('invalid-argument', 'Informe um e-mail de destino.')

  const cfg = await getEmailConfigForUser(uid)
  const from = montarRemetente(cfg)
  if (!cfg?.apiKey || !from) {
    throw new HttpsError('failed-precondition', 'Configure a API key do Resend e o remetente antes de testar.')
  }

  const htmlCustom = request.data?.html
  const subject = (request.data?.subject || '').toString().trim() || 'Teste de e-mail — Remarketing'
  const html =
    typeof htmlCustom === 'string' && htmlCustom.trim()
      ? htmlCustom
      : '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
        '<h2 style="color:#5b5eeb;margin:0 0 12px">Funcionou! 🎉</h2>' +
        '<p style="color:#333;font-size:15px;line-height:1.5">Sua integração com o Resend está ativa. Este é um e-mail de teste enviado pelo app de Remarketing.</p>' +
        '</div>'

  try {
    const r = await sendEmailViaResend({ apiKey: cfg.apiKey, from, to, subject, html })
    return { ok: true, id: r?.id || null }
  } catch (err) {
    throw new HttpsError('internal', err.message || 'Falha ao enviar o e-mail de teste.')
  }
})

/** Disparo em massa: envia um template para uma lista, em lotes de 100 (batch do Resend). */
exports.sendBulkEmail = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')

  const data = request.data || {}
  const templateId = data.templateId
  const recipients = Array.isArray(data.recipients) ? data.recipients : []
  if (!templateId) throw new HttpsError('invalid-argument', 'Escolha um template.')
  if (recipients.length === 0) throw new HttpsError('invalid-argument', 'Nenhum destinatário na lista.')

  const cfg = await getEmailConfigForUser(uid)
  const from = montarRemetente(cfg)
  if (!cfg?.apiKey || !from) throw new HttpsError('failed-precondition', 'Configure o Resend nas Integrações de E-mail.')

  const tplSnap = await db.doc(`users/${uid}/emailTemplates/${templateId}`).get()
  if (!tplSnap.exists) throw new HttpsError('not-found', 'Template não encontrado.')
  const tpl = tplSnap.data()
  const baseHtml = tpl.inlined || tpl.html || ''
  const baseSubject = (data.subject || tpl.subject || 'Novidade').toString()
  const unsub = cfg.fromEmail
  const footer =
    '<div style="font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;padding:16px">' +
    `You received this email because you interacted with our store. <a href="mailto:${unsub}?subject=Unsubscribe" style="color:#999">Unsubscribe</a>` +
    '</div>'

  const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
  const items = recipients
    .filter((r) => r && emailValido(r.email))
    .slice(0, 5000)
    .map((r) => {
      const lead = { nome: r.nome || '', email: String(r.email).trim(), telefone: '' }
      const product = { nome: r.produto || '' }
      return {
        from,
        to: [lead.email],
        subject: replaceVariables(baseSubject, lead, product),
        html: replaceVariables(baseHtml, lead, product) + footer,
        headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Unsubscribe>` },
      }
    })

  if (items.length === 0) throw new HttpsError('invalid-argument', 'Nenhum e-mail válido na lista.')

  // Cria o disparo antes para carimbar (tag) cada e-mail e correlacionar aberturas/cliques
  const dispRef = await db.collection('users').doc(uid).collection('emailDisparos').add({
    nomeDisparo: (data.nomeDisparo || 'Disparo').toString(),
    templateId,
    templateNome: tpl.nome || '',
    subject: baseSubject,
    total: items.length,
    enviados: 0,
    erros: 0,
    aberturas: 0,
    cliques: 0,
    status: 'enviando',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  items.forEach((it) => { it.tags = [{ name: 'disparoId', value: dispRef.id }, { name: 'tipo', value: 'disparo' }] })

  let enviados = 0
  let erros = 0
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (res.ok) enviados += chunk.length
      else { erros += chunk.length; console.error('Batch erro', res.status, await res.text()) }
    } catch (err) {
      erros += chunk.length
      console.error('Batch fetch erro', err)
    }
  }

  await dispRef.update({
    enviados,
    erros,
    status: erros === 0 ? 'enviado' : (enviados === 0 ? 'erro' : 'parcial'),
  })

  return { ok: true, enviados, erros, total: items.length, disparoId: dispRef.id }
})

/**
 * Recebe eventos do Resend (aberturas, cliques, entregas, bounces).
 * O usuário configura o webhook no Resend apontando para esta URL com ?userId=SEU_UID.
 */
exports.resendWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  const { userId } = req.query
  if (!userId) { res.status(400).json({ error: 'userId obrigatório na query' }); return }

  const body = parseRequestBody(req)
  const type = String(body.type || body.event || '')
  const d = body.data || {}
  const emailTo = Array.isArray(d.to) ? d.to[0] : (d.to || '')
  const tags = Array.isArray(d.tags) ? d.tags : []
  const tagMap = {}
  tags.forEach((t) => { if (t && t.name) tagMap[t.name] = t.value })
  const link = d.click?.link || d.link || null
  const evento = type.replace('email.', '')

  try {
    await db.collection('users').doc(userId).collection('emailEvents').add({
      tipo: evento,
      email: emailTo,
      link: link || null,
      disparoId: tagMap.disparoId || null,
      leadId: tagMap.leadId || null,
      emailId: d.email_id || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Agrega no disparo (contagem de eventos)
    if (tagMap.disparoId && (type === 'email.opened' || type === 'email.clicked')) {
      const campo = type === 'email.opened' ? 'aberturas' : 'cliques'
      await db.collection('users').doc(userId).collection('emailDisparos').doc(tagMap.disparoId).set(
        { [campo]: admin.firestore.FieldValue.increment(1) }, { merge: true }
      )
    }
  } catch (err) {
    console.error('Erro ao processar evento Resend:', err)
  }

  res.status(200).json({ ok: true })
})

// ───────────────────────── Webhook Custom (qualquer plataforma) ─────────────────────────

/** Lê um valor por caminho tipo "a.b.0.c" de um objeto/array. */
function getByPath(obj, path) {
  if (!path || typeof path !== 'string') return undefined
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

/** Avalia as regras de gatilho e retorna o primeiro evento que casar (ou null). */
function resolveEventoCustom(eventRules, body) {
  if (!Array.isArray(eventRules)) return null
  for (const rule of eventRules) {
    if (!rule || rule.ativo === false || !rule.evento) continue
    const op = rule.op || 'equals'
    const atual = getByPath(body, rule.path)
    if (op === 'exists') {
      if (atual !== undefined && atual !== null && atual !== '') return rule.evento
      continue
    }
    const alvo = String(rule.value ?? '').toLowerCase().trim()
    const valor = String(atual ?? '').toLowerCase().trim()
    if (op === 'equals' && valor === alvo) return rule.evento
    if (op === 'contains' && alvo && valor.includes(alvo)) return rule.evento
  }
  return null
}

/** Parse robusto do body (JSON) de um request, cobrindo object/Buffer/string. */
function parseRequestBody(req) {
  if (req.method !== 'POST') return {}
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  let raw = null
  if (Buffer.isBuffer(req.rawBody)) raw = req.rawBody.toString('utf8')
  else if (typeof req.rawBody === 'string') raw = req.rawBody
  else if (typeof req.body === 'string') raw = req.body
  if (raw) { try { return JSON.parse(raw) } catch { return {} } }
  return {}
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

/**
 * Envia o e-mail automático configurado para o evento (Automações de E-mail).
 * Só dispara se houver automação ativa com template para aquele evento e o lead tiver e-mail.
 */
async function tryAutoSendEmail(userId, leadRef, evento, customer, product) {
  try {
    if (!customer.email) return
    const autoSnap = await db.doc(`users/${userId}/emailAutomations/${evento}`).get()
    const auto = autoSnap.exists ? autoSnap.data() : null
    if (!auto || auto.ativo !== true || !auto.templateId) return

    const tplSnap = await db.doc(`users/${userId}/emailTemplates/${auto.templateId}`).get()
    if (!tplSnap.exists) return
    const tpl = tplSnap.data()

    const cfg = await getEmailConfigForUser(userId)
    const from = montarRemetente(cfg)
    if (!cfg?.apiKey || !from) return

    const htmlBase = tpl.inlined || tpl.html || ''
    const subjectBase = auto.subject || tpl.subject || 'Novidade sobre seu pedido'
    const html = replaceVariables(htmlBase, customer, product)
    const subject = replaceVariables(subjectBase, customer, product)

    // Rodapé de descadastro + header List-Unsubscribe (boas práticas anti-spam / regras do Gmail)
    const unsub = cfg.fromEmail
    const footer =
      '<div style="font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;padding:16px">' +
      `Você recebeu este e-mail porque interagiu com nossa loja. <a href="mailto:${unsub}?subject=Descadastrar" style="color:#999">Descadastrar</a>` +
      '</div>'

    let ok = true
    let erroMsg = null
    let emailId = null
    try {
      const r = await sendEmailViaResend({
        apiKey: cfg.apiKey,
        from,
        to: customer.email,
        subject,
        html: html + footer,
        headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Descadastrar>` },
        tags: [{ name: 'leadId', value: leadRef.id }, { name: 'tipo', value: 'automacao' }],
      })
      emailId = r?.id || null
    } catch (err) {
      ok = false
      erroMsg = err.message || 'Falha no envio do e-mail'
    }

    await leadRef.update({
      status: ok ? 'enviado' : 'erro',
      erroMsg: ok ? null : erroMsg,
      canal: 'email',
      enviadoEm: admin.firestore.FieldValue.serverTimestamp(),
    })

    await db.collection('users').doc(userId).collection('emailLogs').add({
      leadId: leadRef.id,
      evento,
      produto: product.nome || '',
      email: customer.email,
      nome: customer.nome || '',
      templateId: auto.templateId,
      subject,
      status: ok ? 'enviado' : 'erro',
      erroMsg,
      emailId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('Erro no auto-send de e-mail:', err)
  }
}

/** Dispara as ações automáticas do evento: WhatsApp e/ou E-mail (cada uma só se configurada e ativa). */
async function dispararAcoes(userId, leadRef, evento, customer, product) {
  await tryAutoSend(userId, leadRef, evento, customer, product)
  await tryAutoSendEmail(userId, leadRef, evento, customer, product)
}

// ───────────────────────── Funil de e-mail: helpers ─────────────────────────
function acharNode(funnel, id) { return (funnel.nodes || []).find((n) => n.id === id) }
function nodeInicio(funnel) { return (funnel.nodes || []).find((n) => n.type === 'inicio') }
function proximoNode(funnel, nodeId, handle) {
  const e = (funnel.edges || []).find((ed) => ed.source === nodeId && (handle ? ed.sourceHandle === handle : !ed.sourceHandle))
  return e ? e.target : null
}

/** Envia um template de funil para um contato (com tags de funil para o rastreamento). */
async function enviarTemplateFunil(userId, templateId, contato, tags) {
  try {
    if (!contato?.email || !templateId) return false
    const cfg = await getEmailConfigForUser(userId)
    const from = montarRemetente(cfg)
    if (!cfg?.apiKey || !from) return false
    const tplSnap = await db.doc(`users/${userId}/emailTemplates/${templateId}`).get()
    if (!tplSnap.exists) return false
    const tpl = tplSnap.data()
    const lead = { nome: contato.nome || '', email: contato.email, telefone: '' }
    const product = { nome: contato.produto || '' }
    const unsub = cfg.fromEmail
    const footer = '<div style="font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;padding:16px">' +
      `You received this email because you interacted with our store. <a href="mailto:${unsub}?subject=Unsubscribe" style="color:#999">Unsubscribe</a></div>`
    const html = replaceVariables(tpl.inlined || tpl.html || '', lead, product) + footer
    const subject = replaceVariables(tpl.subject || 'Novidade', lead, product)
    await sendEmailViaResend({ apiKey: cfg.apiKey, from, to: contato.email, subject, html, headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Unsubscribe>` }, tags })
    return true
  } catch (err) { console.error('enviarTemplateFunil', err); return false }
}

/** Cria o funnelRun no primeiro passo após o Início. */
async function inscreverNoFunil(userId, funnelId, funnel, contato) {
  const inicio = nodeInicio(funnel)
  const primeiro = inicio ? proximoNode(funnel, inicio.id) : null
  if (!primeiro || !contato?.email) return false
  await db.collection('users').doc(userId).collection('funnelRuns').add({
    funnelId,
    contato: { email: contato.email, nome: contato.nome || '', produto: contato.produto || '' },
    currentNodeId: primeiro,
    status: 'ativo',
    nextRunAt: admin.firestore.Timestamp.now(),
    enteredAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return true
}

exports.kiwifyAbandonedCheckout = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
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
      await dispararAcoes(userId, leadRef, evento, customer, product)
    }
  }

  res.status(200).json({ ok: true, evento, leadId: leadRef.id })
  },
)

/** A cada 1 minuto: processa recuperações atrasadas (PIX/Boleto). Só envia se NÃO existir order_approved do mesmo pedido. */
exports.processarRecuperacaoAtrasada = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
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
        await dispararAcoes(userId, leadRef, evento, customer, product)
      } else {
        await leadRef.update({ status: 'cancelado_recovery', erroMsg: 'Compra aprovada no prazo; recuperação não enviada' })
      }

      await doc.ref.delete()
    }
    return null
  },
)

/**
 * Webhook genérico para QUALQUER plataforma.
 * - status !== 'active' (teste): apenas captura o payload cru em `samples` (para o usuário mapear na tela Tracker).
 * - status === 'active': aplica fieldMap (caminhos JSON) + eventRules e cria o lead / dispara a ação.
 */
exports.customWebhook = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
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
    const webhook = webhookSnap.data()
    const body = parseRequestBody(req)
    const status = webhook.status || 'testing'

    // Sempre guarda o payload recebido (últimos 10). Serve para mapear (teste) E para
    // inspecionar os eventos reais mais recentes (ativo).
    await webhookRef.collection('samples').add({
      rawPayload: body,
      contentType: req.headers['content-type'] || '',
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    try {
      const antigas = await webhookRef.collection('samples').orderBy('receivedAt', 'desc').offset(10).get()
      for (const d of antigas.docs) await d.ref.delete()
    } catch (_) {}

    // ── MODO TESTE: apenas captura (não cria lead nem dispara) ──
    if (status !== 'active') {
      res.status(200).json({ ok: true, mode: 'teste', captured: true })
      return
    }

    // ── MODO ATIVO: aplica o mapeamento e as regras ──
    const fieldMap = webhook.fieldMap || {}
    const customer = {
      nome: String(getByPath(body, fieldMap.nome) ?? '').trim(),
      email: String(getByPath(body, fieldMap.email) ?? '').trim(),
      telefone: String(getByPath(body, fieldMap.telefone) ?? '').replace(/\D/g, ''),
    }
    const product = {
      nome: String(getByPath(body, fieldMap.produto) ?? '').trim(),
      id: String(getByPath(body, fieldMap.produtoId) ?? '').trim(),
    }
    const orderId = fieldMap.orderId ? String(getByPath(body, fieldMap.orderId) ?? '').trim() : ''
    const valor = fieldMap.valor ? String(getByPath(body, fieldMap.valor) ?? '').trim() : ''
    const moeda = String(body.currency || body.moeda || body.currency_code || '').trim()
    const evento = resolveEventoCustom(webhook.eventRules, body)

    if (!evento) {
      res.status(200).json({ ok: true, skip: 'nenhuma_regra_casou' })
      return
    }

    // Dedup por pedido/evento (mesma lógica da Kiwify)
    if (orderId) {
      const existentes = await db.collection('users').doc(userId).collection('leads')
        .where('orderId', '==', orderId).where('evento', '==', evento).limit(1).get()
      if (!existentes.empty) {
        res.status(200).json({ ok: true, evento, skip: 'duplicado_mesmo_pedido', leadId: existentes.docs[0].id })
        return
      }
    }

    const leadRef = await db.collection('users').doc(userId).collection('leads').add({
      nome: customer.nome,
      email: customer.email,
      telefone: customer.telefone,
      produto: product.nome,
      produtoId: product.id,
      valor: valor || undefined,
      moeda: moeda || undefined,
      evento,
      status: 'pendente',
      orderId: orderId || undefined,
      origem: 'custom',
      webhookId,
      rawPayload: body,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    if (product.nome || product.id) {
      const prodDocId = product.id || product.nome.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
      if (prodDocId) {
        await db.collection('users').doc(userId).collection('products').doc(prodDocId).set(
          { nome: product.nome, kiwifyId: product.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        )
      }
    }

    await dispararAcoes(userId, leadRef, evento, customer, product)

    // Inscreve o contato em funis cujo gatilho é este evento
    if (customer.email) {
      try {
        const funisSnap = await db.collection('users').doc(userId).collection('emailFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        for (const fdoc of funisSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true) continue
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, nome: customer.nome, produto: product.nome })
        }
      } catch (err) { console.error('Erro ao inscrever em funil:', err) }
    }

    res.status(200).json({ ok: true, evento, leadId: leadRef.id })
  },
)

// ───────────────────────── Funil de e-mail: inscrição manual + motor ─────────────────────────

/** Inscreve uma lista manualmente num funil. */
exports.enrollFunnel = onCall({ region: 'us-central1', timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const { funnelId, recipients } = request.data || {}
  if (!funnelId) throw new HttpsError('invalid-argument', 'Escolha um funil.')
  const fs = await db.doc(`users/${uid}/emailFunnels/${funnelId}`).get()
  if (!fs.exists) throw new HttpsError('not-found', 'Funil não encontrado.')
  const funnel = fs.data()
  const inicio = nodeInicio(funnel)
  const primeiro = inicio ? proximoNode(funnel, inicio.id) : null
  if (!primeiro) throw new HttpsError('failed-precondition', 'O funil não tem passos após o Início.')
  const valido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
  const lista = (Array.isArray(recipients) ? recipients : []).filter((r) => r && valido(r.email)).slice(0, 2000)
  let n = 0
  for (const r of lista) {
    await inscreverNoFunil(uid, funnelId, funnel, { email: String(r.email).trim(), nome: r.nome || '' })
    n++
  }
  return { ok: true, inscritos: n }
})

/** A cada 1 minuto: avança cada contato pelos nós do funil. */
exports.processarFunis = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'America/Sao_Paulo', region: 'us-central1', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const snap = await db.collectionGroup('funnelRuns').where('status', '==', 'ativo').where('nextRunAt', '<=', now).limit(200).get()
    if (snap.empty) return null
    const cache = {}
    for (const runDoc of snap.docs) {
      const run = runDoc.data()
      const userId = runDoc.ref.path.split('/')[1]
      try { await processarFunnelRun(userId, runDoc.ref, run, cache) }
      catch (err) { console.error('processarFunnelRun', err) }
    }
    return null
  },
)

async function processarFunnelRun(userId, runRef, run, cache) {
  const key = `${userId}/${run.funnelId}`
  if (!(key in cache)) {
    const fs = await db.doc(`users/${userId}/emailFunnels/${run.funnelId}`).get()
    cache[key] = fs.exists ? fs.data() : null
  }
  const funnel = cache[key]
  if (!funnel) { await runRef.update({ status: 'cancelado' }); return }

  let nodeId = run.currentNodeId
  for (let step = 0; step < 25; step++) {
    if (!nodeId) { await runRef.update({ status: 'concluido' }); return }
    const node = acharNode(funnel, nodeId)
    if (!node) { await runRef.update({ status: 'concluido' }); return }

    if (node.type === 'inicio') { nodeId = proximoNode(funnel, nodeId); continue }

    if (node.type === 'enviar') {
      if (node.data?.templateId) {
        await enviarTemplateFunil(userId, node.data.templateId, run.contato, [
          { name: 'funnelId', value: run.funnelId }, { name: 'tipo', value: 'funil' },
        ])
      }
      nodeId = proximoNode(funnel, nodeId)
      continue
    }

    if (node.type === 'esperar') {
      const unidade = node.data?.unidade || 'dias'
      const mult = unidade === 'minutos' ? 60000 : unidade === 'horas' ? 3600000 : 86400000
      const ms = Math.max(1, Number(node.data?.valor || 1)) * mult
      const proximo = proximoNode(funnel, nodeId)
      if (!proximo) { await runRef.update({ status: 'concluido' }); return }
      await runRef.update({ currentNodeId: proximo, nextRunAt: admin.firestore.Timestamp.fromMillis(Date.now() + ms) })
      return
    }

    if (node.type === 'condicao') {
      const tipo = node.data?.evento || 'opened'
      const desde = run.enteredAt?.toMillis ? run.enteredAt.toMillis() : 0
      let ocorreu = false
      try {
        const evSnap = await db.collection('users').doc(userId).collection('emailEvents')
          .where('email', '==', run.contato.email).limit(50).get()
        evSnap.forEach((d) => {
          const v = d.data()
          if (v.tipo === tipo) {
            const t = v.createdAt?.toMillis ? v.createdAt.toMillis() : 0
            if (t >= desde) ocorreu = true
          }
        })
      } catch (_) {}
      nodeId = proximoNode(funnel, nodeId, ocorreu ? 'sim' : 'nao')
      continue
    }

    nodeId = proximoNode(funnel, nodeId)
  }
  await runRef.update({ currentNodeId: nodeId || null, status: nodeId ? 'ativo' : 'concluido', nextRunAt: admin.firestore.Timestamp.now() })
}

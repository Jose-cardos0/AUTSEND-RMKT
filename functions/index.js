const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const crypto = require('crypto')
const admin = require('firebase-admin')
admin.initializeApp()

const db = admin.firestore()

const N8N_REMARKETING_URL = 'https://n8n.iacodenxt.online/webhook/REMARKETING'

// ── Admin (torre de comando) ──
const ADMIN_EMAIL = 'josedeveloperjs@gmail.com'
const STATUS_VALIDOS = ['pending', 'approved', 'paused', 'banned']

/** Só o admin (e-mail verificado) passa. */
function assertAdmin(request) {
  const email = (request.auth?.token?.email || '').toLowerCase()
  if (!request.auth?.uid || email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Acesso restrito ao administrador.')
  }
}

/** Bloqueia envio se o cliente estiver pausado/banido/pendente OU se o kill switch global estiver ligado. */
async function assertTenantAtivo(uid) {
  const [tSnap, gSnap] = await Promise.all([
    db.doc(`tenants/${uid}`).get(),
    db.doc('config/global').get(),
  ])
  if (gSnap.exists && gSnap.data().enviosPausados === true) {
    throw new HttpsError('permission-denied', 'Os envios estão temporariamente pausados pela plataforma.')
  }
  const status = (tSnap.exists && tSnap.data().status) || 'approved' // padrão liberado (não trava contas atuais)
  if (status === 'paused') throw new HttpsError('permission-denied', 'Sua conta está pausada. Fale com o suporte.')
  if (status === 'banned') throw new HttpsError('permission-denied', 'Sua conta foi bloqueada.')
  if (status === 'pending') throw new HttpsError('permission-denied', 'Sua conta ainda não foi aprovada para envios.')
  return tSnap.exists ? tSnap.data() : {}
}

/** Bloqueia envios se o cliente ainda não aceitou o Termo de Uso (admin passa). Reaproveita o tenant se já buscado. */
async function assertTermosAceito(request, tenant) {
  const email = (request.auth?.token?.email || '').toLowerCase()
  if (email === ADMIN_EMAIL) return
  let t = tenant
  if (!t) { const s = await db.doc(`tenants/${request.auth?.uid}`).get(); t = s.exists ? s.data() : {} }
  if (!(t && t.termos && t.termos.aceito === true)) {
    throw new HttpsError('failed-precondition', 'Você precisa aceitar os Termos de Uso antes de enviar.')
  }
}

// Limites por plano (espelho do src/lib/plans.js)
const PLAN_LIMITS = {
  free: { trackers: 1, instancias: 0, emailsMes: 50, smsMes: 0, dominios: 0 },
  inicial: { trackers: 2, instancias: 1, emailsMes: 500, smsMes: 200, dominios: 1 },
  padrao: { trackers: 10, instancias: 2, emailsMes: 2500, smsMes: 500, dominios: 1 },
  pro: { trackers: 20, instancias: 4, emailsMes: 5000, smsMes: 1000, dominios: 2 },
}
function limitesDoTenant(t) {
  const plano = t && PLAN_LIMITS[t.plano] ? t.plano : 'free'
  const ov = (t && t.overrides && t.overrides.limites) || {}
  return { plano, ...PLAN_LIMITS[plano], ...ov }
}
async function emailsEnviadosNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let total = 0
  try {
    const ds = await db.collection(`users/${uid}/emailDisparos`).get()
    ds.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicio.getTime()) total += Number(x.enviados) || 0 })
  } catch (_) {}
  return total
}

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
    if (instSnap.exists && instSnap.data().bloqueadaPorAdmin !== true) return instSnap.data()
  }
  const instancesSnap = await db.collection(`users/${userId}/instances`).get()
  // Ignora instâncias desativadas pelo admin (policiamento).
  const validas = instancesSnap.docs.filter((d) => d.data().bloqueadaPorAdmin !== true)
  if (validas.length) {
    const sorted = validas.sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0))
    return sorted[0].data()
  }
  if (config && (config.nomeInstancia || config.hash) && config.bloqueadaPorAdmin !== true) return config
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

/** Normaliza apelidos de evento para o id canônico (ex.: order_rejected = Compra Recusada). */
function canonicalEvento(ev) {
  if (!ev) return ev
  const s = String(ev).toLowerCase()
  if (s === 'order_rejected' || s.includes('reject')) return 'order_status.purchase_declined'
  return ev
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
// Resend recusa quebras de linha/tabs no assunto — limpa e limita o tamanho.
function limparAssunto(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200) || 'Novidade'
}

async function sendEmailViaResend({ apiKey, from, to, subject, html, replyTo, headers, tags }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject: limparAssunto(subject),
      html,
      text: htmlToText(html),
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

async function getEmailProvidersForUser(userId) {
  const snap = await db.collection('users').doc(userId).collection('emailProviders').get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** API key COMPARTILHADA da plataforma (Fase A) — usada pra enviar dos domínios conectados no app.
 *  Fica só no servidor (env RESEND_SHARED_KEY ou config/resend.apiKey). Nunca vai pro cliente. */
async function getSharedResendKey() {
  if (process.env.RESEND_SHARED_KEY) return process.env.RESEND_SHARED_KEY
  try { const s = await db.doc('config/resend').get(); return s.exists ? (s.data().apiKey || '') : '' } catch { return '' }
}

/** Remetentes de domínios verificados do tenant (Fase A). Enviam pela key compartilhada. */
async function getVerifiedDomainSenders(userId) {
  const key = await getSharedResendKey()
  if (!key) return []
  const snap = await db.collection('users').doc(userId).collection('emailDomains').get()
  const out = []
  snap.docs.forEach((d) => {
    const dm = d.data()
    if (dm.status !== 'verified') return
    ;(dm.senders || []).forEach((r) => {
      if (r && r.email) out.push({ apiKey: key, email: r.email, nome: r.nome || '', remetenteId: r.id, providerId: null, source: 'domain', domainId: d.id })
    })
  })
  return out
}

/** Resolve a config de envio (apiKey + from) a partir de um remetenteId, ou usa o padrão.
 *  Ordem: domínios verificados (Fase A, key compartilhada) → provedores BYO → config antiga.
 *  Retorna um objeto no formato do cfg antigo (apiKey/fromEmail) + campo `from` pronto. */
async function resolverRemetente(userId, remetenteId) {
  const vazio = { apiKey: null, fromEmail: null, fromName: null, from: null, providerId: null, remetenteId: null }
  const montar = (x) => ({
    apiKey: x.apiKey || null,
    fromEmail: x.email,
    fromName: x.nome || '',
    from: x.nome ? `${x.nome} <${x.email}>` : x.email,
    providerId: x.providerId || null,
    remetenteId: x.remetenteId || null,
  })
  const domainSenders = await getVerifiedDomainSenders(userId)
  const providers = await getEmailProvidersForUser(userId)
  const byo = []
  providers.forEach((p) => (p.remetentes || []).forEach((r) => {
    if (r && r.email) byo.push({ apiKey: p.apiKey || null, email: r.email, nome: r.nome || '', remetenteId: r.id, providerId: p.id, source: 'byo' })
  }))
  const todos = [...domainSenders, ...byo]
  if (todos.length) {
    if (remetenteId) { const hit = todos.find((x) => x.remetenteId === remetenteId); if (hit) return montar(hit) }
    return montar(todos[0])
  }
  const cfg = await getEmailConfigForUser(userId)
  if (cfg?.fromEmail) return { apiKey: cfg.apiKey || null, fromEmail: cfg.fromEmail, fromName: cfg.fromName || '', from: montarRemetente(cfg), providerId: null, remetenteId: null }
  return vazio
}

/** Versão texto simples do HTML — melhora a entregabilidade (reduz spam). */
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

/** Guarda email_id → contexto (disparo/lead/funil) para correlacionar eventos do Resend
 *  (o Resend nem sempre reenvia as tags no webhook). */
async function registrarEmailSend(userId, emailId, ctx) {
  if (!emailId || !ctx) return
  const clean = {}
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined && v !== null) clean[k] = v
  if (Object.keys(clean).length === 0) return
  try {
    await db.collection('users').doc(userId).collection('emailSends').doc(emailId).set(
      { ...clean, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
    )
  } catch (_) {}
}

/** Envia um e-mail de teste usando a config do usuário autenticado. */
exports.sendTestEmail = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login para enviar o teste.')
  const to = (request.data?.to || '').toString().trim()
  if (!to) throw new HttpsError('invalid-argument', 'Informe um e-mail de destino.')

  const cfg = await resolverRemetente(uid, request.data?.remetenteId || null)
  const from = cfg.from
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

/** Envio manual: manda um template para um contato/lead específico (com variáveis já substituídas). */
exports.sendTemplateManual = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenantSTM = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenantSTM)
  const ehAdminSTM = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const { templateId, to, nome, produto, leadId, remetenteId } = request.data || {}
  if (!templateId) throw new HttpsError('invalid-argument', 'Escolha um template.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || '').trim())) throw new HttpsError('invalid-argument', 'E-mail inválido.')

  const cfg = await resolverRemetente(uid, remetenteId || null)
  const from = cfg.from
  if (!cfg?.apiKey || !from) throw new HttpsError('failed-precondition', 'Configure o Resend nas Integrações de E-mail.')

  // Pausa de risco só vale pra conta compartilhada (API própria do cliente = Resend dele).
  const sharedKeySTM = await getSharedResendKey()
  if (!ehAdminSTM && !!sharedKeySTM && cfg.apiKey === sharedKeySTM && emailPausadoPorRisco(tenantSTM)) {
    throw new HttpsError('failed-precondition', 'Sua conta está em análise pelo setor de risco. Os envios estão temporariamente pausados.')
  }

  const tplSnap = await db.doc(`users/${uid}/emailTemplates/${templateId}`).get()
  if (!tplSnap.exists) throw new HttpsError('not-found', 'Template não encontrado.')
  const tpl = tplSnap.data()
  const lead = { nome: nome || '', email: String(to).trim(), telefone: '' }
  const product = { nome: produto || '' }
  const unsub = cfg.fromEmail
  const footer = '<div style="font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;padding:16px">' +
    `You received this email because you interacted with our store. <a href="mailto:${unsub}?subject=Unsubscribe" style="color:#999">Unsubscribe</a></div>`
  const html = replaceVariables(tpl.inlined || tpl.html || '', lead, product) + footer
  const subject = replaceVariables(tpl.subject || 'Novidade', lead, product)

  try {
    const r = await sendEmailViaResend({
      apiKey: cfg.apiKey, from: replaceVariables(from, lead, product), to: lead.email, subject, html,
      headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Unsubscribe>` },
      tags: leadId ? [{ name: 'uid', value: uid }, { name: 'leadId', value: leadId }] : [{ name: 'uid', value: uid }],
    })
    if (r?.id && leadId) await registrarEmailSend(uid, r.id, { leadId })
    if (leadId) {
      await db.doc(`users/${uid}/leads/${leadId}`).set(
        { status: 'enviado', canal: 'email', enviadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
      )
    }
    return { ok: true, id: r?.id || null }
  } catch (err) {
    throw new HttpsError('internal', err.message || 'Falha ao enviar.')
  }
})

/** Rodapé de descadastro (anti-spam). */
function unsubFooter(unsub) {
  return '<div style="font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;padding:16px">' +
    `You received this email because you interacted with our store. <a href="mailto:${unsub}?subject=Unsubscribe" style="color:#999">Unsubscribe</a></div>`
}

/** Envia um lote de e-mails (batch do Resend) com variáveis substituídas e tags de disparo. */
async function enviarLoteEmail(uid, ctx, recipients) {
  const valido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
  const items = (recipients || []).filter((r) => r && valido(r.email)).map((r) => {
    const lead = { nome: r.nome || '', email: String(r.email).trim(), telefone: '' }
    const product = { nome: r.produto || '' }
    const htmlBase = replaceVariables(ctx.tplHtml, lead, product)
    return {
      from: replaceVariables(ctx.from, lead, product),
      to: [lead.email],
      subject: limparAssunto(replaceVariables(ctx.subjectBase, lead, product)),
      html: htmlBase + ctx.footer,
      text: htmlToText(htmlBase),
      headers: { 'List-Unsubscribe': `<mailto:${ctx.unsub}?subject=Unsubscribe>` },
      tags: [{ name: 'uid', value: uid }, { name: 'disparoId', value: ctx.disparoId }, { name: 'tipo', value: 'disparo' }],
    }
  })
  let enviados = 0
  let erros = 0
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (res.ok) {
        enviados += chunk.length
        try {
          const respBody = await res.json()
          const ids = (respBody?.data || []).map((x) => x && x.id).filter(Boolean)
          await Promise.all(ids.map((id) => registrarEmailSend(uid, id, { disparoId: ctx.disparoId })))
        } catch (_) {}
      } else {
        erros += chunk.length
        console.error('Lote batch erro', res.status, await res.text())
      }
    } catch (err) {
      erros += chunk.length
      console.error('Lote fetch erro', err)
    }
  }
  return { enviados, erros }
}

/** Disparo em massa: 1º lote na hora, o resto enfileirado em lotes com intervalo (throttle anti-ban). */
exports.sendBulkEmail = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const ehAdminEmail = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL

  const data = request.data || {}
  const templateId = data.templateId
  const recipients = Array.isArray(data.recipients) ? data.recipients : []
  if (!templateId) throw new HttpsError('invalid-argument', 'Escolha um template.')
  if (recipients.length === 0) throw new HttpsError('invalid-argument', 'Nenhum destinatário na lista.')

  const cfg = await resolverRemetente(uid, data.remetenteId || null)
  const from = cfg.from
  if (!cfg?.apiKey || !from) throw new HttpsError('failed-precondition', 'Configure o Resend nas Integrações de E-mail.')

  // Só medimos cota/crédito e aplicamos a pausa de risco quando o envio usa a NOSSA conta Resend
  // (domínio na key compartilhada). Se o cliente usa a API própria dele, é o Resend dele — sem nossos limites.
  const sharedKey = await getSharedResendKey()
  const usaContaCompartilhada = !!sharedKey && cfg.apiKey === sharedKey
  if (usaContaCompartilhada && !ehAdminEmail && emailPausadoPorRisco(tenant)) {
    throw new HttpsError('failed-precondition', 'Sua conta está em análise pelo setor de risco. Os envios estão temporariamente pausados.')
  }

  const tplSnap = await db.doc(`users/${uid}/emailTemplates/${templateId}`).get()
  if (!tplSnap.exists) throw new HttpsError('not-found', 'Template não encontrado.')
  const tpl = tplSnap.data()
  const baseSubject = (data.subject || tpl.subject || 'Novidade').toString()
  const unsub = cfg.fromEmail
  const footer = unsubFooter(unsub)
  const loteSize = Math.max(1, Math.min(500, Number(data.loteSize) || 30))
  const intervaloMin = Math.max(0, Math.min(240, Number(data.intervaloMin) || 5))

  const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
  const validos = recipients
    .filter((r) => r && emailValido(r.email))
    .slice(0, 20000)
    .map((r) => ({ email: String(r.email).trim(), nome: r.nome || '', produto: r.produto || '' }))
  if (validos.length === 0) throw new HttpsError('invalid-argument', 'Nenhum e-mail válido na lista.')

  // Crédito comprado é consumido primeiro; a cota mensal do plano só depois. Só vale pra conta compartilhada.
  const lim = limitesDoTenant(tenant)
  let creditoAConsumir = 0
  if (usaContaCompartilhada && !ehAdminEmail) {
    const creditos = Number(tenant.emailCreditos) || 0
    const quotaUsada = await quotaEmailUsadaNoMes(uid)
    const restanteQuota = Math.max(0, (lim.emailsMes || 0) - quotaUsada)
    const disponivel = creditos + restanteQuota
    if (disponivel <= 0) throw new HttpsError('permission-denied', 'Seu plano não inclui e-mails. Faça upgrade do plano ou recarregue créditos.')
    if (validos.length > disponivel) {
      throw new HttpsError('resource-exhausted', `Limite atingido: ${restanteQuota} da cota do plano + ${creditos} de crédito. Faça upgrade ou recarregue créditos.`)
    }
    creditoAConsumir = Math.min(creditos, validos.length)
  }

  const lotes = []
  for (let i = 0; i < validos.length; i += loteSize) lotes.push(validos.slice(i, i + loteSize))

  const dispRef = await db.collection('users').doc(uid).collection('emailDisparos').add({
    nomeDisparo: (data.nomeDisparo || 'Disparo').toString(),
    templateId,
    templateNome: tpl.nome || '',
    remetenteId: data.remetenteId || null,
    subject: baseSubject,
    total: validos.length,
    enviados: 0,
    erros: 0,
    aberturas: 0,
    cliques: 0,
    loteSize,
    intervaloMin,
    totalLotes: lotes.length,
    creditoConsumido: creditoAConsumir,
    contaPropria: !usaContaCompartilhada, // envio pela API do próprio cliente → não conta na nossa cota
    status: 'enviando',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Reserva os créditos consumidos por este disparo (o que passou da cota mensal).
  if (creditoAConsumir > 0) {
    await db.doc(`tenants/${uid}`).set({ emailCreditos: admin.firestore.FieldValue.increment(-creditoAConsumir) }, { merge: true })
  }

  const ctx = { apiKey: cfg.apiKey, from, tplHtml: tpl.inlined || tpl.html || '', subjectBase: baseSubject, footer, unsub, disparoId: dispRef.id }

  // 1º lote na hora
  const r0 = await enviarLoteEmail(uid, ctx, lotes[0] || [])

  // Demais lotes enfileirados com intervalo
  const intervaloMs = intervaloMin * 60000
  for (let i = 1; i < lotes.length; i++) {
    await dispRef.collection('emailLotes').add({
      disparoId: dispRef.id,
      recipients: lotes[i],
      sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + i * intervaloMs),
      status: 'pendente',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const soUmLote = lotes.length <= 1
  await dispRef.update({
    enviados: r0.enviados,
    erros: r0.erros,
    status: soUmLote ? (r0.erros === 0 ? 'enviado' : (r0.enviados === 0 ? 'erro' : 'parcial')) : 'enviando',
  })

  return { ok: true, total: validos.length, disparoId: dispRef.id, lotes: lotes.length, enviados: r0.enviados }
})

/** A cada 1 min: envia os lotes de disparo que já venceram (throttle por intervalo). */
exports.processarLotesEmail = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'America/Sao_Paulo', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const snap = await db.collectionGroup('emailLotes').where('status', '==', 'pendente').where('sendAfter', '<=', now).limit(30).get()
    if (snap.empty) return null
    const cache = {}
    for (const loteDoc of snap.docs) {
      const lote = loteDoc.data()
      const parts = loteDoc.ref.path.split('/') // users/{uid}/emailDisparos/{dispId}/emailLotes/{loteId}
      const uid = parts[1]
      const dispId = parts[3]
      const key = `${uid}/${dispId}`
      try {
        if (!(key in cache)) {
          const dSnap = await db.doc(`users/${uid}/emailDisparos/${dispId}`).get()
          let tpl = null
          if (dSnap.exists) {
            const dd = dSnap.data()
            const cfg = await resolverRemetente(uid, dd.remetenteId || null)
            const tSnap = await db.doc(`users/${uid}/emailTemplates/${dd.templateId}`).get()
            tpl = tSnap.exists ? tSnap.data() : null
            cache[key] = { disp: dd, cfg, tpl }
          } else cache[key] = null
        }
        const c = cache[key]
        if (!c || !c.cfg?.apiKey || !c.tpl) { await loteDoc.ref.update({ status: 'erro' }); continue }
        const from = c.cfg.from
        const unsub = c.cfg.fromEmail
        const ctx = { apiKey: c.cfg.apiKey, from, tplHtml: c.tpl.inlined || c.tpl.html || '', subjectBase: c.disp.subject || c.tpl.subject || 'Novidade', footer: unsubFooter(unsub), unsub, disparoId: dispId }
        const r = await enviarLoteEmail(uid, ctx, lote.recipients || [])
        await loteDoc.ref.update({ status: r.erros === 0 ? 'enviado' : 'erro' })
        await db.doc(`users/${uid}/emailDisparos/${dispId}`).set({
          enviados: admin.firestore.FieldValue.increment(r.enviados),
          erros: admin.firestore.FieldValue.increment(r.erros),
        }, { merge: true })
        const restantes = await db.collection(`users/${uid}/emailDisparos/${dispId}/emailLotes`).where('status', '==', 'pendente').limit(1).get()
        if (restantes.empty) {
          const dSnap = await db.doc(`users/${uid}/emailDisparos/${dispId}`).get()
          const dd = dSnap.exists ? dSnap.data() : {}
          const status = (dd.erros || 0) === 0 ? 'enviado' : ((dd.enviados || 0) === 0 ? 'erro' : 'parcial')
          await db.doc(`users/${uid}/emailDisparos/${dispId}`).set({ status }, { merge: true })
        }
      } catch (err) {
        console.error('processarLotesEmail', err)
      }
    }
    return null
  },
)

// ───────────────────────── SMS (Telnyx — internacional/EUA) ─────────────────────────
// Regra de negócio: SMS é só internacional (fora do BR). No Brasil o canal é o WhatsApp.
// Ver memória do projeto: sms-telnyx-eua.

/** Config compartilhada da Telnyx (env ou config/telnyx). Fica só no servidor. */
async function getTelnyxConfig() {
  const envKey = process.env.TELNYX_API_KEY
  const envFrom = process.env.TELNYX_FROM
  const envProfile = process.env.TELNYX_MESSAGING_PROFILE_ID
  if (envKey && (envFrom || envProfile)) return { apiKey: envKey, from: envFrom || '', profileId: envProfile || '' }
  try {
    const s = await db.doc('config/telnyx').get()
    if (s.exists) { const d = s.data(); return { apiKey: d.apiKey || envKey || '', from: d.from || envFrom || '', profileId: d.profileId || envProfile || '' } }
  } catch (_) {}
  return { apiKey: envKey || '', from: envFrom || '', profileId: envProfile || '' }
}

/** Número SMS ATIVO do cliente (Fase 2: cada cliente envia do próprio número). Retorna o principal ou null. */
async function getTelnyxNumeroCliente(uid) {
  try {
    const snap = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').get()
    if (snap.empty) return null
    const nums = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const principal = nums.find((n) => n.principal) || nums[0]
    if (!principal?.number) return null
    return { number: principal.number, messagingProfileId: principal.messagingProfileId || '' }
  } catch (_) { return null }
}

/**
 * Provedor Telnyx PRÓPRIO do cliente (BYO — conta Telnyx dele). Retorna o principal ou null.
 * Espelha o modelo de e-mail: se o cliente traz a própria conta, envia por ela (isola nossas contas).
 */
async function getTelnyxProviderCliente(uid) {
  try {
    const snap = await db.collection(`users/${uid}/smsProviders`).get()
    if (snap.empty) return null
    const provs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.apiKey && p.from)
    if (!provs.length) return null
    const principal = provs.find((p) => p.principal) || provs[0]
    return { apiKey: principal.apiKey, from: principal.from, messagingProfileId: principal.messagingProfileId || '' }
  } catch (_) { return null }
}

/** true se o UID é a conta admin (pra background jobs que não têm request.auth). */
async function ehUidAdmin(uid) {
  try { const u = await admin.auth().getUser(uid); return (u.email || '').toLowerCase() === ADMIN_EMAIL } catch (_) { return false }
}

/**
 * Resolve a config de envio de SMS. Cada cliente envia do PRÓPRIO número (isolamento de reputação — Fase 2).
 * Admin usa o número compartilhado da plataforma (TELNYX_FROM/PROFILE_ID). Retorna { cfg } ou { erro }.
 */
async function resolverTelnyxEnvio(uid, ehAdmin, forcar) {
  // forcar: 'api' → só conta própria (BYO) · 'eua' → só nossa conta · null → auto (BYO tem prioridade).
  // 1) Conta Telnyx PRÓPRIA do cliente (BYO). Tem prioridade no auto; obrigatória se forcar==='api'.
  if (forcar !== 'eua') {
    const prov = await getTelnyxProviderCliente(uid)
    if (prov) return { cfg: { apiKey: prov.apiKey, from: prov.from, profileId: prov.messagingProfileId || '' }, propria: true }
    if (forcar === 'api') return { erro: 'Conecte sua conta Telnyx (aba API\'s em SMS → Integração) para enviar por aqui.' }
  }
  // 2) Número comprado na NOSSA conta Telnyx (key compartilhada) — canal EUA.
  const base = await getTelnyxConfig()
  if (!base.apiKey) return { erro: 'O envio de SMS ainda não foi ativado pela plataforma.' }
  const num = await getTelnyxNumeroCliente(uid)
  if (num) return { cfg: { apiKey: base.apiKey, from: num.number, profileId: num.messagingProfileId || base.profileId || '' }, propria: false }
  if (ehAdmin && (base.from || base.profileId)) return { cfg: base, propria: false }
  return { erro: 'Você ainda não tem um número de SMS (EUA). Vá em SMS → Integração e compre um número.' }
}

/** Compra 1 número toll-free na Telnyx (conta da plataforma) e associa ao messaging profile. */
async function comprarNumeroSMSNoTelnyx(numero) {
  const base = await getTelnyxConfig()
  if (!base.apiKey) throw new Error('Telnyx não configurado na plataforma.')
  const orderRes = await fetch('https://api.telnyx.com/v2/number_orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${base.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_numbers: [{ phone_number: numero }], ...(base.profileId ? { messaging_profile_id: base.profileId } : {}) }),
  })
  const orderData = await orderRes.json().catch(() => ({}))
  if (!orderRes.ok) throw new Error(orderData?.errors?.[0]?.detail || orderData?.errors?.[0]?.title || `Falha ao comprar número (HTTP ${orderRes.status})`)
  const order = orderData.data || {}
  const phoneItem = (order.phone_numbers || [])[0] || {}
  const phoneNumberId = phoneItem.id || null
  // Garante que o número está no messaging profile (sem isso não envia SMS)
  if (phoneNumberId && base.profileId) {
    try {
      await fetch(`https://api.telnyx.com/v2/phone_numbers/${phoneNumberId}/messaging`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${base.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_profile_id: base.profileId }),
      })
    } catch (_) { /* segue mesmo assim — dá pra associar depois */ }
  }
  return { orderId: order.id || null, phoneNumberId, messagingProfileId: base.profileId || '' }
}

/** Libera (devolve) um número na Telnyx quando a assinatura dele é cancelada. */
async function liberarNumeroTelnyx(phoneNumberId) {
  if (!phoneNumberId) return
  const base = await getTelnyxConfig()
  if (!base.apiKey) return
  try {
    await fetch(`https://api.telnyx.com/v2/phone_numbers/${phoneNumberId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${base.apiKey}` },
    })
  } catch (e) { console.error('liberarNumeroTelnyx', e?.message || e) }
}

/** Erro da Telnyx que indica bloqueio/spam/restrição (não é falha transitória tipo número inválido). */
function erroIndicaBloqueio(msg) {
  return /block|spam|restrict|not authorized|unauthoriz|suspend|forbidden|violat|10dlc|campaign|throughput exceeded|number.*disabled/i.test(String(msg || ''))
}

// Só marca o chip como restrito após MUITOS bloqueios SEGUIDOS (um envio bem-sucedido zera a contagem).
const LIMITE_BLOQUEIOS_SEGUIDOS = 100

/**
 * Contabiliza o resultado de um lote no número que enviou. Um sucesso zera a sequência de bloqueios;
 * bloqueios seguidos acumulam e só marcam o chip como 'restrito' ao passar do limite.
 */
async function registrarResultadoNumero(uid, fromNumber, sucessos, bloqueios) {
  try {
    if (!uid || !fromNumber) return
    const q = await db.collection(`users/${uid}/smsNumeros`).where('number', '==', fromNumber).limit(1).get()
    if (q.empty) return
    const ref = q.docs[0].ref
    const d = q.docs[0].data()
    if (sucessos > 0) {
      if ((d.bloqueiosSeguidos || 0) !== 0) await ref.set({ bloqueiosSeguidos: 0 }, { merge: true })
      return
    }
    if (bloqueios > 0) {
      const novo = (d.bloqueiosSeguidos || 0) + bloqueios
      const patch = { bloqueiosSeguidos: novo }
      if (novo >= LIMITE_BLOQUEIOS_SEGUIDOS && d.status !== 'restrito' && d.status !== 'banido') {
        patch.status = 'restrito'
        patch.restritoMotivo = `${novo} envios seguidos bloqueados/spam`
        patch.restritoEm = admin.firestore.FieldValue.serverTimestamp()
      }
      await ref.set(patch, { merge: true })
    }
  } catch (_) {}
}

/**
 * Normaliza pra E.164. Por padrão rejeita BR (+55), porque a NOSSA conta Telnyx é internacional/EUA.
 * Com { permitirBR: true } (conta própria do cliente — BYO), aceita qualquer país, inclusive BR.
 */
function normalizarE164(raw, opts) {
  const permitirBR = !!(opts && opts.permitirBR)
  let s = String(raw || '').trim()
  const temMais = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false, motivo: 'vazio' }
  // Se veio com + já é E.164; senão assume DDI na frente. EUA/Canadá com 10 dígitos → prefixa 1.
  if (!temMais && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return { ok: false, motivo: 'brasil' } // nossa conta não atende BR
  if (d.length < 8 || d.length > 15) return { ok: false, motivo: 'tamanho' }
  return { ok: true, e164: '+' + d }
}
/** Compat: internacional (rejeita BR). */
function normalizarE164Internacional(raw) { return normalizarE164(raw, { permitirBR: false }) }

/** Remove acentos (mantém GSM-7 / 160 chars e evita virar UCS-2 de 70). */
function semAcentos(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** SMS já enviados no mês corrente (pra cota do plano). */
async function smsEnviadosNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let total = 0
  try {
    const ds = await db.collection(`users/${uid}/smsDisparos`).get()
    ds.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicio.getTime()) total += Number(x.enviados) || 0 })
  } catch (_) {}
  return total
}

/**
 * SMS pagos pela COTA DO PLANO neste mês (não os que vieram de crédito).
 * Como o crédito é sempre consumido primeiro, a cota = total planejado - crédito consumido, por disparo.
 */
async function quotaSMSUsadaNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let quota = 0
  try {
    const ds = await db.collection(`users/${uid}/smsDisparos`).get()
    ds.forEach((d) => {
      const x = d.data()
      if (x.contaPropria === true) return // envio pela conta Telnyx do próprio cliente não consome nossa cota
      const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0)
      if (cm >= inicio.getTime()) {
        const totalDisp = Number(x.total) || 0
        const credito = Number(x.creditoConsumido) || 0
        quota += Math.max(0, totalDisp - credito)
      }
    })
  } catch (_) {}
  return quota
}

/** Envia 1 SMS via API da Telnyx. Retorna { ok, id } ou lança. */
async function enviarSMSTelnyx(cfg, to, text) {
  const body = { to, text: semAcentos(text).slice(0, 480) }
  if (cfg.profileId) body.messaging_profile_id = cfg.profileId
  if (cfg.from) body.from = cfg.from
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return { ok: true, id: data?.data?.id || null }
}

/** Envia um lote de SMS (sequencial, respeitando ~1 msg/s de TPS das faixas de entrada). */
async function enviarLoteSMS(uid, ctx, recipients) {
  let enviados = 0
  let erros = 0
  let bloqueios = 0
  for (const r of (recipients || [])) {
    const norm = normalizarE164(r.telefone || r.numero || '', { permitirBR: !!ctx.permitirBR })
    if (!norm.ok) { erros++; continue }
    const lead = { nome: r.nome || '', telefone: norm.e164, email: r.email || '' }
    const product = { nome: r.produto || '' }
    const texto = replaceVariables(ctx.mensagem, lead, product)
    try {
      const out = await enviarSMSTelnyx(ctx.cfg, norm.e164, texto)
      enviados++
      try {
        if (out.id) await db.doc(`users/${uid}/smsMensagens/${out.id}`).set({
          disparoId: ctx.disparoId, to: norm.e164, status: 'enviado', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
      } catch (_) {}
    } catch (err) {
      erros++
      if (erroIndicaBloqueio(err?.message)) bloqueios++
      console.error('enviarSMSTelnyx erro', err?.message || err)
    }
  }
  // Acumula bloqueios seguidos no número; um único sucesso zera a contagem.
  await registrarResultadoNumero(uid, ctx.cfg?.from, enviados, bloqueios)
  return { enviados, erros }
}

/** Disparo de SMS em massa: 1º lote na hora, resto enfileirado (throttle por TPS). */
exports.sendBulkSMS = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)

  const data = request.data || {}
  const mensagem = String(data.mensagem || '').trim()
  const recipients = Array.isArray(data.recipients) ? data.recipients : []
  if (!mensagem) throw new HttpsError('invalid-argument', 'Escreva a mensagem do SMS.')
  if (recipients.length === 0) throw new HttpsError('invalid-argument', 'Nenhum destinatário na lista.')

  const ehAdmin = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const canal = data.canal === 'api' ? 'api' : 'eua' // aba do menu: eua = nossa conta · api = conta dele
  const rEnvio = await resolverTelnyxEnvio(uid, ehAdmin, canal)
  if (rEnvio.erro) throw new HttpsError('failed-precondition', rEnvio.erro)
  const cfg = rEnvio.cfg
  // Conta própria (BYO): envia pela conta Telnyx do cliente → aceita qualquer país (inclusive BR) e NÃO consome nossa cota.
  const contaPropria = !!rEnvio.propria

  const validos = []
  let ignoradosBR = 0
  for (const r of recipients.slice(0, 20000)) {
    const norm = normalizarE164(r?.telefone || r?.numero || '', { permitirBR: contaPropria })
    if (norm.ok) validos.push({ telefone: norm.e164, nome: r.nome || '', produto: r.produto || '', email: r.email || '' })
    else if (norm.motivo === 'brasil') ignoradosBR++
  }
  if (validos.length === 0) throw new HttpsError('invalid-argument', contaPropria ? 'Nenhum número válido na lista.' : 'Nenhum número internacional válido na lista. Sua conta compartilhada não atende números do Brasil (+55).')

  // Crédito comprado é SEMPRE consumido primeiro; cota do plano só depois. Só vale pra NOSSA conta (não BYO / não admin).
  const lim = limitesDoTenant(tenant)
  let creditoAConsumir = 0
  if (!ehAdmin && !contaPropria) {
    const creditos = Number(tenant.smsCreditos) || 0
    const quotaUsada = await quotaSMSUsadaNoMes(uid)
    const restanteQuota = Math.max(0, (lim.smsMes || 0) - quotaUsada)
    const disponivel = creditos + restanteQuota
    if (disponivel <= 0) throw new HttpsError('permission-denied', 'Seu plano não inclui SMS. Faça upgrade do plano ou recarregue créditos.')
    if (validos.length > disponivel) {
      throw new HttpsError('resource-exhausted', `Limite atingido: ${restanteQuota} da cota do plano + ${creditos} de crédito. Faça upgrade ou recarregue créditos.`)
    }
    // Crédito primeiro; o resto sai da cota do plano.
    creditoAConsumir = Math.min(creditos, validos.length)
  }

  const loteSize = Math.max(1, Math.min(200, Number(data.loteSize) || 40))
  const intervaloMin = Math.max(1, Math.min(240, Number(data.intervaloMin) || 1))
  const lotes = []
  for (let i = 0; i < validos.length; i += loteSize) lotes.push(validos.slice(i, i + loteSize))

  const dispRef = await db.collection('users').doc(uid).collection('smsDisparos').add({
    nomeDisparo: String(data.nomeDisparo || 'Disparo SMS'),
    mensagem,
    total: validos.length,
    ignoradosBR,
    enviados: 0,
    erros: 0,
    loteSize,
    intervaloMin,
    totalLotes: lotes.length,
    creditoConsumido: creditoAConsumir,
    contaPropria, // envio pela conta Telnyx do próprio cliente (BYO) → não conta na nossa cota
    canal, // 'eua' (nossa conta) | 'api' (conta do cliente)
    status: 'enviando',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Reserva os créditos consumidos por este disparo (o que passou da cota mensal).
  if (creditoAConsumir > 0) {
    await db.doc(`tenants/${uid}`).set({ smsCreditos: admin.firestore.FieldValue.increment(-creditoAConsumir) }, { merge: true })
  }

  const ctx = { cfg, mensagem, disparoId: dispRef.id, permitirBR: contaPropria }
  const r0 = await enviarLoteSMS(uid, ctx, lotes[0] || [])

  const intervaloMs = intervaloMin * 60000
  for (let i = 1; i < lotes.length; i++) {
    await dispRef.collection('smsLotes').add({
      disparoId: dispRef.id,
      recipients: lotes[i],
      sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + i * intervaloMs),
      status: 'pendente',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const soUmLote = lotes.length <= 1
  await dispRef.update({
    enviados: r0.enviados,
    erros: r0.erros,
    status: soUmLote ? (r0.erros === 0 ? 'enviado' : (r0.enviados === 0 ? 'erro' : 'parcial')) : 'enviando',
  })

  return { ok: true, total: validos.length, ignoradosBR, disparoId: dispRef.id, lotes: lotes.length, enviados: r0.enviados }
})

/** Reenvia um SMS individual pra um lead (usado no relatório de Automações de SMS). Loga em smsLogs. */
exports.reenviarSMSLead = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const data = request.data || {}
  const mensagem = String(data.mensagem || '').trim()
  if (!mensagem) throw new HttpsError('invalid-argument', 'Nenhuma automação de SMS configurada para este evento.')
  const ehAdmin = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const canal = data.canal === 'api' ? 'api' : 'eua'
  const rEnvio = await resolverTelnyxEnvio(uid, ehAdmin, canal)
  if (rEnvio.erro) throw new HttpsError('failed-precondition', rEnvio.erro)
  const cfg = rEnvio.cfg
  const contaPropria = !!rEnvio.propria
  const norm = normalizarE164(data.telefone, { permitirBR: contaPropria })
  if (!norm.ok) throw new HttpsError('invalid-argument', norm.motivo === 'brasil' ? 'Sua conta compartilhada não atende números do Brasil (+55).' : 'Número inválido.')
  if (!ehAdmin && !contaPropria) {
    const lim = limitesDoTenant(tenant)
    if (!lim.smsMes || lim.smsMes <= 0) throw new HttpsError('permission-denied', 'Seu plano não inclui SMS. Faça upgrade do plano ou recarregue créditos.')
  }

  const customer = { nome: data.nome || '', telefone: norm.e164, email: data.email || '' }
  const product = { nome: data.produto || '' }
  const texto = replaceVariables(mensagem, customer, product)
  let ok = true
  let erroMsg = null
  try { await enviarSMSTelnyx(cfg, norm.e164, texto) } catch (err) { ok = false; erroMsg = err.message || 'Falha no envio do SMS' }
  await db.collection('users').doc(uid).collection('smsLogs').add({
    leadId: data.leadId || null, evento: data.evento || '', produto: product.nome, telefone: norm.e164, nome: customer.nome, canal,
    status: ok ? 'enviado' : 'erro', erroMsg, mensagem: texto, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  if (!ok) throw new HttpsError('internal', erroMsg || 'Falha ao enviar SMS.')
  return { ok: true }
})

/** A cada 1 min: processa os lotes de SMS que já venceram. */
exports.processarLotesSMS = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'America/Sao_Paulo', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const snap = await db.collectionGroup('smsLotes').where('status', '==', 'pendente').where('sendAfter', '<=', now).limit(20).get()
    if (snap.empty) return null
    const cfgCache = {} // cfg por uid (cada cliente envia do próprio número)
    for (const loteDoc of snap.docs) {
      const lote = loteDoc.data()
      const parts = loteDoc.ref.path.split('/') // users/{uid}/smsDisparos/{dispId}/smsLotes/{loteId}
      const uid = parts[1]
      const dispId = parts[3]
      try {
        const dSnap = await db.doc(`users/${uid}/smsDisparos/${dispId}`).get()
        const dd = dSnap.exists ? dSnap.data() : {}
        const canal = dd.canal === 'api' ? 'api' : 'eua'
        const chave = `${uid}:${canal}`
        if (!cfgCache[chave]) {
          const rEnvio = await resolverTelnyxEnvio(uid, await ehUidAdmin(uid), canal)
          if (rEnvio.erro) { await loteDoc.ref.update({ status: 'erro' }); continue }
          cfgCache[chave] = { cfg: rEnvio.cfg, permitirBR: !!rEnvio.propria }
        }
        const cfg = cfgCache[chave].cfg
        const ctx = { cfg, mensagem: dd.mensagem || '', disparoId: dispId, permitirBR: cfgCache[chave].permitirBR }
        const r = await enviarLoteSMS(uid, ctx, lote.recipients || [])
        await loteDoc.ref.update({ status: r.erros === 0 ? 'enviado' : 'erro' })
        await db.doc(`users/${uid}/smsDisparos/${dispId}`).set({
          enviados: admin.firestore.FieldValue.increment(r.enviados),
          erros: admin.firestore.FieldValue.increment(r.erros),
        }, { merge: true })
        const restantes = await db.collection(`users/${uid}/smsDisparos/${dispId}/smsLotes`).where('status', '==', 'pendente').limit(1).get()
        if (restantes.empty) {
          const dSnap2 = await db.doc(`users/${uid}/smsDisparos/${dispId}`).get()
          const d2 = dSnap2.exists ? dSnap2.data() : {}
          const status = (d2.erros || 0) === 0 ? 'enviado' : ((d2.enviados || 0) === 0 ? 'erro' : 'parcial')
          await db.doc(`users/${uid}/smsDisparos/${dispId}`).set({ status }, { merge: true })
        }
      } catch (err) {
        console.error('processarLotesSMS', err)
      }
    }
    return null
  },
)

/** Webhook de status da Telnyx (entregue/falhou) — atualiza smsMensagens pra métricas. */
exports.telnyxWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    const ev = req.body?.data || {}
    const payload = ev.payload || {}
    const id = payload.id || null
    const tipo = ev.event_type || '' // message.sent | message.finalized | ...
    const status = payload.to?.[0]?.status || payload.status || ''
    const uid = req.query.userId || null
    if (id && uid) {
      await db.doc(`users/${uid}/smsMensagens/${id}`).set({
        status: status || tipo, evento: tipo, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    res.status(200).send('ok')
  } catch (err) {
    console.error('telnyxWebhook', err)
    res.status(200).send('ok')
  }
})

// ───────────────── SMS — Números do cliente (Fase 2: cada cliente compra o próprio número) ─────────────────

/** Busca números toll-free (EUA) disponíveis pra compra na Telnyx. Só leitura — não gasta nada. */
exports.smsBuscarNumeros = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTenantAtivo(uid)
  const base = await getTelnyxConfig()
  if (!base.apiKey) throw new HttpsError('failed-precondition', 'SMS ainda não foi ativado pela plataforma.')
  const url = 'https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[phone_number_type]=toll_free&filter[features][]=sms&filter[limit]=8'
  const res = await fetch(url, { headers: { Authorization: `Bearer ${base.apiKey}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpsError('internal', data?.errors?.[0]?.detail || 'Falha ao buscar números disponíveis.')
  const numeros = (data.data || []).map((n) => ({
    numero: n.phone_number,
    regiao: 'EUA · Toll-Free',
    tipo: 'toll_free',
  }))
  return { numeros }
})

/** Cria o checkout Stripe (assinatura R$29,90/mês por número) pra comprar 1 ou VÁRIOS números. Compra real no webhook, após pagar. */
exports.smsCriarCheckoutNumero = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  // Aceita `numeros` (lista) ou `numero` (único, compat).
  const raw = Array.isArray(request.data?.numeros) ? request.data.numeros : (request.data?.numero ? [request.data.numero] : [])
  const numeros = [...new Set(raw.map((n) => String(n || '').trim()).filter(Boolean))]
  if (!numeros.length) throw new HttpsError('invalid-argument', 'Escolha pelo menos um número.')
  if (numeros.length > 20) throw new HttpsError('invalid-argument', 'Máximo de 20 números por compra.')
  const key = process.env.STRIPE_SECRET_KEY
  const priceNumero = process.env.STRIPE_PRICE_NUMERO_SMS
  if (!key || !priceNumero) throw new HttpsError('failed-precondition', 'A compra de número ainda não foi configurada.')
  const stripe = require('stripe')(key)
  const appUrl = (process.env.APP_URL || 'https://autsend.com.br').replace(/\/+$/, '')
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'numero_sms', uid, numeros: JSON.stringify(numeros) }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceNumero, quantity: numeros.length }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      subscription_data: { metadata: meta },
      success_url: `${appUrl}/sms/integracao?compra=ok`,
      cancel_url: `${appUrl}/sms/integracao?compra=cancelado`,
    })
    return { url: session.url }
  } catch (e) {
    console.error('smsCriarCheckoutNumero', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/** Lista os números SMS do cliente (pra tela de Integração). */
exports.smsListarNumeros = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const snap = await db.collection(`users/${uid}/smsNumeros`).get()
  const numeros = snap.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id, numero: x.number, status: x.status || 'active', principal: !!x.principal,
      erro: x.erro || null, valorMensal: x.valorMensal || 29.9,
      criadoEm: x.createdAt?.toMillis ? x.createdAt.toMillis() : null,
    }
  })
  numeros.sort((a, b) => (Number(b.principal) - Number(a.principal)) || ((a.criadoEm || 0) - (b.criadoEm || 0)))
  return { numeros }
})

/** Serializa os números do cliente pra resposta (mesmo shape de smsListarNumeros). */
async function listarNumerosMapeados(uid) {
  const snap = await db.collection(`users/${uid}/smsNumeros`).get()
  const numeros = snap.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id, numero: x.number, status: x.status || 'active', principal: !!x.principal,
      erro: x.erro || null, restritoMotivo: x.restritoMotivo || null, valorMensal: x.valorMensal || 29.9,
      criadoEm: x.createdAt?.toMillis ? x.createdAt.toMillis() : null,
    }
  })
  numeros.sort((a, b) => (Number(b.principal) - Number(a.principal)) || ((a.criadoEm || 0) - (b.criadoEm || 0)))
  return numeros
}

/**
 * Sincroniza o status dos números com a Telnyx (best-effort): posse do número (não-active = banido)
 * e verificação toll-free (rejeitada = restrito). Não reativa sozinho um número marcado por erro de envio.
 */
exports.smsSincronizarNumeros = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const base = await getTelnyxConfig()
  if (base.apiKey) {
    const snap = await db.collection(`users/${uid}/smsNumeros`).get()
    // Verificações toll-free do cadastro (uma chamada só, best-effort)
    let verifs = []
    try {
      const r = await fetch('https://api.telnyx.com/v2/messaging_tollfree/verification/requests?page[size]=100', { headers: { Authorization: `Bearer ${base.apiKey}` } })
      const j = await r.json()
      verifs = Array.isArray(j?.data) ? j.data : []
    } catch (_) {}
    for (const doc of snap.docs) {
      const d = doc.data()
      if (!d.telnyxPhoneId) continue
      let novo = null
      // 1) posse do número — se saiu de "active", tratamos como banido/perdido
      try {
        const r = await fetch(`https://api.telnyx.com/v2/phone_numbers/${d.telnyxPhoneId}`, { headers: { Authorization: `Bearer ${base.apiKey}` } })
        const j = await r.json()
        const st = j?.data?.status
        if (st && st !== 'active' && st !== 'purchase-pending') novo = 'banido'
      } catch (_) {}
      // 2) verificação toll-free rejeitada → restrito
      if (!novo) {
        const req = verifs.find((x) => (x.phoneNumbers || x.phone_numbers || []).some((p) => (p?.phoneNumber || p?.phone_number || p) === d.number))
        const vs = req?.verificationStatus || req?.status
        if (vs && /reject/i.test(String(vs))) novo = 'restrito'
      }
      if (novo && novo !== d.status) {
        await doc.ref.set({ status: novo, restritoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      }
    }
  }
  return { numeros: await listarNumerosMapeados(uid) }
})

/** Define qual número é o principal (usado nos envios). */
exports.smsSetPrincipalNumero = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  if (!id) throw new HttpsError('invalid-argument', 'id obrigatório.')
  const alvo = await db.doc(`users/${uid}/smsNumeros/${id}`).get()
  if (!alvo.exists) throw new HttpsError('not-found', 'Número não encontrado.')
  const todos = await db.collection(`users/${uid}/smsNumeros`).get()
  const batch = db.batch()
  todos.forEach((d) => batch.set(d.ref, { principal: d.id === id }, { merge: true }))
  await batch.commit()
  return { ok: true }
})

/** Cancela a assinatura do número (Stripe), libera o número na Telnyx e remove do cliente. */
exports.smsCancelarNumero = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  if (!id) throw new HttpsError('invalid-argument', 'id obrigatório.')
  const ref = db.doc(`users/${uid}/smsNumeros/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Número não encontrado.')
  const data = snap.data()
  const key = process.env.STRIPE_SECRET_KEY
  // Quantos números compartilham essa assinatura? (compra de vários = 1 assinatura com quantidade N)
  let irmaos = 1
  if (data.stripeSubscriptionId) {
    try { const q = await db.collection(`users/${uid}/smsNumeros`).where('stripeSubscriptionId', '==', data.stripeSubscriptionId).get(); irmaos = q.size || 1 } catch (_) {}
  }
  if (key && data.stripeSubscriptionId) {
    try {
      const stripe = require('stripe')(key)
      if (irmaos > 1 && data.stripeSubItemId) {
        // Ainda há outros números nessa assinatura → só reduz a quantidade (mantém os outros ativos).
        await stripe.subscriptions.update(data.stripeSubscriptionId, {
          items: [{ id: data.stripeSubItemId, quantity: irmaos - 1 }],
          proration_behavior: 'none',
        })
      } else {
        // Era o último número da assinatura → cancela a assinatura toda.
        await stripe.subscriptions.cancel(data.stripeSubscriptionId)
      }
    } catch (e) { console.error('cancelar/decrementar sub numero', e?.message || e) }
  }
  await liberarNumeroTelnyx(data.telnyxPhoneId)
  await ref.delete()
  // Se era o principal, promove outro número ativo a principal
  if (data.principal) {
    const outros = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').limit(1).get()
    if (!outros.empty) await outros.docs[0].ref.set({ principal: true }, { merge: true })
  }
  return { ok: true }
})

/** Exclui só o chip: libera o número na Telnyx e remove do app, SEM mexer na assinatura Stripe. */
exports.smsExcluirNumero = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  if (!id) throw new HttpsError('invalid-argument', 'id obrigatório.')
  const ref = db.doc(`users/${uid}/smsNumeros/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Número não encontrado.')
  const data = snap.data()
  await liberarNumeroTelnyx(data.telnyxPhoneId)
  await ref.delete()
  if (data.principal) {
    const outros = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').limit(1).get()
    if (!outros.empty) await outros.docs[0].ref.set({ principal: true }, { merge: true })
  }
  return { ok: true }
})

// ───────────────── SMS — Conta Telnyx PRÓPRIA do cliente (BYO / API's) ─────────────────

/** Valida a API key da Telnyx (checa o saldo — 200 = key ok). */
async function validarTelnyxKey(apiKey) {
  try {
    const r = await fetch('https://api.telnyx.com/v2/balance', { headers: { Authorization: `Bearer ${apiKey}` } })
    return r.ok
  } catch (_) { return false }
}

/** Puxa os números que o cliente tem na conta Telnyx dele (via a key dele). Retorna [{ number }]. */
async function puxarNumerosTelnyx(apiKey) {
  const out = []
  try {
    const r = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=100&filter[status]=active', { headers: { Authorization: `Bearer ${apiKey}` } })
    const j = await r.json().catch(() => ({}))
    for (const n of (j?.data || [])) {
      const num = n.phone_number || n.phoneNumber || null
      if (num) out.push({ number: num, telnyxPhoneId: n.id || null })
    }
  } catch (_) {}
  return out
}

/** Conecta a conta Telnyx do cliente (só a API key + apelido). Valida a key e PUXA os números dele. */
exports.smsAddProvider = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTenantAtivo(uid)
  const apiKey = String(request.data?.apiKey || '').trim()
  const nome = String(request.data?.nome || '').trim() || 'Minha conta Telnyx'
  const messagingProfileId = String(request.data?.messagingProfileId || '').trim()
  if (!apiKey) throw new HttpsError('invalid-argument', 'Informe a API key da Telnyx.')
  const ok = await validarTelnyxKey(apiKey)
  if (!ok) throw new HttpsError('failed-precondition', 'API key da Telnyx inválida ou sem permissão. Confira em Telnyx → API Keys.')
  // Puxa os números da conta dele — ele não precisa digitar.
  const numeros = await puxarNumerosTelnyx(apiKey)
  if (!numeros.length) throw new HttpsError('failed-precondition', 'Nenhum número encontrado nessa conta Telnyx. Compre um número na Telnyx primeiro.')
  const existentes = await db.collection(`users/${uid}/smsProviders`).get()
  const ref = await db.collection(`users/${uid}/smsProviders`).add({
    apiKey, from: numeros[0].number, messagingProfileId: messagingProfileId || null, nome,
    numeros: numeros.map((n) => n.number),
    principal: existentes.empty, // 1º provedor já vira principal
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  // Se virou principal, tira o principal dos NÚMEROS da nossa conta (principal é único global).
  if (existentes.empty) {
    const nums = await db.collection(`users/${uid}/smsNumeros`).get()
    const batch = db.batch()
    nums.forEach((d) => { if (d.data().principal) batch.set(d.ref, { principal: false }, { merge: true }) })
    await batch.commit()
  }
  return { ok: true, id: ref.id, numeros: numeros.map((n) => n.number) }
})

/** Define qual número (dos puxados da Telnyx dele) o provedor usa pra enviar. */
exports.smsProviderSetFrom = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  const from = String(request.data?.from || '').trim()
  if (!id || !from) throw new HttpsError('invalid-argument', 'id e número obrigatórios.')
  const ref = db.doc(`users/${uid}/smsProviders/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Provedor não encontrado.')
  const lista = Array.isArray(snap.data().numeros) ? snap.data().numeros : []
  if (lista.length && !lista.includes(from)) throw new HttpsError('invalid-argument', 'Esse número não pertence a essa conta.')
  await ref.set({ from }, { merge: true })
  return { ok: true }
})

/** Re-puxa os números da conta Telnyx do provedor (atualiza a lista). */
exports.smsProviderSync = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  if (!id) throw new HttpsError('invalid-argument', 'id obrigatório.')
  const ref = db.doc(`users/${uid}/smsProviders/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Provedor não encontrado.')
  const numeros = await puxarNumerosTelnyx(snap.data().apiKey)
  const lista = numeros.map((n) => n.number)
  const patch = { numeros: lista }
  // Se o "from" atual sumiu da conta, aponta pro primeiro disponível.
  if (lista.length && !lista.includes(snap.data().from)) patch.from = lista[0]
  await ref.set(patch, { merge: true })
  return { ok: true, numeros: lista }
})

/** Lista os provedores Telnyx próprios do cliente (mascara a key). */
exports.smsListProviders = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const snap = await db.collection(`users/${uid}/smsProviders`).get()
  const provedores = snap.docs.map((d) => {
    const x = d.data()
    const k = String(x.apiKey || '')
    return {
      id: d.id, nome: x.nome || 'Conta Telnyx', from: x.from || '',
      numeros: Array.isArray(x.numeros) ? x.numeros : (x.from ? [x.from] : []),
      messagingProfileId: x.messagingProfileId || null, principal: !!x.principal,
      apiKeyMasked: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '',
      criadoEm: x.createdAt?.toMillis ? x.createdAt.toMillis() : null,
    }
  })
  provedores.sort((a, b) => (Number(b.principal) - Number(a.principal)) || ((a.criadoEm || 0) - (b.criadoEm || 0)))
  return { provedores }
})

/** Remove um provedor Telnyx próprio. */
exports.smsDeleteProvider = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  if (!id) throw new HttpsError('invalid-argument', 'id obrigatório.')
  const ref = db.doc(`users/${uid}/smsProviders/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Provedor não encontrado.')
  const eraPrincipal = !!snap.data().principal
  await ref.delete()
  // Se era o principal, promove outro provedor; se não houver, promove um número nosso.
  if (eraPrincipal) {
    const outros = await db.collection(`users/${uid}/smsProviders`).limit(1).get()
    if (!outros.empty) await outros.docs[0].ref.set({ principal: true }, { merge: true })
    else {
      const nums = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').limit(1).get()
      if (!nums.empty) await nums.docs[0].ref.set({ principal: true }, { merge: true })
    }
  }
  return { ok: true }
})

/** Define o principal GLOBAL entre número (nossa conta) e provedor (conta do cliente). tipo: 'numero' | 'provider'. */
exports.smsDefinirPrincipal = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tipo = String(request.data?.tipo || '')
  const id = String(request.data?.id || '')
  if (!id || (tipo !== 'numero' && tipo !== 'provider')) throw new HttpsError('invalid-argument', 'tipo/id inválidos.')
  const alvoRef = db.doc(`users/${uid}/sms${tipo === 'numero' ? 'Numeros' : 'Providers'}/${id}`)
  const alvo = await alvoRef.get()
  if (!alvo.exists) throw new HttpsError('not-found', 'Item não encontrado.')
  const [nums, provs] = await Promise.all([
    db.collection(`users/${uid}/smsNumeros`).get(),
    db.collection(`users/${uid}/smsProviders`).get(),
  ])
  const batch = db.batch()
  nums.forEach((d) => batch.set(d.ref, { principal: tipo === 'numero' && d.id === id }, { merge: true }))
  provs.forEach((d) => batch.set(d.ref, { principal: tipo === 'provider' && d.id === id }, { merge: true }))
  await batch.commit()
  return { ok: true }
})

// ───────────────── SMS — Recarga de créditos (pagamento único via Stripe) ─────────────────

/** Pacotes de recarga: chave → { priceId, quantidade, valor }. */
function pacotesCreditoSMS() {
  return {
    '500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_500, quantidade: 500, valor: 29.9 },
    '1000': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_1000, quantidade: 1000, valor: 49.9 },
    '2500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_2500, quantidade: 2500, valor: 99.9 },
  }
}

/** priceId de crédito → quantidade de SMS (usado no webhook). */
function creditosDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoSMS()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].quantidade }
  return 0
}

/** Cria o checkout Stripe (pagamento único) pra recarregar créditos de SMS. */
exports.smsCriarCheckoutCredito = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const pacoteKey = String(request.data?.pacote || '')
  const pacote = pacotesCreditoSMS()[pacoteKey]
  if (!pacote || !pacote.priceId) throw new HttpsError('invalid-argument', 'Pacote de crédito inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Recarga ainda não configurada.')
  const stripe = require('stripe')(key)
  const appUrl = (process.env.APP_URL || 'https://autsend.com.br').replace(/\/+$/, '')
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'credito_sms', uid, quantidade: String(pacote.quantidade) }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${appUrl}/perfil?recarga=ok`,
      cancel_url: `${appUrl}/perfil?recarga=cancelado`,
    })
    return { url: session.url }
  } catch (e) {
    console.error('smsCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

// ───────────────── E-MAIL — Recarga de créditos (pagamento único via Stripe) ─────────────────

/** Pacotes de recarga de e-mail: chave → { priceId, quantidade, valor }. */
function pacotesCreditoEmail() {
  return {
    '5000': { priceId: process.env.STRIPE_PRICE_CREDITO_EMAIL_5000, quantidade: 5000, valor: 49.9 },
    '10000': { priceId: process.env.STRIPE_PRICE_CREDITO_EMAIL_10000, quantidade: 10000, valor: 89.9 },
    '25000': { priceId: process.env.STRIPE_PRICE_CREDITO_EMAIL_25000, quantidade: 25000, valor: 199 },
  }
}

/** priceId de crédito de e-mail → quantidade (usado no webhook). */
function creditosEmailDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoEmail()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].quantidade }
  return 0
}

/** E-mails pagos pela COTA DO PLANO neste mês (crédito é consumido primeiro). */
async function quotaEmailUsadaNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let quota = 0
  try {
    const ds = await db.collection(`users/${uid}/emailDisparos`).get()
    ds.forEach((d) => {
      const x = d.data()
      if (x.contaPropria === true) return // envio pela API do próprio cliente não consome nossa cota
      const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0)
      if (cm >= inicio.getTime()) {
        const totalDisp = Number(x.total) || 0
        const credito = Number(x.creditoConsumido) || 0
        quota += Math.max(0, totalDisp - credito)
      }
    })
  } catch (_) {}
  return quota
}

/** Cria o checkout Stripe (pagamento único) pra recarregar créditos de e-mail. */
exports.emailCriarCheckoutCredito = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const pacoteKey = String(request.data?.pacote || '')
  const pacote = pacotesCreditoEmail()[pacoteKey]
  if (!pacote || !pacote.priceId) throw new HttpsError('invalid-argument', 'Pacote de crédito inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Recarga ainda não configurada.')
  const stripe = require('stripe')(key)
  const appUrl = (process.env.APP_URL || 'https://autsend.com.br').replace(/\/+$/, '')
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'credito_email', uid, quantidade: String(pacote.quantidade) }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${appUrl}/perfil?recarga=ok`,
      cancel_url: `${appUrl}/perfil?recarga=cancelado`,
    })
    return { url: session.url }
  } catch (e) {
    console.error('emailCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

// ───────────────── Setor de Risco — auto-pause por reclamação/bounce (conta Resend compartilhada) ─────────────────
// Limiares (Gmail: reclamação 0,1% perigo / 0,3% crítico; bounce alto = lista ruim). Só avalia com amostra mínima.
const RISCO_MIN_AMOSTRA = 100
const RISCO_RECLAMACAO_MAX = 0.003 // 0,3%
const RISCO_BOUNCE_MAX = 0.08 // 8%

function mesAtualStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Contabiliza um evento de e-mail no "setor de risco" do tenant e auto-pausa se passar do limiar.
 * tipo: 'entregue' | 'bounce' | 'reclamacao'. Janela mensal (zera na virada do mês).
 * Não re-pausa se o admin deu override (ele assumiu o risco).
 */
async function registrarEventoRisco(uid, tipo) {
  if (!uid || !tipo) return
  const ref = db.doc(`tenants/${uid}`)
  const mes = mesAtualStr()
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const t = snap.exists ? snap.data() : {}
      let r = t.risco || {}
      if (r.mes !== mes) r = { mes, entregues: 0, bounces: 0, reclamacoes: 0, status: r.status || 'ativo', override: !!r.override }
      if (tipo === 'entregue') r.entregues = (r.entregues || 0) + 1
      else if (tipo === 'bounce') r.bounces = (r.bounces || 0) + 1
      else if (tipo === 'reclamacao') r.reclamacoes = (r.reclamacoes || 0) + 1
      // Avalia limiar (só se não estiver já pausado e o admin não tiver assumido o risco)
      if (r.status !== 'pausado' && !r.override) {
        const tentativas = (r.entregues || 0) + (r.bounces || 0)
        if (tentativas >= RISCO_MIN_AMOSTRA) {
          const recRate = (r.reclamacoes || 0) / Math.max(1, r.entregues || 0)
          const bncRate = (r.bounces || 0) / Math.max(1, tentativas)
          if (recRate >= RISCO_RECLAMACAO_MAX || bncRate >= RISCO_BOUNCE_MAX) {
            r.status = 'pausado'
            r.motivo = recRate >= RISCO_RECLAMACAO_MAX ? `reclamação ${(recRate * 100).toFixed(2)}%` : `bounce ${(bncRate * 100).toFixed(2)}%`
            r.pausadoEm = admin.firestore.Timestamp.now()
            r.auto = true
          }
        }
      }
      tx.set(ref, { risco: r }, { merge: true })
    })
  } catch (e) { console.error('registrarEventoRisco', e?.message || e) }
}

/** true se os envios de e-mail do tenant estão pausados pelo setor de risco (admin com override libera). */
function emailPausadoPorRisco(tenant) {
  const r = tenant?.risco
  return !!(r && r.status === 'pausado' && !r.override)
}

/** Versão que busca o tenant pelo uid (pra jobs de background: funil, automação). */
async function emailPausadoUid(uid) {
  try { const s = await db.doc(`tenants/${uid}`).get(); return emailPausadoPorRisco(s.exists ? s.data() : {}) } catch (_) { return false }
}

/**
 * Stats do perfil: e-mails e SMS usados no mês, limites do plano e saldo de créditos.
 */
exports.getPerfilStats = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const s = await db.doc(`tenants/${uid}`).get()
  const t = s.exists ? s.data() : {}
  const lim = limitesDoTenant(t)
  const isAdm = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const [emailsUsados, smsUsados] = await Promise.all([emailsEnviadosNoMes(uid), smsEnviadosNoMes(uid)])
  const smsCreditos = Number(t.smsCreditos) || 0
  const emailCreditos = Number(t.emailCreditos) || 0
  return {
    plano: lim.plano, isAdmin: isAdm,
    nome: t.nome || (request.auth?.token?.name || '') || '',
    email: t.email || (request.auth?.token?.email || '') || '',
    fotoURL: t.fotoURL || null,
    emailsUsados, emailsLimite: isAdm ? -1 : (lim.emailsMes || 0), emailCreditos,
    smsUsados, smsLimite: isAdm ? -1 : (lim.smsMes || 0), smsCreditos,
    // String discreta no perfil (sem citar spam). Admin com override não vê pausa.
    pausada: emailPausadoPorRisco(t),
  }
})

/** Salva a foto de perfil (data URL pequeno) no tenant. */
exports.salvarFotoPerfil = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const dataUrl = String(request.data?.dataUrl || '')
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) throw new HttpsError('invalid-argument', 'Imagem inválida.')
  if (dataUrl.length > 900000) throw new HttpsError('invalid-argument', 'Imagem muito grande. Escolha uma menor.')
  await db.doc(`tenants/${uid}`).set({ fotoURL: dataUrl }, { merge: true })
  return { ok: true, fotoURL: dataUrl }
})

/**
 * Verifica a assinatura Svix do webhook do Resend.
 * `secret` = o "Signing secret" do webhook no Resend (formato whsec_BASE64).
 * Retorna true se a assinatura confere e o timestamp está dentro da tolerância.
 */
function verifySvixSignature(secret, headers, rawBody) {
  try {
    if (!secret || rawBody == null) return false
    const svixId = headers['svix-id'] || headers['webhook-id']
    const svixTs = headers['svix-timestamp'] || headers['webhook-timestamp']
    const svixSig = headers['svix-signature'] || headers['webhook-signature']
    if (!svixId || !svixTs || !svixSig) return false
    // Anti-replay: rejeita eventos com mais de 5 min de diferença
    const ts = Number(svixTs)
    if (Number.isFinite(ts)) {
      const nowSec = Math.floor(Date.now() / 1000)
      if (Math.abs(nowSec - ts) > 300) return false
    }
    const key = String(secret).startsWith('whsec_') ? String(secret).slice(6) : String(secret)
    const secretBytes = Buffer.from(key, 'base64')
    const signedContent = `${svixId}.${svixTs}.${rawBody}`
    const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')
    // O header traz uma lista separada por espaço, cada item "v1,<assinatura>"
    const sigs = String(svixSig).split(' ').map((p) => p.split(',')[1]).filter(Boolean)
    return sigs.some((s) => {
      try {
        const a = Buffer.from(s), b = Buffer.from(expected)
        return a.length === b.length && crypto.timingSafeEqual(a, b)
      } catch { return false }
    })
  } catch { return false }
}

/** Signing secret do webhook do Resend (env var ou config/resend). Vazio = verificação desligada. */
async function getResendWebhookSecret() {
  if (process.env.RESEND_WEBHOOK_SECRET) return process.env.RESEND_WEBHOOK_SECRET
  try {
    const snap = await db.doc('config/resend').get()
    return snap.exists ? (snap.data().webhookSecret || '') : ''
  } catch { return '' }
}

/**
 * Recebe eventos do Resend (aberturas, cliques, entregas, bounces, reclamações).
 * Atribuição do tenant: ?userId=UID na URL OU a tag `uid` no e-mail enviado.
 * Segurança: se houver um signing secret configurado (RESEND_WEBHOOK_SECRET ou config/resend),
 * a assinatura Svix é validada e eventos forjados são rejeitados (401).
 */
exports.resendWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  // Validação de assinatura (opt-in: só ativa se um secret estiver configurado)
  const secret = await getResendWebhookSecret()
  if (secret) {
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : (typeof req.rawBody === 'string' ? req.rawBody : '')
    if (!verifySvixSignature(secret, req.headers || {}, raw)) {
      res.status(401).json({ error: 'assinatura inválida' }); return
    }
  }

  const body = parseRequestBody(req)
  const type = String(body.type || body.event || '')
  const d = body.data || {}
  const emailTo = Array.isArray(d.to) ? d.to[0] : (d.to || '')
  const tags = Array.isArray(d.tags) ? d.tags : []
  const tagMap = {}
  tags.forEach((t) => { if (t && t.name) tagMap[t.name] = t.value })
  const link = d.click?.link || d.link || null
  const evento = type.replace('email.', '')
  const emailId = d.email_id || d.id || null

  // Tenant: a tag `uid` (vai certinha em cada e-mail) tem prioridade sobre o ?userId= fixo da URL,
  // pra um webhook único da conta compartilhada atribuir cada evento ao cliente correto.
  const userId = tagMap.uid || req.query.userId || null
  if (!userId) { res.status(400).json({ error: 'tenant não identificado (tag uid ou ?userId=)' }); return }

  // Motivo do bounce/reclamação (o Resend manda em data.bounce / data.reason)
  const motivo = d.bounce?.message || d.bounce?.reason || d.reason || null
  const bounceTipo = d.bounce?.type || d.bounce?.subType || null

  try {
    // O Resend nem sempre reenvia as tags no webhook — recuperamos o contexto pelo email_id
    let disparoId = tagMap.disparoId || null
    let leadId = tagMap.leadId || null
    let funnelId = tagMap.funnelId || null
    if (!disparoId && !leadId && !funnelId && emailId) {
      try {
        const m = await db.doc(`users/${userId}/emailSends/${emailId}`).get()
        if (m.exists) { const c = m.data(); disparoId = c.disparoId || null; leadId = c.leadId || null; funnelId = c.funnelId || null }
      } catch (_) {}
    }

    await db.collection('users').doc(userId).collection('emailEvents').add({
      tipo: evento,
      email: emailTo,
      link: link || null,
      motivo: motivo || null,
      bounceTipo: bounceTipo || null,
      disparoId,
      leadId,
      funnelId,
      emailId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Agrega no disparo (contagem de eventos)
    if (disparoId && (type === 'email.opened' || type === 'email.clicked')) {
      const campo = type === 'email.opened' ? 'aberturas' : 'cliques'
      await db.collection('users').doc(userId).collection('emailDisparos').doc(disparoId).set(
        { [campo]: admin.firestore.FieldValue.increment(1) }, { merge: true }
      )
    }

    // Setor de risco: conta entrega/bounce/reclamação e auto-pausa se passar do limiar.
    if (evento === 'delivered') await registrarEventoRisco(userId, 'entregue')
    else if (evento === 'bounced') await registrarEventoRisco(userId, 'bounce')
    else if (evento === 'complained') await registrarEventoRisco(userId, 'reclamacao')
  } catch (err) {
    console.error('Erro ao processar evento Resend:', err)
  }

  res.status(200).json({ ok: true })
})

// ───────────────────────── Domínios de e-mail (Fase A · Resend) ─────────────────────────

/** Chamada à API do Resend usando a key COMPARTILHADA da plataforma. */
async function resendSharedApi(method, path, body) {
  const key = await getSharedResendKey()
  if (!key) throw new HttpsError('failed-precondition', 'O envio por domínio ainda não foi ativado pela plataforma. Fale com o suporte.')
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = {}
  try { data = await res.json() } catch (_) {}
  if (!res.ok) throw new HttpsError('internal', data?.message || data?.error?.message || data?.error || `Resend respondeu ${res.status}`)
  return data
}

/** Normaliza a lista de registros DNS que o Resend devolve. */
function mapDnsRecords(records) {
  return (Array.isArray(records) ? records : []).map((r) => ({
    tipo: r.type || r.record || '',
    nome: r.name || '',
    valor: r.value || '',
    prioridade: r.priority != null ? r.priority : null,
    ttl: r.ttl || 'Auto',
    status: r.status || '',
  }))
}

const DOMINIO_RE = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/

/** Cria um domínio na conta compartilhada e guarda os registros DNS pro tenant. */
exports.emailAddDomain = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  const nome = String(request.data?.name || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!DOMINIO_RE.test(nome)) throw new HttpsError('invalid-argument', 'Informe um domínio válido (ex.: mail.sualoja.com).')

  // Trava de quantidade (plano) — admin não tem limite
  const ehAdmin = request.auth?.token?.email === ADMIN_EMAIL
  if (!ehAdmin) {
    const lim = limitesDoTenant(tenant)
    const atuais = (await db.collection(`users/${uid}/emailDomains`).count().get()).data().count
    if (lim.dominios != null && atuais >= lim.dominios) {
      throw new HttpsError('resource-exhausted', `Seu plano permite ${lim.dominios} domínio(s). Faça upgrade para adicionar mais.`)
    }
  }
  // Já existe?
  const dup = await db.collection(`users/${uid}/emailDomains`).where('name', '==', nome).limit(1).get()
  if (!dup.empty) throw new HttpsError('already-exists', 'Esse domínio já foi adicionado.')

  const region = request.data?.region || 'us-east-1'
  const created = await resendSharedApi('POST', '/domains', { name: nome, region })
  const doc = {
    resendId: created.id,
    name: nome,
    region,
    status: created.status || 'pending',
    records: mapDnsRecords(created.records),
    senders: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }
  const ref = await db.collection(`users/${uid}/emailDomains`).add(doc)
  return { id: ref.id, ...doc, createdAt: null, updatedAt: null }
})

/** Lista os domínios do tenant (com status e registros DNS).
 *  Auto-sincroniza do Resend os domínios ainda não verificados, pra não mostrar status desatualizado. */
exports.emailListDomains = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const snap = await db.collection(`users/${uid}/emailDomains`).orderBy('createdAt', 'asc').get()
  const temKey = !!(await getSharedResendKey())

  // Reconsulta o Resend só pros pendentes e atualiza o Firestore. Guarda o resultado fresco por id.
  const frescos = {}
  if (temKey) {
    await Promise.all(snap.docs.map(async (d) => {
      const x = d.data()
      if (x.status === 'verified' || !x.resendId) return
      try {
        const fresh = await resendSharedApi('GET', `/domains/${x.resendId}`, null)
        if (fresh && fresh.status && fresh.status !== x.status) {
          const patch = { status: fresh.status, records: mapDnsRecords(fresh.records) }
          await d.ref.set({ ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
          frescos[d.id] = patch
        }
      } catch (_) { /* silencioso */ }
    }))
  }

  const dominios = snap.docs.map((d) => {
    const x = { ...d.data(), ...(frescos[d.id] || {}) }
    return {
      id: d.id, name: x.name, status: x.status || 'pending', region: x.region || 'us-east-1',
      records: x.records || [], senders: x.senders || [],
      resendId: x.resendId || null,
      createdAt: x.createdAt?.toMillis ? x.createdAt.toMillis() : null,
    }
  })
  return { dominios, configurado: temKey }
})

/** Dispara/atualiza a verificação de um domínio no Resend e salva o novo status. */
exports.emailVerifyDomain = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = request.data?.id
  if (!id) throw new HttpsError('invalid-argument', 'id do domínio obrigatório.')
  const ref = db.doc(`users/${uid}/emailDomains/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Domínio não encontrado.')
  const resendId = snap.data().resendId
  // Pede verificação e relê o estado atualizado
  try { await resendSharedApi('POST', `/domains/${resendId}/verify`, null) } catch (_) {}
  const fresh = await resendSharedApi('GET', `/domains/${resendId}`, null)
  const patch = {
    status: fresh.status || snap.data().status,
    records: mapDnsRecords(fresh.records),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }
  await ref.set(patch, { merge: true })
  return { id, status: patch.status, records: patch.records }
})

/** Remove um domínio (do Resend e do Firestore). */
exports.emailDeleteDomain = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = request.data?.id
  if (!id) throw new HttpsError('invalid-argument', 'id do domínio obrigatório.')
  const ref = db.doc(`users/${uid}/emailDomains/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Domínio não encontrado.')
  try { await resendSharedApi('DELETE', `/domains/${snap.data().resendId}`, null) } catch (_) {}
  await ref.delete()
  return { ok: true }
})

/** Salva os remetentes (nome + e-mail) de um domínio. Os e-mails precisam ser @domínio. */
exports.emailSaveDomainSenders = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = request.data?.id
  const senders = Array.isArray(request.data?.senders) ? request.data.senders : []
  if (!id) throw new HttpsError('invalid-argument', 'id do domínio obrigatório.')
  const ref = db.doc(`users/${uid}/emailDomains/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Domínio não encontrado.')
  const dom = snap.data().name
  const limpos = senders
    .filter((r) => r && typeof r.email === 'string')
    .map((r) => ({ id: String(r.id || '').slice(0, 40) || crypto.randomUUID(), email: String(r.email).trim().toLowerCase(), nome: String(r.nome || '').slice(0, 80) }))
    .filter((r) => r.email.endsWith(`@${dom}`))
  await ref.set({ senders: limpos, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  return { id, senders: limpos }
})

// ───────────────────────── Onboarding via Kiwify (venda do plano do app) ─────────────────────────

const KIWIFY_SENHA_PADRAO = '123456789'

/** Config do onboarding: config/kiwify = { produtos: {<idOuNome>: 'padrao'|'pro'}, webhookToken, fromEmail, fromName, appUrl }. */
async function getKiwifyOnboardConfig() {
  try { const s = await db.doc('config/kiwify').get(); return s.exists ? s.data() : {} } catch { return {} }
}

/** Valida a assinatura da Kiwify: ?signature = HMAC-SHA1(rawBody, token). Sem token = verificação desligada. */
function verifyKiwifySignature(token, signature, rawBody) {
  if (!token) return true
  if (!signature || rawBody == null) return false
  try {
    const expected = crypto.createHmac('sha1', token).update(rawBody).digest('hex')
    const a = Buffer.from(String(signature)), b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { return false }
}

/** Descobre o plano ('padrao'|'pro') do produto comprado, via config/kiwify.produtos (por id ou nome). */
function planoDoProdutoKiwify(cfg, product) {
  const map = cfg.produtos || {}
  if (product.id && map[String(product.id)]) return map[String(product.id)]
  if (product.nome && map[product.nome]) return map[product.nome]
  const nome = (product.nome || '').toLowerCase()
  if (nome.includes('inici')) return 'inicial'
  if (nome.includes('pro')) return 'pro'
  if (nome.includes('padr')) return 'padrao'
  return null
}

/** Acha ou cria o usuário pelo e-mail. Retorna { uid, criado }. */
async function garantirUsuarioKiwify(email, nome) {
  try {
    const u = await admin.auth().getUserByEmail(email)
    return { uid: u.uid, criado: false }
  } catch (_) {
    const u = await admin.auth().createUser({ email, password: KIWIFY_SENHA_PADRAO, displayName: nome || undefined })
    return { uid: u.uid, criado: true }
  }
}

/** E-mail de boas-vindas com login e senha padrão (enviado pela conta Resend compartilhada). */
async function enviarBoasVindasKiwify(cfg, email, nome, plano) {
  const key = await getSharedResendKey()
  const from = cfg.fromEmail ? (cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail) : null
  if (!key || !from) { console.warn('Boas-vindas Kiwify: sem RESEND_SHARED_KEY ou config/kiwify.fromEmail — e-mail não enviado.'); return }
  const url = (cfg.appUrl || 'https://autsend.com.br').replace(/\/+$/, '')
  const logo = `${url}/autsendlogo.png`
  const nomePlano = plano === 'pro' ? 'Pro' : plano === 'inicial' ? 'Inicial' : 'Padrão'
  const saud = nome ? `Olá, ${String(nome).trim().split(' ')[0]}!` : 'Bem-vindo(a)!'
  const html = `
<div style="background:#eef0fb;padding:32px 12px;font-family:Roboto,Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 34px rgba(91,94,235,0.14)">
    <div style="padding:26px 24px 18px;text-align:center;border-bottom:1px solid #f0f0f6">
      <img src="${logo}" alt="Autsend" height="72" style="height:72px;width:auto;display:inline-block" />
    </div>
    <div style="padding:30px 30px 8px;color:#2b2b3a;font-family:Roboto,Arial,Helvetica,sans-serif">
      <h1 style="margin:0 0 6px;font-size:23px;font-weight:800;color:#1f2030">${saud}</h1>
      <p style="margin:0 0 22px;font-size:15px;color:#5b5b6b;line-height:1.6">Sua conta do plano <strong style="color:#5b5eeb">${nomePlano}</strong> está ativa. É só entrar com os dados abaixo:</p>
      <div style="background:#f5f5fc;border:1px solid #ececf7;border-radius:16px;padding:18px 20px;margin:0 0 26px">
        <p style="margin:0 0 10px;font-size:14px;color:#2b2b3a"><span style="color:#9a9ab0;display:inline-block;width:56px">E-mail</span> <strong>${email}</strong></p>
        <p style="margin:0;font-size:14px;color:#2b2b3a"><span style="color:#9a9ab0;display:inline-block;width:56px">Senha</span> <strong style="letter-spacing:1px">${KIWIFY_SENHA_PADRAO}</strong></p>
      </div>
      <a href="${url}" style="display:block;text-align:center;background:linear-gradient(135deg,#6d6ff5,#5b5eeb);background-color:#5b5eeb;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.5px;padding:16px;border-radius:14px;box-shadow:0 6px 16px rgba(91,94,235,0.35)">IR PARA O APP</a>
      <p style="margin:18px 0 0;font-size:13px;color:#9a9ab0;line-height:1.5;text-align:center">Por segurança, <strong style="color:#7a7a90">troque sua senha</strong> no primeiro acesso.</p>
    </div>
    <div style="padding:20px 24px 26px;text-align:center">
      <p style="margin:0;font-size:12px;color:#b3b3c4;line-height:1.5">Autsend — Remarketing automático por WhatsApp, E-mail e SMS<br/>Este e-mail foi enviado porque você adquiriu um plano.</p>
    </div>
  </div>
</div>`
  try {
    await sendEmailViaResend({ apiKey: key, from, to: email, subject: 'Seu acesso ao Autsend está pronto 🚀', html })
  } catch (e) { console.error('Erro no e-mail de boas-vindas Kiwify:', e) }
}

/**
 * Webhook de onboarding: recebe as vendas do PLANO do app na Kiwify.
 * Compra aprovada/renovação → cria/ativa a conta e seta o plano.
 * Reembolso/chargeback/cancelamento → volta pro Free (congela, não deleta nada).
 * Config em config/kiwify. Assinatura opcional via ?signature (config/kiwify.webhookToken).
 */
exports.kiwifyOnboarding = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  const cfg = await getKiwifyOnboardConfig()
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : (typeof req.rawBody === 'string' ? req.rawBody : '')
  if (cfg.webhookToken && !verifyKiwifySignature(cfg.webhookToken, req.query.signature, raw)) {
    res.status(401).json({ error: 'assinatura inválida' }); return
  }

  const body = parseRequestBody(req)
  const evento = extractEvent(body)
  const customer = extractCustomer(body)
  const product = extractProduct(body)
  const orderId = extractOrderId(body)
  const email = (customer.email || '').toLowerCase().trim()

  // Registra o produto recebido (pro admin mapear com 1 clique no painel)
  if (product.id || product.nome) {
    try {
      await db.doc('config/kiwify').set({ produtosVistos: { [String(product.id || product.nome)]: product.nome || String(product.id) } }, { merge: true })
    } catch (_) { /* ignore */ }
  }

  if (!email) { res.status(200).json({ ok: true, ignored: 'sem e-mail no payload' }); return }

  const ativa = evento === 'order_status.purchase_approved' || evento === 'subscription_renewed'
  const revoga = ['order_status.refund', 'order_status.chargeback', 'subscription_canceled', 'subscription_overdue'].includes(evento)

  try {
    if (ativa) {
      const plano = planoDoProdutoKiwify(cfg, product)
      if (!plano) {
        console.warn('Kiwify onboarding: produto sem plano mapeado.', { id: product.id, nome: product.nome })
        res.status(200).json({ ok: true, ignored: 'produto não mapeado', product }); return
      }
      const { uid, criado } = await garantirUsuarioKiwify(email, customer.nome)
      await db.doc(`tenants/${uid}`).set({
        plano, status: 'approved', email, nome: customer.nome || null, origem: 'kiwify',
        kiwifyOrderId: orderId || null,
        ...(criado ? { mustChangePassword: true } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      if (criado) await enviarBoasVindasKiwify(cfg, email, customer.nome, plano)
      res.status(200).json({ ok: true, plano, criado, uid }); return
    }

    if (revoga) {
      try {
        const u = await admin.auth().getUserByEmail(email)
        await db.doc(`tenants/${u.uid}`).set({ plano: 'free', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        res.status(200).json({ ok: true, revogado: true, uid: u.uid }); return
      } catch (_) {
        res.status(200).json({ ok: true, ignored: 'usuário não encontrado para revogar' }); return
      }
    }

    res.status(200).json({ ok: true, ignored: evento })
  } catch (err) {
    console.error('Erro no onboarding Kiwify:', err)
    res.status(200).json({ ok: false, error: err.message })
  }
})

// ───────────────────────── Stripe: checkout dos planos Autsend ─────────────────────────

/** price_... → plano do app, via env (STRIPE_PRICE_INICIAL/PADRAO/PRO). */
function planoDoPriceStripe(priceId) {
  if (!priceId) return null
  if (priceId === process.env.STRIPE_PRICE_INICIAL) return 'inicial'
  if (priceId === process.env.STRIPE_PRICE_PADRAO) return 'padrao'
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  return null
}

/** Extrai CPF/CNPJ do checkout (tax id ou custom field) — usado no Termo. */
function extrairDocumentoStripe(session) {
  try {
    const taxIds = session.customer_details?.tax_ids
    if (Array.isArray(taxIds) && taxIds.length && taxIds[0]?.value) return taxIds[0].value
    for (const f of (session.custom_fields || [])) {
      const k = (f.key || '').toLowerCase()
      if (k.includes('cpf') || k.includes('cnpj') || k.includes('documento') || k.includes('doc')) {
        return f.text?.value || (f.numeric?.value != null ? String(f.numeric.value) : null)
      }
    }
  } catch (_) {}
  return null
}

/**
 * Webhook do Stripe (substitui o kiwifyOnboarding no checkout DOS PLANOS).
 * checkout.session.completed → cria/ativa a conta + seta o plano (+ captura nome/CPF-CNPJ).
 * customer.subscription.deleted → volta pro Free (congela, não deleta nada).
 * STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET no functions/.env.
 */
exports.stripeWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) { res.status(500).send('Stripe não configurado'); return }
  const stripe = require('stripe')(secretKey)
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event
  try {
    if (whSecret) {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], whSecret)
    } else {
      event = typeof req.body === 'object' && req.body ? req.body : JSON.parse((req.rawBody || Buffer.from('{}')).toString('utf8'))
      console.warn('stripeWebhook: STRIPE_WEBHOOK_SECRET vazio — evento NÃO verificado (configure após registrar o endpoint).')
    }
  } catch (err) {
    console.error('stripeWebhook assinatura inválida:', err.message)
    res.status(400).send(`Webhook Error: ${err.message}`); return
  }

  try {
    const tipo = event.type

    if (tipo === 'checkout.session.completed') {
      const session = event.data.object

      // ── Recarga de crédito SMS (pagamento único) — soma créditos no tenant. ──
      if (session.metadata?.tipo === 'credito_sms') {
        const uidC = session.metadata.uid
        let quantidade = Number(session.metadata.quantidade) || 0
        if (!quantidade) quantidade = creditosDoPriceStripe((session.line_items?.data?.[0]?.price?.id) || null)
        if (!uidC || !quantidade) { res.status(200).json({ ok: true, ignored: 'credito_sms sem uid/quantidade' }); return }
        // Idempotência por sessão de checkout.
        const recRef = db.doc(`tenants/${uidC}/recargasSMS/${session.id}`)
        const jaRec = await recRef.get()
        if (jaRec.exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ smsCreditos: admin.firestore.FieldValue.increment(quantidade) }, { merge: true })
        await recRef.set({ quantidade, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        res.status(200).json({ ok: true, creditado: quantidade, uid: uidC }); return
      }

      // ── Recarga de crédito de E-MAIL (pagamento único) — soma créditos no tenant. ──
      if (session.metadata?.tipo === 'credito_email') {
        const uidC = session.metadata.uid
        let quantidade = Number(session.metadata.quantidade) || 0
        if (!quantidade) quantidade = creditosEmailDoPriceStripe((session.line_items?.data?.[0]?.price?.id) || null)
        if (!uidC || !quantidade) { res.status(200).json({ ok: true, ignored: 'credito_email sem uid/quantidade' }); return }
        const recRef = db.doc(`tenants/${uidC}/recargasEmail/${session.id}`)
        const jaRec = await recRef.get()
        if (jaRec.exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ emailCreditos: admin.firestore.FieldValue.increment(quantidade) }, { merge: true })
        await recRef.set({ quantidade, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        res.status(200).json({ ok: true, creditadoEmail: quantidade, uid: uidC }); return
      }

      // ── Fase 2: compra de NÚMERO(S) SMS (não é plano) — compra na Telnyx e salva no cliente. ──
      if (session.metadata?.tipo === 'numero_sms') {
        const uidN = session.metadata.uid
        let numeros = []
        try { numeros = JSON.parse(session.metadata.numeros || '[]') } catch (_) {}
        if (!numeros.length && session.metadata.numero) numeros = [session.metadata.numero] // compat
        const subscriptionId = session.subscription || null
        if (!uidN || !numeros.length) { res.status(200).json({ ok: true, ignored: 'numero_sms sem uid/numeros' }); return }
        // Idempotência: se já processamos esta assinatura, sai.
        try {
          const ja = await db.collection(`users/${uidN}/smsNumeros`).where('stripeSubscriptionId', '==', subscriptionId).limit(1).get()
          if (!ja.empty) { res.status(200).json({ ok: true, ja: true }); return }
        } catch (_) {}
        // Pega o subscription item id (usado pra decrementar a quantidade num cancelamento parcial).
        let subItemId = null
        try { if (subscriptionId) { const s = await stripe.subscriptions.retrieve(subscriptionId); subItemId = s.items?.data?.[0]?.id || null } } catch (_) {}
        const existentes = await db.collection(`users/${uidN}/smsNumeros`).limit(1).get()
        const semNumeros = existentes.empty // se não tinha nenhum, o 1º da lista vira principal
        let comprados = 0
        for (let i = 0; i < numeros.length; i++) {
          const numero = String(numeros[i] || '').trim()
          if (!numero) continue
          let compra = null, erroCompra = null
          try { compra = await comprarNumeroSMSNoTelnyx(numero) }
          catch (e) { erroCompra = e.message || 'falha ao comprar número'; console.error('comprarNumeroSMSNoTelnyx', e) }
          if (!erroCompra) comprados++
          await db.collection(`users/${uidN}/smsNumeros`).add({
            number: numero,
            telnyxOrderId: compra?.orderId || null,
            telnyxPhoneId: compra?.phoneNumberId || null,
            messagingProfileId: compra?.messagingProfileId || null,
            status: erroCompra ? 'erro' : 'active',
            erro: erroCompra || null,
            principal: semNumeros && i === 0 && !erroCompra,
            stripeSubscriptionId: subscriptionId,
            stripeSubItemId: subItemId,
            stripeCustomerId: session.customer || null,
            valorMensal: 29.9,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
        res.status(200).json({ ok: true, total: numeros.length, comprados }); return
      }

      const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim()
      const nome = session.customer_details?.name || null
      const documento = extrairDocumentoStripe(session)
      const customerId = session.customer || null
      const subscriptionId = session.subscription || null

      let plano = null
      try {
        const itens = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 })
        for (const it of (itens.data || [])) { const p = planoDoPriceStripe(it.price?.id); if (p) { plano = p; break } }
      } catch (e) { console.error('stripe listLineItems', e) }

      if (!email || !plano) { res.status(200).json({ ok: true, ignored: 'sem e-mail ou plano', email: !!email, plano }); return }

      const { uid, criado } = await garantirUsuarioKiwify(email, nome)
      await db.doc(`tenants/${uid}`).set({
        plano, status: 'approved', email, nome: nome || null, origem: 'stripe',
        stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId,
        ...(documento ? { documento } : {}),
        ...(criado ? { mustChangePassword: true } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      if (criado) { const cfg = await getKiwifyOnboardConfig(); await enviarBoasVindasKiwify(cfg, email, nome, plano) }
      res.status(200).json({ ok: true, plano, criado, uid }); return
    }

    if (tipo === 'customer.subscription.deleted') {
      const sub = event.data.object
      const subId = sub.id
      const customerId = sub.customer

      // 1) Assinatura de NÚMERO(S) SMS? Libera TODOS os números dela e sai — NÃO mexe no plano do cliente.
      const numSnap = await db.collectionGroup('smsNumeros').where('stripeSubscriptionId', '==', subId).get()
      if (!numSnap.empty) {
        const uidN = numSnap.docs[0].ref.path.split('/')[1] // users/{uid}/smsNumeros/{id}
        for (const doc of numSnap.docs) {
          const dataN = doc.data()
          await liberarNumeroTelnyx(dataN.telnyxPhoneId)
          await doc.ref.delete()
        }
        // Se ficou sem principal, promove outro número ativo do mesmo cliente.
        const temPrincipal = await db.collection(`users/${uidN}/smsNumeros`).where('principal', '==', true).limit(1).get()
        if (temPrincipal.empty) {
          const outros = await db.collection(`users/${uidN}/smsNumeros`).where('status', '==', 'active').limit(1).get()
          if (!outros.empty) await outros.docs[0].ref.set({ principal: true }, { merge: true })
        }
        res.status(200).json({ ok: true, numerosLiberados: numSnap.size }); return
      }

      // 2) Assinatura de PLANO → volta pro Free (só se for mesmo a assinatura do plano do tenant).
      const snap = await db.collection('tenants').where('stripeCustomerId', '==', customerId).limit(1).get()
      if (!snap.empty) {
        const t = snap.docs[0].data()
        if (t.stripeSubscriptionId && t.stripeSubscriptionId !== subId) {
          res.status(200).json({ ok: true, ignored: 'assinatura não é a do plano' }); return
        }
        await snap.docs[0].ref.set({ plano: 'free', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        res.status(200).json({ ok: true, revogado: true }); return
      }
      res.status(200).json({ ok: true, ignored: 'tenant não encontrado pra revogar' }); return
    }

    res.status(200).json({ ok: true, ignored: tipo })
  } catch (err) {
    console.error('stripeWebhook erro:', err)
    res.status(200).json({ ok: false, error: err.message })
  }
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

/**
 * Descriptografa o payload do ClickBank INS (v6+): { notification, iv } em AES-256-CBC.
 * A chave é os 32 primeiros caracteres do SHA1 (hex) da INS Secret Key do vendedor.
 * Retorna o objeto decifrado, ou null se falhar / não for um payload cifrado.
 */
function decryptClickBankINS(body, secret) {
  if (!body || !secret || !body.notification || !body.iv) return null
  try {
    const key = crypto.createHash('sha1').update(String(secret)).digest('hex').slice(0, 32)
    const iv = Buffer.from(body.iv, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    let dec = decipher.update(body.notification, 'base64', 'utf8')
    dec += decipher.final('utf8')
    return JSON.parse(dec)
  } catch (_) {
    return null
  }
}

/** Extrai TODOS os produtos do checkout (principal + order bumps), a partir do path do fieldMap.produto. */
function extractAllProdutos(body, fieldMap) {
  const nomes = new Set()
  const ids = new Set()
  const pn = String(getByPath(body, fieldMap?.produto) ?? '').trim()
  const pi = String(getByPath(body, fieldMap?.produtoId) ?? '').trim()
  if (pn) nomes.add(pn)
  if (pi) ids.add(pi)
  const varrer = (path, alvo) => {
    const m = String(path || '').match(/^(.*?)\.\d+\.(.*)$/)
    if (!m) return
    const arr = getByPath(body, m[1])
    if (Array.isArray(arr)) for (const item of arr) { const v = String(getByPath(item, m[2]) ?? '').trim(); if (v) alvo.add(v) }
  }
  varrer(fieldMap?.produto, nomes)
  varrer(fieldMap?.produtoId, ids)
  return { nomes: [...nomes], ids: [...ids] }
}

/** Acha o grupo cujo produtos[] contém QUALQUER produto do checkout (não só o principal). */
function acharGrupo(grupos, produtos, product) {
  const nomes = (produtos?.nomes?.length ? produtos.nomes : [product?.nome]).filter(Boolean)
  const ids = (produtos?.ids?.length ? produtos.ids : [product?.id]).filter(Boolean)
  return (grupos || []).find((g) => Array.isArray(g.produtos) && g.produtos.some((p) => nomes.includes(p) || ids.includes(p)))
}

async function tryAutoSend(userId, leadRef, evento, customer, product, produtos) {
  try {
    // Automações de WhatsApp por GRUPO de produto — dispara se QUALQUER produto do checkout estiver no grupo.
    const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
    const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const grupo = acharGrupo(grupos, produtos, product)

    let autoMsg = null
    if (grupo) {
      const gSnap = await db.doc(`users/${userId}/autoMessages/${grupo.id}__${evento}`).get()
      if (gSnap.exists) { const d = gSnap.data(); if (d.ativo === true && d.mensagem) autoMsg = d }
    }
    // Fallback: automação global do evento (sem grupo/produto)
    if (!autoMsg) {
      const globalSnap = await db.doc(`users/${userId}/autoMessages/${evento}`).get()
      if (globalSnap.exists) { const d = globalSnap.data(); if (d.ativo === true && d.mensagem && !d.grupoId && !d.produto) autoMsg = d }
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
async function tryAutoSendEmail(userId, leadRef, evento, customer, product, produtos) {
  try {
    if (!customer.email) return
    // Automações de e-mail por GRUPO — dispara se QUALQUER produto do checkout estiver no grupo.
    const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
    const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const grupo = acharGrupo(grupos, produtos, product)
    if (!grupo) return
    const autoSnap = await db.doc(`users/${userId}/emailAutomations/${grupo.id}__${evento}`).get()
    const auto = autoSnap.exists ? autoSnap.data() : null
    if (!auto || auto.ativo !== true || !auto.templateId) return

    const tplSnap = await db.doc(`users/${userId}/emailTemplates/${auto.templateId}`).get()
    if (!tplSnap.exists) return
    const tpl = tplSnap.data()

    const cfg = await resolverRemetente(userId, auto.remetenteId || null)
    const from = cfg.from
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
        from: replaceVariables(from, customer, product),
        to: customer.email,
        subject,
        html: html + footer,
        headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Descadastrar>` },
        tags: [{ name: 'uid', value: userId }, { name: 'leadId', value: leadRef.id }, { name: 'tipo', value: 'automacao' }],
      })
      emailId = r?.id || null
    } catch (err) {
      ok = false
      erroMsg = err.message || 'Falha no envio do e-mail'
    }

    if (ok && emailId) await registrarEmailSend(userId, emailId, { leadId: leadRef.id })

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
async function dispararAcoes(userId, leadRef, evento, customer, product, produtos) {
  await tryAutoSend(userId, leadRef, evento, customer, product, produtos)
  await tryAutoSendEmail(userId, leadRef, evento, customer, product, produtos)
  await tryAutoSendSMS(userId, leadRef, evento, customer, product, produtos)
}

/**
 * Envia o SMS automático configurado para o evento (Automações de SMS — só internacional).
 * Ignora leads do Brasil (+55) e inválidos. Não altera o status do lead (canal secundário) — só grava smsLogs.
 */
async function tryAutoSendSMS(userId, leadRef, evento, customer, product, produtos) {
  try {
    if (!customer.telefone) return
    const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
    const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const grupo = acharGrupo(grupos, produtos, product)
    const ehAdm = await ehUidAdmin(userId)
    // Cada canal é independente: EUA (nossa conta) e API (conta do cliente). Ambos podem disparar.
    for (const canal of ['eua', 'api']) {
      let auto = null
      if (grupo) {
        let s = await db.doc(`users/${userId}/smsAutomations/${canal}__${grupo.id}__${evento}`).get()
        if (!s.exists && canal === 'eua') s = await db.doc(`users/${userId}/smsAutomations/${grupo.id}__${evento}`).get() // legado = eua
        if (s.exists) { const d = s.data(); if (d.ativo === true && d.mensagem) auto = d }
      }
      if (!auto) {
        let s = await db.doc(`users/${userId}/smsAutomations/${canal}__${evento}`).get()
        if (!s.exists && canal === 'eua') s = await db.doc(`users/${userId}/smsAutomations/${evento}`).get()
        if (s.exists) { const d = s.data(); if (d.ativo === true && d.mensagem && !d.grupoId && !d.produto) auto = d }
      }
      if (!auto) continue
      const rEnvio = await resolverTelnyxEnvio(userId, ehAdm, canal)
      if (rEnvio.erro) continue
      const cfg = rEnvio.cfg
      const norm = normalizarE164(customer.telefone, { permitirBR: !!rEnvio.propria })
      if (!norm.ok) continue // ignora inválidos (e BR quando é a nossa conta EUA)
      const texto = replaceVariables(auto.mensagem || '', { ...customer, telefone: norm.e164 }, product)
      let ok = true
      let erroMsg = null
      try { await enviarSMSTelnyx(cfg, norm.e164, texto) } catch (err) { ok = false; erroMsg = err.message || 'Falha no envio do SMS' }
      await db.collection('users').doc(userId).collection('smsLogs').add({
        leadId: leadRef.id, evento, canal, produto: product.nome || '', telefone: norm.e164, nome: customer.nome || '',
        status: ok ? 'enviado' : 'erro', erroMsg, mensagem: texto,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  } catch (err) {
    console.error('Erro no auto-send de SMS:', err)
  }
}

// ───────────────────────── Funil de e-mail: helpers ─────────────────────────
function acharNode(funnel, id) { return (funnel.nodes || []).find((n) => n.id === id) }
function nodeInicio(funnel) { return (funnel.nodes || []).find((n) => n.type === 'inicio') }
function proximoNode(funnel, nodeId, handle) {
  const e = (funnel.edges || []).find((ed) => ed.source === nodeId && (handle ? ed.sourceHandle === handle : !ed.sourceHandle))
  return e ? e.target : null
}

/** Envia um template de funil para um contato (com tags de funil para o rastreamento). */
async function enviarTemplateFunil(userId, templateId, contato, tags, remetenteId) {
  try {
    if (!contato?.email || !templateId) return false
    const cfg = await resolverRemetente(userId, remetenteId || null)
    const from = cfg.from
    if (!cfg?.apiKey || !from) return false
    // Pausa de risco só bloqueia envios pela NOSSA conta compartilhada (não a API própria do cliente).
    const sharedKeyFn = await getSharedResendKey()
    if (!!sharedKeyFn && cfg.apiKey === sharedKeyFn && await emailPausadoUid(userId)) return false
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
    const tagsComUid = [{ name: 'uid', value: userId }, ...(Array.isArray(tags) ? tags : [])]
    const r = await sendEmailViaResend({ apiKey: cfg.apiKey, from: replaceVariables(from, lead, product), to: contato.email, subject, html, headers: { 'List-Unsubscribe': `<mailto:${unsub}?subject=Unsubscribe>` }, tags: tagsComUid })
    const funnelId = (tags || []).find((t) => t && t.name === 'funnelId')?.value
    await registrarEmailSend(userId, r?.id, { funnelId })
    return true
  } catch (err) { console.error('enviarTemplateFunil', err); return false }
}

/** Cria o funnelRun no primeiro passo após o Início. canal: 'email' | 'whatsapp'. */
async function inscreverNoFunil(userId, funnelId, funnel, contato, canal = 'email') {
  const inicio = nodeInicio(funnel)
  const primeiro = inicio ? proximoNode(funnel, inicio.id) : null
  const idKey = (canal === 'whatsapp' || canal === 'sms') ? (contato?.telefone || '') : (contato?.email || '')
  if (!primeiro || !idKey) return false
  await db.collection('users').doc(userId).collection('funnelRuns').add({
    funnelId,
    canal,
    contato: { email: contato.email || '', telefone: contato.telefone || '', nome: contato.nome || '', produto: contato.produto || '' },
    currentNodeId: primeiro,
    status: 'ativo',
    nextRunAt: admin.firestore.Timestamp.now(),
    enteredAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return true
}

/** Envia uma mensagem de WhatsApp de um nó de funil (via n8n/Evolution). */
async function enviarMensagemFunil(userId, mensagem, contato) {
  try {
    if (!contato?.telefone || !mensagem) return false
    const evolution = await getEvolutionConfigForUser(userId)
    if (!evolution?.nomeInstancia) return false
    const customer = { nome: contato.nome || '', telefone: contato.telefone, email: contato.email || '' }
    const product = { nome: contato.produto || '' }
    const msg = replaceVariables(mensagem, customer, product)
    const numeroWhatsApp = (evolution.numeroWhatsapp || evolution.numeroWhatsApp || '').toString().replace(/\D/g, '')
    const payload = {
      tipoAcao: 'enviar_remarketing',
      contatos: [{ nome: customer.nome, telefone: customer.telefone, email: customer.email }],
      mensagem: msg,
      nomeInstancia: evolution.nomeInstancia || '',
      hash: evolution.hash || '',
      instanciaId: evolution.instanceId || evolution.hash || '',
      numeroWhatsApp: numeroWhatsApp || undefined,
      evento: 'funil',
      produto: product.nome || '',
    }
    const res = await fetch(N8N_REMARKETING_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return res.ok
  } catch (err) { console.error('enviarMensagemFunil', err); return false }
}

/** Envia um SMS (Telnyx) de um nó de funil. canal: 'eua' (nossa conta) | 'api' (conta do cliente). */
async function enviarMensagemFunilSMS(userId, mensagem, contato, canal) {
  try {
    if (!contato?.telefone || !mensagem) return false
    const rEnvio = await resolverTelnyxEnvio(userId, await ehUidAdmin(userId), canal === 'api' ? 'api' : 'eua')
    if (rEnvio.erro) return false
    const cfg = rEnvio.cfg
    const norm = normalizarE164(contato.telefone, { permitirBR: !!rEnvio.propria })
    if (!norm.ok) return false
    const texto = replaceVariables(mensagem, { nome: contato.nome || '', telefone: norm.e164, email: contato.email || '' }, { nome: contato.produto || '' })
    await enviarSMSTelnyx(cfg, norm.e164, texto)
    return true
  } catch (err) { console.error('enviarMensagemFunilSMS', err); return false }
}

/** Condição do funil de WhatsApp: o contato fez uma compra aprovada depois de entrar? (por e-mail ou telefone) */
async function comprouDesde(userId, contato, desde) {
  try {
    const leadsRef = db.collection('users').doc(userId).collection('leads')
    const checaSnap = (snap) => snap.docs.some((d) => {
      const v = d.data()
      if (canonicalEvento(v.evento) !== 'order_status.purchase_approved') return false
      const t = v.createdAt?.toMillis ? v.createdAt.toMillis() : 0
      return t >= desde
    })
    if (contato?.email) {
      const s = await leadsRef.where('email', '==', contato.email).limit(25).get()
      if (checaSnap(s)) return true
    }
    if (contato?.telefone) {
      const s = await leadsRef.where('telefone', '==', contato.telefone).limit(25).get()
      if (checaSnap(s)) return true
    }
    return false
  } catch (err) { console.error('comprouDesde', err); return false }
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
  const evento = canonicalEvento(extractEvent(body))
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
    let body = parseRequestBody(req)
    // Postbacks via query string (ex.: "URL de postback" do Digistore24, com marcadores na URL).
    // Mescla os parâmetros da URL no payload (o body tem prioridade). Remove nossos webhookId/userId.
    if (req.query && typeof req.query === 'object') {
      const { webhookId: _w, userId: _u, ...qs } = req.query
      if (Object.keys(qs).length) body = { ...qs, ...body }
    }
    // ClickBank INS chega criptografado ({ notification, iv }) — decifra com a INS Secret Key do webhook.
    if (webhook.loja === 'clickbank' && body && body.notification && body.iv && webhook.insSecret) {
      const dec = decryptClickBankINS(body, webhook.insSecret)
      if (dec) body = dec
    }
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
    const evento = canonicalEvento(resolveEventoCustom(webhook.eventRules, body))

    // Cataloga o produto SEMPRE (mesmo sem regra que case), para aparecer em Produtos
    if (product.nome || product.id) {
      const prodDocId = product.id || product.nome.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
      if (prodDocId) {
        await db.collection('users').doc(userId).collection('products').doc(prodDocId).set(
          { nome: product.nome, kiwifyId: product.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        )
      }
    }

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

    const produtos = extractAllProdutos(body, fieldMap)
    await dispararAcoes(userId, leadRef, evento, customer, product, produtos)

    // Inscreve o contato em funis (e-mail e WhatsApp) cujo gatilho é este evento.
    // Dispara se QUALQUER produto do checkout (principal ou order bump) estiver no grupo do funil.
    try {
      const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
      const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const nomesCk = (produtos.nomes.length ? produtos.nomes : [product.nome]).filter(Boolean)
      const idsCk = (produtos.ids.length ? produtos.ids : [product.id]).filter(Boolean)
      const grupoOk = (funnel) => {
        if (!funnel.gatilhoGrupoId) return true
        const g = grupos.find((x) => x.id === funnel.gatilhoGrupoId)
        return g && Array.isArray(g.produtos) && g.produtos.some((p) => nomesCk.includes(p) || idsCk.includes(p))
      }
      if (customer.email) {
        const funisSnap = await db.collection('users').doc(userId).collection('emailFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        for (const fdoc of funisSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true || !grupoOk(funnel)) continue
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, nome: customer.nome, produto: product.nome }, 'email')
        }
      }
      if (customer.telefone) {
        const funisWaSnap = await db.collection('users').doc(userId).collection('whatsappFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        for (const fdoc of funisWaSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true || !grupoOk(funnel)) continue
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, telefone: customer.telefone, nome: customer.nome, produto: product.nome }, 'whatsapp')
        }
      }
    } catch (err) { console.error('Erro ao inscrever em funil:', err) }

    res.status(200).json({ ok: true, evento, leadId: leadRef.id })
  },
)

// ───────────────────────── Funil de e-mail: inscrição manual + motor ─────────────────────────

/** Inscreve uma lista manualmente num funil. */
exports.enrollFunnel = onCall({ region: 'us-central1', timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTermosAceito(request)
  const { funnelId, recipients, canal } = request.data || {}
  if (!funnelId) throw new HttpsError('invalid-argument', 'Escolha um funil.')
  const col = canal === 'whatsapp' ? 'whatsappFunnels' : canal === 'sms' ? 'smsFunnels' : 'emailFunnels'
  const fs = await db.doc(`users/${uid}/${col}/${funnelId}`).get()
  if (!fs.exists) throw new HttpsError('not-found', 'Funil não encontrado.')
  const funnel = fs.data()
  const inicio = nodeInicio(funnel)
  const primeiro = inicio ? proximoNode(funnel, inicio.id) : null
  if (!primeiro) throw new HttpsError('failed-precondition', 'O funil não tem passos após o Início.')
  const lista = Array.isArray(recipients) ? recipients : []
  let n = 0
  if (canal === 'whatsapp') {
    const validos = lista.filter((r) => r && String(r.telefone || '').replace(/\D/g, '').length >= 8).slice(0, 2000)
    for (const r of validos) {
      await inscreverNoFunil(uid, funnelId, funnel, { telefone: String(r.telefone).replace(/\D/g, ''), nome: r.nome || '' }, 'whatsapp')
      n++
    }
  } else if (canal === 'sms') {
    // SMS: só números internacionais (E.164). Ignora BR (+55) e inválidos.
    const validos = []
    for (const r of lista.slice(0, 2000)) {
      const norm = normalizarE164Internacional(r?.telefone || r?.numero || '')
      if (norm.ok) validos.push({ telefone: norm.e164, nome: r.nome || '' })
    }
    for (const r of validos) {
      await inscreverNoFunil(uid, funnelId, funnel, r, 'sms')
      n++
    }
  } else {
    const valido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
    const validos = lista.filter((r) => r && valido(r.email)).slice(0, 2000)
    for (const r of validos) {
      await inscreverNoFunil(uid, funnelId, funnel, { email: String(r.email).trim(), nome: r.nome || '' }, 'email')
      n++
    }
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
  const funnelCol = run.canal === 'whatsapp' ? 'whatsappFunnels' : run.canal === 'sms' ? 'smsFunnels' : 'emailFunnels'
  const key = `${userId}/${funnelCol}/${run.funnelId}`
  if (!(key in cache)) {
    const fs = await db.doc(`users/${userId}/${funnelCol}/${run.funnelId}`).get()
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
      if (run.canal === 'whatsapp') {
        if (node.data?.mensagem) {
          const ok = await enviarMensagemFunil(userId, node.data.mensagem, run.contato)
          try {
            await db.collection('users').doc(userId).collection('funnelSends').add({
              funnelId: run.funnelId, funnelNome: funnel.nome || '', nodeId: node.id, canal: 'whatsapp',
              contato: run.contato || {}, status: ok ? 'enviado' : 'erro',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          } catch (_) {}
        }
      } else if (run.canal === 'sms') {
        if (node.data?.mensagem) {
          const smsCanal = funnel.smsCanal === 'api' ? 'api' : 'eua' // conta EUA (nossa) ou API (do cliente)
          const ok = await enviarMensagemFunilSMS(userId, node.data.mensagem, run.contato, smsCanal)
          try {
            await db.collection('users').doc(userId).collection('funnelSends').add({
              funnelId: run.funnelId, funnelNome: funnel.nome || '', nodeId: node.id, canal: 'sms', smsCanal,
              contato: run.contato || {}, status: ok ? 'enviado' : 'erro',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          } catch (_) {}
        }
      } else if (node.data?.templateId) {
        const ok = await enviarTemplateFunil(userId, node.data.templateId, run.contato, [
          { name: 'funnelId', value: run.funnelId }, { name: 'tipo', value: 'funil' },
        ], node.data?.remetenteId || null)
        try {
          await db.collection('users').doc(userId).collection('funnelSends').add({
            funnelId: run.funnelId,
            funnelNome: funnel.nome || '',
            nodeId: node.id,
            templateId: node.data.templateId,
            templateNome: node.data.templateNome || '',
            contato: run.contato || {},
            status: ok ? 'enviado' : 'erro',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        } catch (_) {}
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
      const desde = run.enteredAt?.toMillis ? run.enteredAt.toMillis() : 0
      let ocorreu = false
      if (run.canal === 'whatsapp' || run.canal === 'sms') {
        ocorreu = await comprouDesde(userId, run.contato, desde)
      } else {
        const tipo = node.data?.evento || 'opened'
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
      }
      nodeId = proximoNode(funnel, nodeId, ocorreu ? 'sim' : 'nao')
      continue
    }

    nodeId = proximoNode(funnel, nodeId)
  }
  await runRef.update({ currentNodeId: nodeId || null, status: nodeId ? 'ativo' : 'concluido', nextRunAt: admin.firestore.Timestamp.now() })
}

// ───────────────────────── IA (Grok / xAI) ─────────────────────────
const GROK_API_KEY = process.env.GROK_API || ''
const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-latest'

async function callGrok(messages, { json = false } = {}) {
  if (!GROK_API_KEY) throw new HttpsError('failed-precondition', 'Chave do Grok não configurada (functions/.env → GROK_API).')
  const body = { model: GROK_MODEL, messages, temperature: 0.5 }
  if (json) body.response_format = { type: 'json_object' }
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error('Grok erro', res.status, text)
    let detalhe = text
    try { const j = JSON.parse(text); detalhe = j?.error?.message || j?.error || j?.msg || text } catch (_) {}
    throw new HttpsError('internal', `IA ${res.status}: ${String(detalhe).slice(0, 220)}`)
  }
  let data = {}
  try { data = JSON.parse(text) } catch { throw new HttpsError('internal', 'Resposta da IA inválida.') }
  return data?.choices?.[0]?.message?.content || ''
}

/** IA: analisa uma amostra de webhook e sugere fieldMap + eventRules. */
exports.aiMapFields = onCall({ region: 'us-central1', timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const { sample, eventos } = request.data || {}
  if (!sample || typeof sample !== 'object') throw new HttpsError('invalid-argument', 'Sem amostra para analisar.')
  const listaEventos = Array.isArray(eventos) ? eventos : []
  const eventosTxt = listaEventos.map((e) => `- ${e.id} (${e.label})`).join('\n')
  const sampleTxt = JSON.stringify(sample).slice(0, 8000)
  const content = await callGrok([
    { role: 'system', content: 'Você mapeia webhooks de checkout de vendas. Responda SOMENTE com JSON válido, sem texto extra.' },
    { role: 'user', content:
`Analise este JSON de webhook de um checkout e responda com os caminhos (dot notation, arrays com índice, ex: offers.0.name) de cada campo, e as regras que identificam cada evento de negócio.

JSON:
${sampleTxt}

Eventos válidos (use exatamente esses ids no campo "evento"):
${eventosTxt || '- order_status.purchase_approved (Compra Aprovada)'}

Responda no formato EXATO:
{
  "fieldMap": { "nome": "", "email": "", "telefone": "", "produto": "", "produtoId": "", "orderId": "", "valor": "" },
  "eventRules": [ { "path": "", "op": "equals", "value": "", "evento": "" } ]
}

Regras:
- fieldMap: caminho do campo no JSON (string vazia se não existir). "produto" = nome do produto (ex: offers.0.product.name ou offers.0.name), "valor" = valor total da compra (ex: amount).
- eventRules: para cada evento identificável, qual campo (path, ex: status ou event_type) + valor (value) o identifica. op pode ser "equals" ou "contains". Só inclua eventos que dá pra identificar pelo JSON.` },
  ], { json: true })
  let parsed = {}
  try { parsed = JSON.parse(content) } catch { throw new HttpsError('internal', 'Não consegui interpretar a resposta da IA.') }
  return { fieldMap: parsed.fieldMap || {}, eventRules: Array.isArray(parsed.eventRules) ? parsed.eventRules : [] }
})

/** IA: gera uma mensagem de WhatsApp para um evento/produto. */
exports.aiGenerateMessage = onCall({ region: 'us-central1', timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const { evento, produto, tom, idioma, checkouts } = request.data || {}
  const lang = idioma || 'Português do Brasil'
  const lista = Array.isArray(checkouts) ? checkouts.filter((c) => c && c.link) : []
  const checkoutsTxt = lista.length
    ? `\n\nLinks de checkout que DEVEM aparecer na mensagem (produto → link), com uma chamada pra ação clara:\n${lista.map((c) => `- ${c.nome || 'Produto'}: ${c.link}`).join('\n')}`
    : ''
  const content = await callGrok([
    { role: 'system', content: `Você é uma vendedora experiente e persuasiva de resposta direta. Usa gatilhos mentais (escassez, urgência, prova social, benefício claro, quebra de objeção) e copywriting que converte, sem parecer spam. Escreva SEMPRE no idioma: ${lang}.` },
    { role: 'user', content:
`Escreva UMA mensagem de WhatsApp de vendas para o evento "${evento || 'remarketing'}"${produto ? ` do produto "${produto}"` : ''}.
Idioma da mensagem: ${lang}.
Regras:
- Escreva TODA a mensagem em ${lang}.
- Use as variáveis {nome_cliente} e {nome_produto} exatamente assim (não traduza essas chaves).
- Tom ${tom || 'vendedora experiente, calorosa e persuasiva'}. Curta (3 a 6 linhas), com pelo menos 1 gatilho de venda.
- No máximo 2 emojis.
- Use *negrito* do WhatsApp (asteriscos) em 1-2 pontos-chave.${checkoutsTxt}
${lista.length ? '- Termine com uma CTA forte convidando a clicar no link.' : ''}
- Responda SOMENTE com a mensagem, sem aspas nem explicação.` },
  ])
  return { mensagem: (content || '').trim() }
})

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
}

// Busca metadados OpenGraph de uma URL (pra prévia estilo WhatsApp de link de checkout).
exports.linkPreview = onCall({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  let url = String(request.data?.url || '').trim()
  if (!url) throw new HttpsError('invalid-argument', 'URL vazia.')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  let domain = ''
  try { domain = new URL(url).hostname.replace(/^www\./, '') } catch { throw new HttpsError('invalid-argument', 'URL inválida.') }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.23)', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(12000),
    })
    const html = (await res.text()).slice(0, 500000)
    const pick = (props) => {
      for (const p of props) {
        const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, 'i')
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i')
        const m = html.match(re1) || html.match(re2)
        if (m && m[1] && m[1].trim()) return decodeEntities(m[1].trim())
      }
      return ''
    }
    let title = pick(['og:title', 'twitter:title'])
    if (!title) { const m = html.match(/<title[^>]*>([^<]+)<\/title>/i); title = m ? decodeEntities(m[1].trim()) : '' }
    const description = pick(['og:description', 'twitter:description', 'description'])
    let image = pick(['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'])
    if (image) {
      if (image.startsWith('//')) image = `https:${image}`
      else if (image.startsWith('/')) { try { image = new URL(image, url).href } catch { image = '' } }
    }
    return { url, domain, title, description, image }
  } catch (err) {
    return { url, domain, title: '', description: '', image: '', error: String(err?.message || err) }
  }
})

// ─────────────────────────────────────────────────────────────
// ADMIN — torre de comando (só josedeveloperjs@gmail.com)
// ─────────────────────────────────────────────────────────────

/** Lista todos os clientes (usuários do app) + status/plano/métricas do tenant. */
exports.adminListClientes = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  assertAdmin(request)
  const users = []
  let pageToken
  do {
    const res = await admin.auth().listUsers(1000, pageToken)
    for (const u of res.users) {
      users.push({
        uid: u.uid,
        email: u.email || '',
        nome: u.displayName || '',
        criadoEm: u.metadata?.creationTime || null,
        ultimoLogin: u.metadata?.lastSignInTime || null,
        disabled: !!u.disabled,
      })
    }
    pageToken = res.pageToken
  } while (pageToken)

  const gSnap = await db.doc('config/global').get()
  const enviosPausados = gSnap.exists ? gSnap.data().enviosPausados === true : false

  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
  const inicioMesMs = inicioMes.getTime()

  const clientes = []
  for (const c of users) {
    const ehAdmin = !!(c.email && c.email.toLowerCase() === ADMIN_EMAIL) // sua conta: aparece, mas somente leitura
    const tSnap = await db.doc(`tenants/${c.uid}`).get()
    const t = tSnap.exists ? tSnap.data() : {}

    // Métricas REAIS calculadas dos dados do cliente
    let enviadosTotal = 0, consumoMes = 0
    try {
      const ds = await db.collection(`users/${c.uid}/emailDisparos`).get()
      ds.forEach((d) => {
        const x = d.data(); const env = Number(x.enviados) || 0
        enviadosTotal += env
        const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0)
        if (cm >= inicioMesMs) consumoMes += env
      })
    } catch (_) {}
    let complained = 0, bounced = 0, leadsCount = 0
    try { complained = (await db.collection(`users/${c.uid}/emailEvents`).where('tipo', '==', 'complained').count().get()).data().count } catch (_) {}
    try { bounced = (await db.collection(`users/${c.uid}/emailEvents`).where('tipo', '==', 'bounced').count().get()).data().count } catch (_) {}
    try { leadsCount = (await db.collection(`users/${c.uid}/leads`).count().get()).data().count } catch (_) {}

    clientes.push({
      ...c,
      ehAdmin,
      status: t.status || 'approved',
      plano: t.plano || '',
      cotaMensal: t.cotaMensal || 0,
      consumoMes,
      enviadosTotal,
      leadsCount,
      complained,
      bounced,
      complaintRate: enviadosTotal > 0 ? (complained / enviadosTotal) * 100 : 0,
      bounceRate: enviadosTotal > 0 ? (bounced / enviadosTotal) * 100 : 0,
      risco: t.risco || null, // setor de risco: status/override/métricas do mês
      emailCreditos: Number(t.emailCreditos) || 0,
      smsCreditos: Number(t.smsCreditos) || 0,
      notas: t.notas || '',
    })
  }
  return { clientes, enviosPausados }
})

/**
 * Setor de risco (admin): 'play' = retoma e assume o risco (override — para de auto-pausar, mas continua
 * contando bounce/reclamação); 'pausar' = pausa manual; 'auto' = volta ao automático (remove override).
 */
exports.adminSetRiscoConta = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  const acao = String(request.data?.acao || '')
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  const ref = db.doc(`tenants/${uid}`)
  const snap = await ref.get()
  const r = (snap.exists && snap.data().risco) ? snap.data().risco : { mes: mesAtualStr(), entregues: 0, bounces: 0, reclamacoes: 0 }
  if (acao === 'play') { r.status = 'ativo'; r.override = true; r.overridePor = ADMIN_EMAIL; r.overrideEm = admin.firestore.Timestamp.now() }
  else if (acao === 'pausar') { r.status = 'pausado'; r.override = false; r.auto = false; r.motivo = 'pausa manual (admin)'; r.pausadoEm = admin.firestore.Timestamp.now() }
  else if (acao === 'auto') { r.override = false; r.status = 'ativo' }
  else throw new HttpsError('invalid-argument', 'ação inválida.')
  await ref.set({ risco: r }, { merge: true })
  return { ok: true, risco: r }
})

/** Detalhe de um cliente: últimos disparos de e-mail + contagem de leads. */
exports.adminGetClienteDetalhe = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  const tSnap = await db.doc(`tenants/${uid}`).get()
  const tenant = tSnap.exists ? tSnap.data() : {}

  let disparos = []
  try {
    const ds = await db.collection(`users/${uid}/emailDisparos`).orderBy('createdAt', 'desc').limit(8).get()
    disparos = ds.docs.map((d) => {
      const x = d.data()
      return {
        nome: x.nomeDisparo || x.nome || '—',
        total: x.total || 0,
        enviados: x.enviados || 0,
        status: x.status || '',
        aberturas: x.aberturas || 0,
        cliques: x.cliques || 0,
        createdAt: x.createdAt ? (x.createdAt.toMillis ? x.createdAt.toMillis() : x.createdAt) : null,
      }
    })
  } catch (_) {}

  let leadsCount = 0
  try { const lc = await db.collection(`users/${uid}/leads`).count().get(); leadsCount = lc.data().count } catch (_) {}

  // Reclamações e bounces recentes (com motivo) — evidência real da saúde de envio.
  // Ordena por data (índice de campo único, sem índice composto) e filtra em memória.
  let reclamacoes = []
  try {
    const rs = await db.collection(`users/${uid}/emailEvents`).orderBy('createdAt', 'desc').limit(300).get()
    reclamacoes = rs.docs
      .map((d) => d.data())
      .filter((x) => x.tipo === 'complained' || x.tipo === 'bounced')
      .slice(0, 20)
      .map((x) => ({
        tipo: x.tipo,
        email: x.email || '—',
        motivo: x.motivo || null,
        bounceTipo: x.bounceTipo || null,
        createdAt: x.createdAt ? (x.createdAt.toMillis ? x.createdAt.toMillis() : x.createdAt) : null,
      }))
  } catch (_) {}

  // WhatsApp: instâncias do cliente (pra ver quantas e desativar)
  let instances = []
  try {
    const is = await db.collection(`users/${uid}/instances`).get()
    instances = is.docs.map((d) => {
      const x = d.data()
      return { id: d.id, nome: x.nomeInstancia || x.nome || '—', numero: x.numeroWhatsapp || x.numeroWhatsApp || '', conectado: !!x.conectado, bloqueada: x.bloqueadaPorAdmin === true }
    })
  } catch (_) {}

  // Disparos de WhatsApp do cliente (linha do tempo)
  let waDisparos = []
  try {
    const ws = await db.collection(`users/${uid}/disparos`).orderBy('createdAt', 'desc').limit(60).get()
    waDisparos = ws.docs.map((d) => {
      const x = d.data()
      return {
        id: d.id,
        nome: x.nomeDisparo || x.nome || 'Disparo',
        total: x.total || 0,
        enviados: x.enviadosCount ?? x.enviados ?? 0,
        status: x.status || '',
        createdAt: x.createdAt ? (x.createdAt.toMillis ? x.createdAt.toMillis() : x.createdAt) : null,
      }
    })
  } catch (_) {}

  // Templates de WhatsApp (o que ele dispara) — com o texto pra policiar
  let msgTemplates = []
  try {
    const ms = await db.collection(`users/${uid}/messageTemplates`).limit(80).get()
    msgTemplates = ms.docs.map((d) => {
      const x = d.data()
      return { id: d.id, nome: x.nome || x.titulo || 'Sem nome', mensagem: String(x.mensagem || x.texto || x.copy || '').slice(0, 1200) }
    })
  } catch (_) {}

  // Templates de e-mail (nome + assunto)
  let emailTemplates = []
  try {
    const es = await db.collection(`users/${uid}/emailTemplates`).limit(60).get()
    emailTemplates = es.docs.map((d) => {
      const x = d.data()
      return { id: d.id, nome: x.nome || 'Sem nome', subject: x.subject || '', html: x.html || '', css: x.css || '', inlined: x.inlined || '' }
    })
  } catch (_) {}

  return { tenant, disparos, leadsCount, reclamacoes, instances, waDisparos, msgTemplates, emailTemplates }
})

/** Admin desativa/reativa uma instância de WhatsApp do cliente (bloqueia o uso no envio). */
exports.adminSetInstanciaBloqueada = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const { uid, instanceId, bloqueada } = request.data || {}
  if (!uid || !instanceId) throw new HttpsError('invalid-argument', 'uid e instanceId obrigatórios.')
  if (uid === request.auth?.uid) throw new HttpsError('permission-denied', 'A conta admin não pode ser alterada.')
  await db.doc(`users/${uid}/instances/${instanceId}`).set(
    { bloqueadaPorAdmin: !!bloqueada, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
  )
  return { ok: true, bloqueada: !!bloqueada }
})

/** Atualiza status/plano/cota/notas de um cliente (aprovar/pausar/banir). */
exports.adminUpdateCliente = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  const p = request.data?.patch || {}
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  if (uid === request.auth?.uid) throw new HttpsError('permission-denied', 'A conta admin não pode ser alterada.')
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  if (p.status && STATUS_VALIDOS.includes(p.status)) patch.status = p.status
  if (p.plano && ['free', 'inicial', 'padrao', 'pro'].includes(p.plano)) patch.plano = p.plano
  if (p.notas != null) patch.notas = String(p.notas).slice(0, 4000)
  if (p.overrides && typeof p.overrides === 'object') {
    const ov = {}
    if (p.overrides.limites && typeof p.overrides.limites === 'object') {
      ov.limites = {}
      for (const k of ['trackers', 'instancias', 'emailsMes', 'smsMes', 'dominios']) {
        if (p.overrides.limites[k] != null) ov.limites[k] = Math.max(0, Number(p.overrides.limites[k]) || 0)
      }
    }
    if (p.overrides.features && typeof p.overrides.features === 'object') {
      ov.features = {}
      for (const k of Object.keys(p.overrides.features)) ov.features[k] = !!p.overrides.features[k]
    }
    patch.overrides = ov
  }
  if (patch.status === 'approved') patch.aprovadoEm = admin.firestore.FieldValue.serverTimestamp()
  await db.doc(`tenants/${uid}`).set(patch, { merge: true })
  return { ok: true }
})

/** Kill switch global: pausa/religa TODOS os envios. */
exports.adminSetKillSwitch = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const pausar = request.data?.pausar === true
  await db.doc('config/global').set({ enviosPausados: pausar, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true, enviosPausados: pausar }
})

/** Lê a config do onboarding Kiwify (+ produtos já vistos pelos webhooks, pra facilitar o mapeamento). */
exports.adminGetKiwifyConfig = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const snap = await db.doc('config/kiwify').get()
  const cfg = snap.exists ? snap.data() : {}
  return {
    produtos: cfg.produtos || {},
    produtosVistos: cfg.produtosVistos || {},
    fromEmail: cfg.fromEmail || '',
    fromName: cfg.fromName || '',
    appUrl: cfg.appUrl || '',
    webhookToken: cfg.webhookToken || '',
  }
})

/** Salva a config do onboarding Kiwify. */
exports.adminSetKiwifyConfig = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const d = request.data || {}
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  if (d.produtos && typeof d.produtos === 'object') {
    const map = {}
    for (const [k, v] of Object.entries(d.produtos)) {
      const key = String(k).trim()
      if (key && ['inicial', 'padrao', 'pro'].includes(v)) map[key] = v
    }
    patch.produtos = map
  }
  if (d.fromEmail != null) patch.fromEmail = String(d.fromEmail).trim()
  if (d.fromName != null) patch.fromName = String(d.fromName).trim().slice(0, 80)
  if (d.appUrl != null) patch.appUrl = String(d.appUrl).trim()
  if (d.webhookToken != null) patch.webhookToken = String(d.webhookToken).trim()
  await db.doc('config/kiwify').set(patch, { merge: true })
  return { ok: true }
})

/** Lista os 3 planos do Stripe (nome/preço) a partir dos Price IDs do .env — só leitura, pro admin ver. */
exports.adminStripePlanos = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return { planos: [], configurado: false }
  const stripe = require('stripe')(key)
  const mapa = [['inicial', process.env.STRIPE_PRICE_INICIAL], ['padrao', process.env.STRIPE_PRICE_PADRAO], ['pro', process.env.STRIPE_PRICE_PRO]]
  const planos = []
  for (const [plano, priceId] of mapa) {
    if (!priceId) { planos.push({ plano, priceId: null, erro: 'sem price id no .env' }); continue }
    try {
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] })
      planos.push({
        plano, priceId,
        produtoNome: price.product?.name || null,
        valor: price.unit_amount != null ? price.unit_amount / 100 : null,
        moeda: (price.currency || 'brl').toUpperCase(),
        intervalo: price.recurring?.interval || null,
        ativo: price.active !== false,
      })
    } catch (e) { planos.push({ plano, priceId, erro: e.message || 'erro ao buscar' }) }
  }
  return { planos, configurado: true }
})

/** Reembolsa a assinatura VIGENTE (última fatura, 1 mês) via Stripe, cancela a assinatura e volta o cliente pro Free. */
exports.adminReembolsarCliente = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  if (uid === request.auth?.uid) throw new HttpsError('permission-denied', 'A conta admin não pode ser reembolsada.')
  const key = process.env.STRIPE_SECRET_KEY
  const tSnap = await db.doc(`tenants/${uid}`).get()
  const t = tSnap.exists ? tSnap.data() : {}
  let reembolsado = false, cancelado = false, valor = null, motivo = null
  if (key && (t.stripeSubscriptionId || t.stripeCustomerId)) {
    const stripe = require('stripe')(key)
    try {
      let paymentIntentId = null
      if (t.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(t.stripeSubscriptionId, { expand: ['latest_invoice.payment_intent'] })
          paymentIntentId = sub.latest_invoice?.payment_intent?.id || null
        } catch (e) { console.error('retrieve sub', e) }
        try { await stripe.subscriptions.cancel(t.stripeSubscriptionId); cancelado = true } catch (e) { console.error('cancel sub', e) }
      }
      if (!paymentIntentId && t.stripeCustomerId) {
        const pis = await stripe.paymentIntents.list({ customer: t.stripeCustomerId, limit: 10 })
        const paid = (pis.data || []).find((p) => p.status === 'succeeded' && (p.amount_received || 0) > 0)
        paymentIntentId = paid?.id || null
      }
      if (paymentIntentId) {
        const refund = await stripe.refunds.create({ payment_intent: paymentIntentId })
        reembolsado = true
        valor = refund.amount != null ? refund.amount / 100 : null
      } else {
        motivo = 'nenhum pagamento encontrado para reembolsar'
      }
    } catch (e) { motivo = e.message || 'erro no reembolso'; console.error('reembolso stripe', e) }
  } else {
    motivo = 'cliente sem assinatura Stripe'
  }
  // Volta pro Free (desativa as funções dos planos pagos)
  await db.doc(`tenants/${uid}`).set({
    plano: 'free',
    reembolso: { em: admin.firestore.FieldValue.serverTimestamp(), por: ADMIN_EMAIL, valor, reembolsado, cancelado },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, reembolsado, cancelado, valor, motivo }
})

// ─────────────────────────────────────────────────────────────
// 2FA do admin (TOTP / Google Authenticator) — leve, sem Identity Platform
// ─────────────────────────────────────────────────────────────
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32Decode(str) {
  let bits = ''; const out = []
  str = String(str || '').replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  for (const c of str) { const v = B32_ALPHABET.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0') }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.substr(i, 8), 2))
  return Buffer.from(out)
}
function totpAt(secretB32, offset = 0) {
  const key = base32Decode(secretB32)
  let counter = Math.floor(Date.now() / 1000 / 30) + offset
  const buf = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256) }
  const h = crypto.createHmac('sha1', key).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}
function totpValido(secret, code) {
  code = String(code || '').replace(/\D/g, '')
  if (code.length !== 6 || !secret) return false
  return [-1, 0, 1].some((off) => totpAt(secret, off) === code)
}
function randomBase32(len = 32) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += B32_ALPHABET[bytes[i] % 32]
  return out
}

exports.admin2faStatus = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const s = await db.doc('config/adminSecurity').get()
  return { enrolled: !!(s.exists && s.data().enrolled) }
})

exports.admin2faSetup = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const secret = randomBase32(32)
  await db.doc('config/adminSecurity').set({ pendingSecret: secret, enrolled: false }, { merge: true })
  const email = request.auth?.token?.email || 'admin'
  const otpauth = `otpauth://totp/Autsend:${encodeURIComponent(email)}?secret=${secret}&issuer=Autsend&period=30&digits=6`
  return { secret, otpauth }
})

exports.admin2faConfirm = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const s = await db.doc('config/adminSecurity').get()
  const sec = s.exists && s.data().pendingSecret
  if (!sec) throw new HttpsError('failed-precondition', 'Gere a chave primeiro.')
  if (!totpValido(sec, request.data?.code)) throw new HttpsError('invalid-argument', 'Código inválido. Confira o horário do celular.')
  await db.doc('config/adminSecurity').set({ secret: sec, enrolled: true, pendingSecret: admin.firestore.FieldValue.delete() }, { merge: true })
  return { ok: true }
})

exports.admin2faVerify = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const s = await db.doc('config/adminSecurity').get()
  if (!(s.exists && s.data().enrolled)) return { ok: true, enrolled: false }
  if (!totpValido(s.data().secret, request.data?.code)) throw new HttpsError('permission-denied', 'Código inválido.')
  return { ok: true, enrolled: true }
})

exports.admin2faDisable = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const s = await db.doc('config/adminSecurity').get()
  if (s.exists && s.data().enrolled && !totpValido(s.data().secret, request.data?.code)) {
    throw new HttpsError('permission-denied', 'Código inválido.')
  }
  await db.doc('config/adminSecurity').set({ enrolled: false, secret: admin.firestore.FieldValue.delete() }, { merge: true })
  return { ok: true }
})

// ─────────────────────────────────────────────────────────────
// Planos + impersonação
// ─────────────────────────────────────────────────────────────

/** Plano/limites/status do próprio usuário logado (pra o front travar features). */
exports.getMeuPlano = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const s = await db.doc(`tenants/${uid}`).get()
  const t = s.exists ? s.data() : {}
  const isAdm = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  // Sem plano = Free (o admin define Padrão/Pro). Nada é deletado; o excedente fica congelado.
  const plano = t.plano || 'free'
  // Tem conta Telnyx própria conectada? (pro menu mostrar o subgrupo API de SMS)
  let temSmsApi = false
  try { const p = await db.collection(`users/${uid}/smsProviders`).limit(1).get(); temSmsApi = !p.empty } catch (_) {}
  return {
    plano, status: t.status || 'approved', overrides: t.overrides || null,
    mustChangePassword: !!t.mustChangePassword, isAdmin: isAdm,
    termosAceito: !!(t.termos && t.termos.aceito),
    nome: t.nome || (request.auth?.token?.name || '') || '',
    documento: t.documento || '',
    email: t.email || (request.auth?.token?.email || '') || '',
    fotoURL: t.fotoURL || null,
    temSmsApi,
  }
})

/** Registra o aceite do Termo de Uso do tenant (IP no servidor + geo do navegador). Salva no painel admin. */
exports.aceitarTermos = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const d = request.data || {}
  const raw = request.rawRequest
  const ip = (raw?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()) || raw?.ip || raw?.connection?.remoteAddress || null
  const geo = (d.geo && typeof d.geo === 'object') ? {
    lat: Number(d.geo.lat) || null, lng: Number(d.geo.lng) || null,
    precisao: Number(d.geo.precisao) || null, negado: !!d.geo.negado,
  } : { negado: true }
  await db.doc(`tenants/${uid}`).set({
    termos: {
      aceito: true,
      versao: String(d.versao || '1'),
      aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
      ip: ip || null,
      geo,
      userAgent: String(raw?.headers?.['user-agent'] || '').slice(0, 400),
      nome: String(d.nome || '').slice(0, 200),
      documento: String(d.documento || '').slice(0, 40),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true }
})

/** Admin gera um token pra ENTRAR COMO o cliente (impersonação segura, sem senha). */
exports.adminImpersonar = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  if (uid === request.auth?.uid) throw new HttpsError('permission-denied', 'Você já está logado como admin.')
  try {
    const token = await admin.auth().createCustomToken(uid, { impersonatedBy: ADMIN_EMAIL })
    return { token }
  } catch (err) {
    console.error('adminImpersonar/createCustomToken falhou:', err)
    // Causa mais comum: a service account das functions não tem a role "Service Account Token Creator".
    throw new HttpsError('internal', `Falha ao gerar token: ${err.message}. Provável falta da role 'Service Account Token Creator' na service account das functions.`)
  }
})

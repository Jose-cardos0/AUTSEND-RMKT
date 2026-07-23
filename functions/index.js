const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { setGlobalOptions } = require('firebase-functions/v2')
const crypto = require('crypto')
const admin = require('firebase-admin')
admin.initializeApp()

// Anti-DDoS/custo: teto GLOBAL de instâncias por função. O Cloud Functions gen2 escala "sem limite" por
// padrão — um flood viraria conta gigante. 40 cobre folgado o uso legítimo (crons + disparos sequenciais +
// bulk). Webhooks públicos SEM auth têm teto menor (maxInstances por função). Não afeta latência normal.
setGlobalOptions({ maxInstances: 40 })

const db = admin.firestore()

const N8N_REMARKETING_URL = 'https://n8n.autsend.online/webhook/remarketing'

// Chave do Header Auth dos webhooks do n8n (WF1/WF3/WF4). SÓ server-side — nunca vai pro browser.
const N8N_WEBHOOK_KEY = process.env.N8N_WEBHOOK_KEY || '3AROGwIPRAXlurqT415UvMoXTmBZNYOv'
/** Headers pra chamar o n8n: JSON + a chave secreta (x-autsend-key). */
function n8nHeaders(extra) { return { 'Content-Type': 'application/json', 'x-autsend-key': N8N_WEBHOOK_KEY, ...(extra || {}) } }

// ── Admin (torre de comando) ──
const ADMIN_EMAIL = 'josedeveloperjs@gmail.com'
const STATUS_VALIDOS = ['pending', 'approved', 'paused', 'banned']

// UID do admin — resolvido 1x do Firebase Auth e cacheado em memória. Usado onde NÃO há token de auth
// (webhooks WAHA/n8n): isenta o admin de travas sem depender do campo `email` do doc do tenant (que pode estar vazio).
let _adminUidCache = null
async function ehAdminUid(uid) {
  if (!uid) return false
  // Cacheia só o SUCESSO — falha transitória de Auth não pode "grudar" o admin como não-admin.
  if (!_adminUidCache) {
    try { const u = await admin.auth().getUserByEmail(ADMIN_EMAIL); if (u?.uid) _adminUidCache = u.uid } catch (_) { /* tenta de novo na próxima chamada */ }
  }
  return !!_adminUidCache && uid === _adminUidCache
}

/**
 * Rate limit por tenant+ação (janela deslizante, 1 doc por par em tenants/{uid}/rateLimits/{acao}).
 * Protege os endpoints que gastam dinheiro (IA/Grok, disparo, ligação) de abuso por conta comprometida.
 * Admin é isento. Lança resource-exhausted (429-like) ao estourar.
 */
async function assertRateLimit(request, acao, maxPorJanela, janelaMs = 60000) {
  const uid = request.auth?.uid
  if (!uid) return
  if ((request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL) return // admin isento
  const agora = Date.now()
  const ref = db.doc(`tenants/${uid}/rateLimits/${acao}`)
  let excedeu = false
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref)
    const d = s.exists ? s.data() : {}
    if (!d.inicio || agora - Number(d.inicio) >= janelaMs) {
      tx.set(ref, { inicio: agora, n: 1 }, { merge: true })
    } else {
      const n = (Number(d.n) || 0) + 1
      if (n > maxPorJanela) excedeu = true; else tx.set(ref, { n }, { merge: true })
    }
  })
  if (excedeu) throw new HttpsError('resource-exhausted', 'Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.')
}

/** Bloqueia URLs internas/privadas (anti-SSRF) — só http(s) público. */
function urlPublicaSegura(u) {
  let parsed
  try { parsed = new URL(u) } catch { return false }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const h = parsed.hostname.toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return false
  // IPs privados / loopback / link-local / metadata
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false
  return true
}

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
  // callMin = minutos de Ligação IA grátis por mês (pagos por nós, isca). Editável via overrides.
  // iaMes = criações/edições de e-mail com IA (Grok) no construtor, por mês.
  // atendentes = bots de IA no WhatsApp (Central de Atendentes / Vendedor IA). 1 por produto e 1 por instância;
  // cada instância avulsa comprada libera +1 atendente (somado abaixo).
  // conversasMes = conversas do Vendedor IA por mês (1 conversa = 1 lead atendido no mês). Crédito antes da cota.
  free: { trackers: 1, instancias: 0, emailsMes: 50, smsMes: 0, dominios: 0, callMin: 0, iaMes: 0, atendentes: 0, conversasMes: 0 },
  inicial: { trackers: 2, instancias: 1, emailsMes: 500, smsMes: 200, dominios: 1, callMin: 5, iaMes: 30, atendentes: 1, conversasMes: 100 },
  padrao: { trackers: 10, instancias: 2, emailsMes: 2500, smsMes: 500, dominios: 1, callMin: 10, iaMes: 100, atendentes: 2, conversasMes: 200 },
  pro: { trackers: 20, instancias: 4, emailsMes: 5000, smsMes: 1000, dominios: 2, callMin: 15, iaMes: 200, atendentes: 3, conversasMes: 300 },
}
function limitesDoTenant(t) {
  const plano = t && PLAN_LIMITS[t.plano] ? t.plano : 'free'
  const ov = (t && t.overrides && t.overrides.limites) || {}
  const merged = { plano, ...PLAN_LIMITS[plano], ...ov }
  // Instâncias avulsas compradas (assinatura R$29,90/mês cada) somam ao limite do plano/override.
  const extras = Number(t && t.instanciasExtras) || 0
  merged.instancias = (Number(merged.instancias) || 0) + extras
  // Comprar instância libera +1 atendente (a sacada comercial: 1 atendente por instância).
  merged.atendentes = (Number(merged.atendentes) || 0) + extras
  // Vendedor IA avulso (assinatura R$45/mês): +1 slot de vendedor por unidade (só o slot; conversas à parte).
  const vend = Number(t && t.vendedoresExtras) || 0
  merged.atendentes = (Number(merged.atendentes) || 0) + vend
  return merged
}

// Teto de mensagens do vendedor por conversa/mês — trava o custo de uma conversa que vira "textão eterno".
const TETO_MSGS_CONVERSA = Math.max(1, Number(process.env.TETO_MSGS_CONVERSA) || 40)

/**
 * Trava de CONVERSA do Vendedor IA: 1 conversa = 1 lead atendido no mês. Crédito comprado é
 * consumido ANTES da cota do plano (crédito não expira; cota zera no mês) — igual ao SMS.
 * NÃO consome aqui (só decide); a consumição é aplicada pelo chamador após a IA responder de fato.
 * @returns {{ ok: boolean, fonte?: 'admin'|'credito'|'quota' }}
 */
function decidirCotaConversa(uid, tenant) {
  if (tenant?.email && String(tenant.email).toLowerCase() === ADMIN_EMAIL) return { ok: true, fonte: 'admin' }
  const lim = limitesDoTenant(tenant)
  const creditos = Number(tenant?.conversaCreditos) || 0
  const quotaUsada = Number(tenant?.conversaUso?.[mesAtualStr()] || 0)
  const restanteQuota = Math.max(0, (Number(lim.conversasMes) || 0) - quotaUsada)
  if (creditos + restanteQuota <= 0) return { ok: false }
  return { ok: true, fonte: creditos > 0 ? 'credito' : 'quota' }
}

/** Aplica a consumição de 1 conversa no tenant (crédito primeiro; senão cota do mês). */
async function consumirConversa(uid, fonte) {
  if (fonte === 'credito') {
    await db.doc(`tenants/${uid}`).set({ conversaCreditos: admin.firestore.FieldValue.increment(-1) }, { merge: true })
  } else if (fonte === 'quota') {
    await db.doc(`tenants/${uid}`).set({ conversaUso: { [mesAtualStr()]: admin.firestore.FieldValue.increment(1) } }, { merge: true })
  }
}

/**
 * Trava de CONTAGEM de recurso (instâncias, trackers, domínios…). Garante que criar +1 não estoura
 * o limite EFETIVO (plano base + overrides do admin). O e-mail admin é isento (ilimitado).
 * @param {object} request  onCall request (pra ler o e-mail e detectar admin)
 * @param {object} tenant   doc do tenant (já carregado; contém overrides)
 * @param {string} chave    chave do limite: 'instancias' | 'trackers' | 'dominios' | ...
 * @param {number} atual    quantos o cliente já tem
 * @param {string} rotulo   texto amigável pro erro (ex.: 'instância(s) de WhatsApp')
 */
function assertPodeCriarRecurso(request, tenant, chave, atual, rotulo) {
  const email = (request.auth?.token?.email || '').toLowerCase()
  if (email === ADMIN_EMAIL) return // admin não tem limite
  const lim = limitesDoTenant(tenant)
  const limite = Number(lim[chave])
  if (!Number.isFinite(limite)) return // sem limite definido → não trava
  if (atual >= limite) {
    throw new HttpsError('resource-exhausted', limite === 0
      ? `Seu plano não inclui ${rotulo}. Faça upgrade pra ativar.`
      : `Seu plano permite ${limite} ${rotulo}. Faça upgrade pra criar mais.`)
  }
}

// Webhook do Evolution (n8n) — espelho de src/lib/constants.js. Usado pela trava de criação de instância.
const WEBHOOK_EVOLUTION = process.env.WEBHOOK_EVOLUTION || 'https://n8n.autsend.online/webhook/instancia-waha'

/**
 * Log de FATURAMENTO por cliente (append-only) — histórico de TUDO que gera custo/receita:
 * compras (créditos SMS/e-mail/ligação, instância, número), mudança de plano, reembolso, chargeback, cancelamento.
 * REGRA: toda coisa paga nova (ex.: SMS Brasil futuro) DEVE chamar isto no webhook. Ver memória [[faturamento-log]].
 * @param {string} uid
 * @param {{tipo:string, descricao?:string, quantidade?:number, valor?:number, stripeId?:string}} entry
 *   tipo: 'credito_sms'|'credito_email'|'credito_call'|'instancia'|'numero'|'plano'|'reembolso'|'chargeback'|'cancelamento'
 *   valor em R$ (NEGATIVO em reembolso/chargeback). stripeId dá idempotência (vira o id do doc).
 */
/**
 * CUSTO UNITÁRIO estimado (R$) das ferramentas por uso — usado no CRM de margem (aba Gastos).
 * ⚠️ São ESTIMATIVAS: ajuste conforme suas faturas reais. Ver memória [[gastos-crm]].
 * email = Resend por e-mail · sms = Telnyx por SMS · callMin = Telnyx por min de ligação ·
 * ia = Grok (grok-code-fast-1) por uso do construtor · instanciaMes = R$2,00 por instância/mês.
 */
// Valores reais (jul/2026, câmbio ~R$5,15/USD) cruzados com nossos cálculos anteriores:
// - Resend ~$0,0009/e-mail → R$0,004
// - Telnyx SMS toll-free ~$0,008 → R$0,045
// - Ligação IA all-in ~R$0,12/min: Telnyx voz (~R$0,04) + ElevenLabs multilingual_v2 (~R$0,34/300chars,
//   mas com cache de MP3 por frase cai p/ ~R$0,06/ligação) + Grok roteiro. Margem ~92% a R$1,50/min.
// - Grok IA construtor (chat multi-turn, grok-4.1-fast) → R$0,04/uso.
const CUSTOS_UNIT = {
  email: Number(process.env.CUSTO_EMAIL) || 0.004,
  sms: Number(process.env.CUSTO_SMS) || 0.045, // Telnyx (EUA)
  smsBr: Number(process.env.CUSTO_SMS_BR) || 0.10, // SMSDev (Brasil ~R$0,08–0,11)
  callMin: Number(process.env.CUSTO_CALL_MIN) || 0.12,
  ia: Number(process.env.CUSTO_IA) || 0.04,
  instanciaMes: Number(process.env.CUSTO_INSTANCIA_MES) || 2.0,
}

async function registrarFaturamento(uid, entry) {
  if (!uid || !entry || !entry.tipo) return
  try {
    const doc = {
      tipo: entry.tipo,
      descricao: entry.descricao || '',
      quantidade: entry.quantidade != null ? Number(entry.quantidade) : null,
      valor: entry.valor != null ? Number(entry.valor) : null,
      stripeId: entry.stripeId || null,
      em: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (entry.stripeId) await db.doc(`tenants/${uid}/faturamento/${entry.stripeId}`).set(doc, { merge: true })
    else await db.collection(`tenants/${uid}/faturamento`).add(doc)
  } catch (e) { console.error('registrarFaturamento', e) }
}

/**
 * Palavras que sinalizam GOLPE/phishing/impersonação em disparos. Dual-use (marketing usa algumas),
 * por isso NÃO bloqueia — só registra em securityLogs pro admin conferir manualmente. Ajustável.
 */
const SCAM_WORDS = [
  'conta bloqueada', 'conta suspensa', 'conta sera suspensa', 'regularize', 'regularizar', 'recadastr',
  'atualize seus dados', 'confirme seus dados', 'confirmar dados', 'dados bancarios', 'sua senha', 'informe a senha',
  'codigo de verificacao', 'codigo de seguranca', 'numero do cartao', 'cvv', 'validade do cartao',
  'cpf bloqueado', 'cpf suspenso', 'cpf irregular', 'cpf na justica', 'serasa', 'spc brasil', 'receita federal',
  'banco central', 'pix premiado', 'voce ganhou', 'voce foi contemplado', 'voce foi sorteado', 'resgate seu premio',
  'ultima chance', 'clique aqui agora', 'clique imediatamente', 'verifique sua conta', 'emprestimo aprovado',
  'renda extra garantida', 'investimento garantido', 'lucro garantido', 'dobre seu dinheiro', 'multiplique seu',
  'indenizacao', 'beneficio liberado', 'saque liberado', 'fgts liberado', 'auxilio liberado',
  'nubank', 'caixa economica', 'bradesco', 'itau', 'santander', 'mercado pago', 'banco do brasil', 'whatsapp premiado',
]

/**
 * Varre o conteúdo de um disparo por palavras de golpe/phishing. NÃO bloqueia — se achar, grava em
 * securityLogs pro admin revisar (tato humano). @param canal 'email' | 'sms'
 */
async function scanConteudoRisco(uid, tenant, canal, texto, meta = {}) {
  try {
    const t = String(texto || '').toLowerCase()
    if (!t) return
    const achadas = SCAM_WORDS.filter((w) => t.includes(w))
    if (achadas.length === 0) return
    await db.collection('securityLogs').add({
      tipo: 'conteudo', uid, nome: tenant?.nome || '', email: tenant?.email || '',
      canal, palavras: achadas.slice(0, 20), amostra: String(texto).slice(0, 240),
      ref: meta.ref || null, em: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (e) { console.error('scanConteudoRisco', e) }
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
    // Aliases curtos usados no editor de WhatsApp/disparo (ex.: {nome})
    .replace(/\{nome\}/gi, lead.nome || '')
    .replace(/\{telefone\}/gi, lead.telefone || '')
    .replace(/\{numero\}/gi, lead.telefone || '')
    .replace(/\{email\}/gi, lead.email || '')
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
exports.sendBulkEmail = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB', enforceAppCheck: true }, async (request) => {
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

  // Contador server-only de cota (à prova de adulteração — o cliente não escreve em tenants/).
  const quotaConsumida = usaContaCompartilhada && !ehAdminEmail ? Math.max(0, validos.length - creditoAConsumir) : 0
  if (quotaConsumida > 0) {
    await db.doc(`tenants/${uid}`).set({ emailUso: { [mesAtualStr()]: admin.firestore.FieldValue.increment(quotaConsumida) } }, { merge: true })
  }

  // Fiscalização de conteúdo (não bloqueia — só registra pro admin).
  await scanConteudoRisco(uid, tenant, 'email', `${baseSubject} ${htmlToText(tpl.inlined || tpl.html || '')}`, { ref: dispRef.id })

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

/** Mensagem legível pro motivo de rejeição do normalizarE164 (mostrada no relatório). */
function motivoNumeroInvalido(motivo) {
  switch (motivo) {
    case 'vazio': return 'Número não informado'
    case 'brasil': return 'Número do Brasil — o canal EUA não envia para +55 (use o canal API)'
    case 'tamanho': return 'Número inválido — verifique o DDI e a quantidade de dígitos (ex.: +1 seguido de 10 dígitos)'
    default: return 'Número inválido'
  }
}

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
    ds.forEach((d) => { const x = d.data(); if (x.canal === 'brl') return; const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicio.getTime()) total += Number(x.enviados) || 0 })
  } catch (_) {}
  return total
}

/** SMS BRASIL (canal 'brl') enviados no mês. */
async function smsBrEnviadosNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let total = 0
  try {
    const ds = await db.collection(`users/${uid}/smsDisparos`).get()
    ds.forEach((d) => { const x = d.data(); if (x.canal !== 'brl') return; const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicio.getTime()) total += Number(x.enviados) || 0 })
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
      if (x.canal === 'brl') return // SMS Brasil é crédito-only (SMSDev), não consome a cota EUA do plano
      const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0)
      if (cm >= inicio.getTime()) {
        const totalDisp = Number(x.total) || 0
        const credito = Number(x.creditoConsumido) || 0
        quota += Math.max(0, totalDisp - credito)
      }
    })
  } catch (_) {}
  try {
    const s = await db.doc(`tenants/${uid}`).get()
    const contador = Number((s.exists ? s.data() : {})?.smsUso?.[mesAtualStr()]) || 0
    return Math.max(quota, contador)
  } catch (_) { return quota }
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

/**
 * Envia 1 SMS via SMSDev (Brasil). `to` = E.164 (+55DDDNUM); SMSDev quer só dígitos (55DDDNUM).
 * type=9 é o envio padrão. Sem acento (economiza crédito: 160 chars/crédito). Retorna { ok, id } ou lança.
 */
async function enviarSMSDev(key, to, text) {
  const number = String(to || '').replace(/\D/g, '') // 5511999999999
  const msg = semAcentos(text).slice(0, 160)
  const url = `https://api.smsdev.com.br/v1/send?key=${encodeURIComponent(key)}&type=9&number=${encodeURIComponent(number)}&msg=${encodeURIComponent(msg)}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (String(data?.situacao || '').toUpperCase() !== 'OK') {
    throw new Error(data?.descricao || `SMSDev HTTP ${res.status}`)
  }
  return { ok: true, id: data?.id || null }
}

/**
 * Envia um LOTE de SMS Brasil (SMSDev), sequencial. Debita 1 crédito BR por enviado (exceto admin).
 * Retorna { enviados, erros, erroMotivo }.
 */
async function enviarLoteSMSDev(uid, smsdevKey, mensagem, recipients, ehAdm, propria, disparoId) {
  let enviados = 0, erros = 0, erroMotivo = null
  for (const v of (recipients || [])) {
    try {
      const texto = replaceVariables(mensagem, { nome: v.nome || '', telefone: v.telefone, email: '' }, { nome: v.produto || '' })
      const out = await enviarSMSDev(smsdevKey, v.telefone, texto)
      enviados++
      // Rastreio de entrega (DLR): grava a msg + índice id→uid pro smsdevWebhook atualizar depois.
      if (out.id) {
        try {
          await db.doc(`users/${uid}/smsMensagens/${out.id}`).set({ disparoId: disparoId || null, to: v.telefone, canal: 'brl', status: 'enviado', createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
          await db.doc(`smsdevIndex/${out.id}`).set({ uid }, { merge: true })
        } catch (_) {}
      }
    } catch (e) { erros++; erroMotivo = (e?.message || String(e)).slice(0, 300); console.error('enviarSMSDev', erroMotivo) }
  }
  if (!ehAdm && !propria && enviados > 0) await db.doc(`tenants/${uid}`).set({ smsBrCreditos: admin.firestore.FieldValue.increment(-enviados) }, { merge: true })
  return { enviados, erros, erroMotivo }
}

/** Provedor SMSDev PRÓPRIO (BYO) do cliente: o principal, ou o primeiro. */
async function getSmsdevProviderCliente(uid) {
  try {
    const snap = await db.collection(`users/${uid}/smsdevProviders`).get()
    if (snap.empty) return null
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    return docs.find((d) => d.principal === true) || docs[0]
  } catch (_) { return null }
}

/**
 * Resolve QUAL conta SMSDev usar pro envio BR: a PRÓPRIA do cliente (BYO) tem prioridade;
 * senão a NOSSA (SMSDEV_API_KEY). `propria:true` = não debita smsBrCreditos (é a conta dele).
 */
async function resolverSmsBrEnvio(uid) {
  const prov = await getSmsdevProviderCliente(uid)
  if (prov && prov.apiKey) return { key: prov.apiKey, propria: true }
  const shared = process.env.SMSDEV_API_KEY
  if (shared) return { key: shared, propria: false }
  return { erro: 'SMS Brasil ainda não configurado.' }
}

/** Máscara da key pra exibir sem expor. */
function mascararKey(k) { const s = String(k || ''); return s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-4)}` }

/** BYO SMSDev: conecta a conta SMSDev PRÓPRIA do cliente (valida a key pelo saldo). */
exports.smsdevAddProvider = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTenantAtivo(uid)
  const apiKey = String(request.data?.apiKey || '').trim()
  const nome = String(request.data?.nome || 'Minha conta SMSDev').trim().slice(0, 60)
  if (apiKey.length < 20) throw new HttpsError('invalid-argument', 'Chave SMSDev inválida (muito curta).')
  // Valida a chave no SMSDev (consulta de saldo).
  try {
    const res = await fetch(`https://api.smsdev.com.br/v1/balance?key=${encodeURIComponent(apiKey)}&action=saldo`)
    const txt = await res.text()
    if (/NAO AUTENTICADO|"situacao"\s*:\s*"ERRO"/i.test(txt)) throw new Error('Chave não autenticada no SMSDev. Confira a Chave Key no painel deles.')
  } catch (e) { throw new HttpsError('failed-precondition', e.message || 'Não consegui validar a chave no SMSDev.') }
  const existentes = await db.collection(`users/${uid}/smsdevProviders`).limit(1).get()
  const ref = await db.collection(`users/${uid}/smsdevProviders`).add({
    apiKey, nome, principal: existentes.empty, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
})

/** Lista as contas SMSDev próprias do cliente (key mascarada). */
exports.smsdevListProviders = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const snap = await db.collection(`users/${uid}/smsdevProviders`).get()
  const provedores = snap.docs.map((d) => { const x = d.data(); return { id: d.id, nome: x.nome || 'SMSDev', principal: !!x.principal, apiKeyMasked: mascararKey(x.apiKey) } })
  provedores.sort((a, b) => Number(b.principal) - Number(a.principal))
  return { provedores }
})

/** Define qual conta SMSDev é a principal (usada nos envios BR). */
exports.smsdevSetPrincipal = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  const snap = await db.collection(`users/${uid}/smsdevProviders`).get()
  const batch = db.batch()
  snap.docs.forEach((d) => batch.set(d.ref, { principal: d.id === id }, { merge: true }))
  await batch.commit()
  return { ok: true }
})

/** Remove uma conta SMSDev própria. */
exports.smsdevDeleteProvider = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const id = String(request.data?.id || '')
  const ref = db.doc(`users/${uid}/smsdevProviders/${id}`)
  const era = (await ref.get()).data()
  await ref.delete()
  // Se era o principal, promove outro.
  if (era?.principal) {
    const outros = await db.collection(`users/${uid}/smsdevProviders`).limit(1).get()
    if (!outros.empty) await outros.docs[0].ref.set({ principal: true }, { merge: true })
  }
  return { ok: true }
})

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
exports.sendBulkSMS = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB', enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)

  // ── Canal BRASIL (SMSDev): só +55, crédito-only (sem cota de plano). ──
  if ((request.data?.canal) === 'brl') {
    const ehAdminBr = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
    const msgBr = String(request.data?.mensagem || '').trim()
    const recBr = Array.isArray(request.data?.recipients) ? request.data.recipients : []
    if (!msgBr) throw new HttpsError('invalid-argument', 'Escreva a mensagem do SMS.')
    if (recBr.length === 0) throw new HttpsError('invalid-argument', 'Nenhum destinatário na lista.')
    const rSmsBr = await resolverSmsBrEnvio(uid) // BYO (conta do cliente) tem prioridade
    if (rSmsBr.erro) throw new HttpsError('failed-precondition', rSmsBr.erro)
    const smsdevKey = rSmsBr.key
    const propriaBr = !!rSmsBr.propria
    const validos = []
    for (const r of recBr.slice(0, 20000)) {
      const norm = normalizarE164(r?.telefone || r?.numero || '', { permitirBR: true })
      if (norm.ok && String(norm.e164).replace(/\D/g, '').startsWith('55')) validos.push({ telefone: norm.e164, nome: r.nome || '', produto: r.produto || '' })
    }
    if (validos.length === 0) throw new HttpsError('invalid-argument', 'Nenhum número do Brasil (+55) válido na lista.')
    // Crédito nosso só quando usa a NOSSA conta (não BYO / não admin).
    if (!ehAdminBr && !propriaBr) {
      const creditos = Number(tenant.smsBrCreditos) || 0
      if (creditos < validos.length) throw new HttpsError('resource-exhausted', `Você tem ${creditos} crédito(s) de SMS Brasil, mas a lista tem ${validos.length}. Recarregue no Perfil.`)
    }
    // Lotes + fila (igual EUA): 1º lote na hora, o resto processado pelo processarLotesSMS (evita timeout em listas grandes).
    const loteSizeBr = Math.max(1, Math.min(200, Number(request.data?.loteSize) || 40))
    const intervaloMinBr = Math.max(1, Math.min(240, Number(request.data?.intervaloMin) || 1))
    const lotesBr = []
    for (let i = 0; i < validos.length; i += loteSizeBr) lotesBr.push(validos.slice(i, i + loteSizeBr))
    const dispRef = await db.collection('users').doc(uid).collection('smsDisparos').add({
      nomeDisparo: String(request.data?.nomeDisparo || 'Disparo SMS Brasil'),
      mensagem: msgBr, total: validos.length, enviados: 0, erros: 0,
      loteSize: loteSizeBr, intervaloMin: intervaloMinBr, totalLotes: lotesBr.length,
      canal: 'brl', contaPropria: propriaBr, status: 'enviando',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    await scanConteudoRisco(uid, tenant, 'sms', msgBr, { ref: dispRef.id })
    // 1º lote na hora
    const r0 = await enviarLoteSMSDev(uid, smsdevKey, msgBr, lotesBr[0] || [], ehAdminBr, propriaBr, dispRef.id)
    // demais lotes na fila
    const intervaloMsBr = intervaloMinBr * 60000
    for (let i = 1; i < lotesBr.length; i++) {
      await dispRef.collection('smsLotes').add({
        disparoId: dispRef.id, recipients: lotesBr[i],
        sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + i * intervaloMsBr),
        status: 'pendente', createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    const soUmLoteBr = lotesBr.length <= 1
    await dispRef.update({
      enviados: r0.enviados, erros: r0.erros,
      status: soUmLoteBr ? (r0.erros === 0 ? 'enviado' : (r0.enviados === 0 ? 'erro' : 'parcial')) : 'enviando',
      ...(r0.erroMotivo ? { erroMotivo: r0.erroMotivo } : {}),
    })
    return { ok: true, total: validos.length, enviados: r0.enviados, lotes: lotesBr.length, canal: 'brl' }
  }

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

  // Contador server-only de cota SMS (à prova de adulteração).
  const quotaConsumidaSms = !ehAdmin && !contaPropria ? Math.max(0, validos.length - creditoAConsumir) : 0
  if (quotaConsumidaSms > 0) {
    await db.doc(`tenants/${uid}`).set({ smsUso: { [mesAtualStr()]: admin.firestore.FieldValue.increment(quotaConsumidaSms) } }, { merge: true })
  }

  // Fiscalização de conteúdo (não bloqueia — só registra pro admin).
  await scanConteudoRisco(uid, tenant, 'sms', mensagem, { ref: dispRef.id })

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
  const canal = ['api', 'brl'].includes(data.canal) ? data.canal : 'eua'

  // ── Canal BRASIL (SMSDev): reenvio via SMSDev, crédito-only. ──
  if (canal === 'brl') {
    const rSms = await resolverSmsBrEnvio(uid) // BYO (conta do cliente) tem prioridade
    if (rSms.erro) throw new HttpsError('failed-precondition', rSms.erro)
    const normBr = normalizarE164(data.telefone, { permitirBR: true })
    if (!normBr.ok || !String(normBr.e164).replace(/\D/g, '').startsWith('55')) throw new HttpsError('invalid-argument', 'Número do Brasil (+55) inválido.')
    if (!ehAdmin && !rSms.propria && (Number(tenant.smsBrCreditos) || 0) < 1) throw new HttpsError('resource-exhausted', 'Sem créditos de SMS Brasil. Recarregue no Perfil.')
    const customer = { nome: data.nome || '', telefone: normBr.e164, email: data.email || '' }
    const texto = replaceVariables(mensagem, customer, { nome: data.produto || '' })
    let ok = true, erroMsg = null
    try { await enviarSMSDev(rSms.key, normBr.e164, texto) } catch (err) { ok = false; erroMsg = err.message || 'Falha no envio do SMS' }
    if (ok && !ehAdmin && !rSms.propria) await db.doc(`tenants/${uid}`).set({ smsBrCreditos: admin.firestore.FieldValue.increment(-1) }, { merge: true })
    await db.collection('users').doc(uid).collection('smsLogs').add({
      leadId: data.leadId || null, evento: data.evento || '', produto: data.produto || '', telefone: normBr.e164, nome: customer.nome, canal: 'brl',
      status: ok ? 'enviado' : 'erro', erroMsg, mensagem: texto, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    if (!ok) throw new HttpsError('internal', erroMsg || 'Falha ao enviar SMS.')
    return { ok: true }
  }

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
        const canal = ['api', 'brl'].includes(dd.canal) ? dd.canal : 'eua'
        let r
        if (canal === 'brl') {
          const rSms = await resolverSmsBrEnvio(uid) // BYO (conta do cliente) tem prioridade
          if (rSms.erro) { await loteDoc.ref.update({ status: 'erro' }); continue }
          r = await enviarLoteSMSDev(uid, rSms.key, dd.mensagem || '', lote.recipients || [], await ehUidAdmin(uid), rSms.propria, dispId)
        } else {
          const chave = `${uid}:${canal}`
          if (!cfgCache[chave]) {
            const rEnvio = await resolverTelnyxEnvio(uid, await ehUidAdmin(uid), canal)
            if (rEnvio.erro) { await loteDoc.ref.update({ status: 'erro' }); continue }
            cfgCache[chave] = { cfg: rEnvio.cfg, permitirBR: !!rEnvio.propria }
          }
          const cfg = cfgCache[chave].cfg
          const ctx = { cfg, mensagem: dd.mensagem || '', disparoId: dispId, permitirBR: cfgCache[chave].permitirBR }
          r = await enviarLoteSMS(uid, ctx, lote.recipients || [])
        }
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

/**
 * Webhook de status do SMSDev (DLR: entregue/não entregue) — atualiza smsMensagens pra métricas BR.
 * Configure a URL desta função no painel do SMSDev (Callback Situação). O id da msg mapeia o uid via smsdevIndex.
 * Formato flexível (SMSDev varia): tenta id em id/id_sms/message_id e situação em situacao/status/dlr.
 */
/** Motivo legível de um DLR de falha do SMSDev (o callback só dá o rótulo genérico). */
function motivoDlrSmsdev(situacao) {
  const t = String(situacao || '').toLowerCase()
  if (/black.?list/.test(t)) return 'Número na blacklist da operadora'
  if (/cancel/.test(t)) return 'Envio cancelado'
  if (/expir/.test(t)) return 'Expirou antes de entregar'
  if (/invalid|erro|error|reject/.test(t)) return 'Número inválido ou rejeitado pela operadora'
  return 'Não entregue pela operadora'
}

exports.smsdevWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    const b = { ...(req.query || {}), ...(req.body || {}) }
    const { key: _k, ...semKey } = b // não logar a key da conta SMSDev
    console.log('smsdevWebhook DLR recebido:', req.method, JSON.stringify(semKey))
    const id = String(b.id || b.id_sms || b.message_id || b.messageId || '').trim()
    const situacao = String(b.situacao || b.status || b.dlr || b.descricao || '').toLowerCase()
    if (id) {
      let uid = (req.query && req.query.userId) || null
      if (!uid) { try { const ix = await db.doc(`smsdevIndex/${id}`).get(); if (ix.exists) uid = ix.data().uid } catch (_) {} }
      if (uid) {
        // Valores reais do SMSDev (campo `situacao` do callback): RECEBIDA=entregue, SENT=em trânsito,
        // QUEUE/APPROVAL=pendente, ERROR/CANCELED/BLACK LIST=falha. Checa falha primeiro (evita que
        // "nao entregue" case com /entreg/).
        const falhou = /(erro|error|cancel|black.?list|reject|expir|invalid|undeliver|\bfalh|nao.?entreg)/.test(situacao)
        const entregue = !falhou && /(receb|entreg|delivered|\bdlvrd\b|success|sucesso)/.test(situacao)
        const status = entregue ? 'entregue' : (falhou ? 'nao_entregue' : (situacao || 'atualizado'))
        const ref = db.doc(`users/${uid}/smsMensagens/${id}`)
        const prev = await ref.get()
        const prevStatus = prev.exists ? prev.data().status : null
        const disparoId = prev.exists ? prev.data().disparoId : null
        const smsLogId = prev.exists ? prev.data().smsLogId : null
        if (prevStatus !== status) {
          await ref.set({ status, dlr: situacao, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
          // Consolida a contagem de entrega no doc do disparo (idempotente: só conta transições de estado FINAL).
          if (disparoId) {
            const inc = {}
            if (prevStatus === 'entregue') inc.entregues = admin.firestore.FieldValue.increment(-1)
            if (prevStatus === 'nao_entregue') inc.naoEntregues = admin.firestore.FieldValue.increment(-1)
            if (status === 'entregue') inc.entregues = admin.firestore.FieldValue.increment(1)
            if (status === 'nao_entregue') inc.naoEntregues = admin.firestore.FieldValue.increment(1)
            if (Object.keys(inc).length) {
              try { await db.doc(`users/${uid}/smsDisparos/${disparoId}`).set(inc, { merge: true }) } catch (_) {}
            }
          }
          // Auto-send BR: propaga o resultado de entrega pro smsLog (aparece no relatório com motivo no hover).
          const patchEntrega = status === 'nao_entregue'
            ? { status: 'erro', erroMsg: motivoDlrSmsdev(situacao), entregue: false }
            : (status === 'entregue' ? { entregue: true } : null)
          if (smsLogId && patchEntrega) { try { await db.doc(`users/${uid}/smsLogs/${smsLogId}`).set(patchEntrega, { merge: true }) } catch (_) {} }
          // Funil BR: idem pro funnelSend.
          const funnelSendId = prev.exists ? prev.data().funnelSendId : null
          if (funnelSendId && patchEntrega) { try { await db.doc(`users/${uid}/funnelSends/${funnelSendId}`).set(patchEntrega, { merge: true }) } catch (_) {} }
        }
      }
    }
    res.status(200).send('ok')
  } catch (err) {
    console.error('smsdevWebhook', err)
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
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'subscription',
      line_items: [{ price: priceNumero, quantity: numeros.length }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      subscription_data: { metadata: meta, description: `Autsend · ${numeros.length} número(s) de SMS` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('smsCriarCheckoutNumero', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/**
 * Cria o checkout Stripe EMBUTIDO (assinatura R$29,90/mês por instância) pra COMPRAR instâncias
 * avulsas de WhatsApp. Ao pagar, o webhook soma em `tenant.instanciasExtras` (aumenta o limite).
 */
exports.instanciaCriarCheckout = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const qtd = Math.max(1, Math.min(20, Number(request.data?.quantidade) || 1))
  const key = process.env.STRIPE_SECRET_KEY
  const priceInst = process.env.STRIPE_PRICE_INSTANCIA_WA || 'price_1TuEmRLvVsGXtCnT0e7d2gm2'
  if (!key) throw new HttpsError('failed-precondition', 'A compra de instância ainda não foi configurada.')
  const stripe = require('stripe')(key)
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'instancia_wa', uid, quantidade: String(qtd) }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'subscription',
      line_items: [{ price: priceInst, quantity: qtd }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      subscription_data: { metadata: meta, description: `Autsend · ${qtd} instância(s) de WhatsApp` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('instanciaCriarCheckout', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/**
 * Cria uma instância de WhatsApp com TRAVA de plano no servidor (limite `instancias`).
 * Conta as instâncias existentes ANTES de criar; só então chama o Evolution (n8n).
 * O frontend grava o doc no Firestore com o retorno (hash/qr).
 */
exports.waCriarInstancia = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  const nome = String(request.data?.nomeInstancia || '').trim() || `instancia_${Date.now()}`
  const numero = String(request.data?.numeroWhatsapp || '').replace(/\D/g, '')
  // Trava: quantas instâncias o cliente já tem.
  const snap = await db.collection(`users/${uid}/instances`).get()
  assertPodeCriarRecurso(request, tenant, 'instancias', snap.size, 'instância(s) de WhatsApp')
  // Passou na trava → cria a sessão no WAHA (WF3). nomeInstancia vira o ID da sessão no WAHA:
  // só letras/números/hífen/underline (espaço ou acento quebram a URL). Normaliza antes de enviar.
  const sessao = nome.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `instancia-${Date.now()}`
  const payload = { tipoAcao: 'criar_instancia', nomeInstancia: sessao, uid }
  if (numero) payload.numeroWhatsApp = numero
  let data
  try {
    const res = await fetch(WEBHOOK_EVOLUTION, {
      method: 'POST',
      headers: n8nHeaders(),
      body: JSON.stringify(payload),
    })
    data = await res.json().catch(() => ({}))
    if (!res.ok && data?._ok !== true) throw new Error(data?.erro || data?.message || data?.error || 'Falha ao criar instância')
  } catch (e) {
    console.error('waCriarInstancia', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar a instância no WhatsApp.')
  }
  // WAHA não tem hash/instanceId por sessão (auth é uma API key global no n8n). O ID é o próprio nomeInstancia.
  const base64 = data.qrcodeBase64 ?? data.base64 ?? data.qrCodeBase64 ?? data.qrcode ?? null
  const ref = await db.collection(`users/${uid}/instances`).add({
    nomeInstancia: sessao,
    numeroWhatsapp: numero,
    hash: null,
    qrCodeBase64: base64,
    instanceId: null,
    conectado: false,
    grupos: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { id: ref.id, base64, hash: null, instanceId: null, nomeInstancia: sessao }
})

/**
 * Proxy server-side pro WF3 (WAHA): verificar_status / obter_qr / reconectar / logout / excluir_instancia.
 * O front NÃO chama o n8n direto (fetch cross-origin do browser é bloqueado por CORS → o n8n
 * não recebe nada). Aqui é servidor→n8n, sem CORS. Só age em instância do próprio usuário.
 */
exports.waInstanciaAcao = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const d = request.data || {}
  const tipoAcao = String(d.tipoAcao || '').trim()
  const nomeInstancia = String(d.nomeInstancia || '').trim()
  const ACOES = ['verificar_status', 'obter_qr', 'reconectar', 'logout', 'excluir_instancia']
  if (!ACOES.includes(tipoAcao)) throw new HttpsError('invalid-argument', 'Ação inválida.')
  if (!nomeInstancia) throw new HttpsError('invalid-argument', 'Sem instância.')
  // A instância é do usuário?
  const snap = await db.collection(`users/${uid}/instances`).where('nomeInstancia', '==', nomeInstancia).limit(1).get()
  if (snap.empty) throw new HttpsError('permission-denied', 'Instância não encontrada.')
  const payload = { tipoAcao, nomeInstancia }
  const numero = String(d.numeroWhatsApp || d.numeroWhatsapp || '').replace(/\D/g, '')
  if (numero) payload.numeroWhatsApp = numero
  try {
    const res = await fetch(WEBHOOK_EVOLUTION, { method: 'POST', headers: n8nHeaders(), body: JSON.stringify(payload) })
    return await res.json().catch(() => ({}))
  } catch (e) {
    console.error('waInstanciaAcao', tipoAcao, e?.message || e)
    throw new HttpsError('internal', 'Falha ao falar com o servidor de WhatsApp.')
  }
})

/**
 * Proxy server-side pro WF3 (WAHA) — busca os grupos de uma instância do próprio usuário.
 * O front NÃO chama o n8n direto (o webhook exige a chave x-autsend-key, que não pode ir pro browser).
 */
exports.waBuscarGrupos = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const d = request.data || {}
  const nomeInstancia = String(d.nomeInstancia || '').trim()
  if (!nomeInstancia) throw new HttpsError('invalid-argument', 'Sem instância.')
  // A instância é do usuário?
  const snap = await db.collection(`users/${uid}/instances`).where('nomeInstancia', '==', nomeInstancia).limit(1).get()
  if (snap.empty) throw new HttpsError('permission-denied', 'Instância não encontrada.')
  const payload = { tipoAcao: 'buscar_grupo', nomeInstancia, hash: String(d.hash || ''), instanciaId: String(d.instanciaId || '') }
  try {
    const res = await fetch(WEBHOOK_EVOLUTION, { method: 'POST', headers: n8nHeaders(), body: JSON.stringify(payload) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpsError('internal', data?.message || data?.error || 'Falha ao buscar grupos')
    return data
  } catch (e) {
    if (e instanceof HttpsError) throw e
    console.error('waBuscarGrupos', e?.message || e)
    throw new HttpsError('internal', 'Falha ao buscar grupos.')
  }
})

// ═════════════════════ CENTRAL DE ATENDENTES — bot de IA no WhatsApp por produto ═════════════════════

/**
 * Cria um atendente (bot de IA). Trava de plano (atendentesMax = base + instâncias extras) +
 * regra: 1 atendente por produto (grupoId) e 1 por instância (instanceId).
 */
exports.criarAtendente = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  const d = request.data || {}
  const nome = String(d.nome || '').trim() || 'Atendente'
  const grupoId = String(d.grupoId || '').trim()
  const instanceId = String(d.instanceId || '').trim()
  if (!grupoId) throw new HttpsError('invalid-argument', 'Escolha o produto (grupo) do atendente.')
  if (!instanceId) throw new HttpsError('invalid-argument', 'Escolha a instância de WhatsApp do atendente.')

  const snap = await db.collection(`users/${uid}/atendentes`).get()
  const existentes = snap.docs.map((x) => ({ id: x.id, ...x.data() }))
  // Trava de contagem por plano.
  assertPodeCriarRecurso(request, tenant, 'atendentes', existentes.length, 'atendente(s) de IA')
  // 1 atendente por produto e por instância.
  if (existentes.some((a) => a.grupoId === grupoId)) throw new HttpsError('failed-precondition', 'Esse produto já tem um atendente. Cada produto só pode ter um.')
  if (existentes.some((a) => a.instanceId === instanceId)) throw new HttpsError('failed-precondition', 'Essa instância já está em uso por outro atendente. Cada instância só pode ter um atendente.')

  const ref = await db.collection(`users/${uid}/atendentes`).add({
    nome, grupoId, instanceId, ativo: false,
    eventos: [], // eventos Kiwify em que puxa conversa (Fase 3)
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
})

// ───────────── Cérebro do atendente (Fase 2): recebe msg → Grok → responde ─────────────

const ATENDENTE_TOM = {
  amigavel: 'simpático, acolhedor e próximo',
  direta: 'direto e objetivo, sem enrolação',
  ousada: 'persuasivo e vendedor, usando gatilhos de urgência e escassez com bom senso',
  consultiva: 'consultivo, tirando as dúvidas com calma antes de oferecer a compra',
}
const HANDOVER_HORAS = 6 // pausa o bot por X horas quando o dono responde manual

// Rótulos amigáveis dos eventos (pro prompt do vendedor saber de onde o lead veio).
const EVENTO_LABEL = {
  abandoned_cart: 'carrinho abandonado',
  'order_status.boleto_issued': 'boleto emitido (ainda não pago)',
  'order_status.pix_issued': 'pix emitido (ainda não pago)',
  'order_status.purchase_declined': 'compra recusada',
  'order_status.purchase_approved': 'compra aprovada',
  'order_status.refund': 'reembolso',
  'order_status.chargeback': 'chargeback',
  subscription_canceled: 'assinatura cancelada',
  subscription_overdue: 'assinatura vencida',
  subscription_renewed: 'assinatura renovada',
}

/** Monta a mensagem de sistema (o "cérebro") a partir do contexto salvo no productGroup. */
/**
 * Lê o grafo do ReactFlow (iaGraph) e monta um roteiro de venda FIEL + links por token único.
 * Resolve 2 problemas do achatamento: colisão de nomes (cada checkout vira um token CKn único)
 * e perda dos galhos (cada item vendável diz o que vem DEPOIS: agradecimento + próximo upsell).
 * @returns {{ roteiro: string, linkPorToken: Record<string,string> } | null}
 */
function serializarFluxoGrafo(grafo) {
  const nodes = Array.isArray(grafo?.nodes) ? grafo.nodes : []
  const edges = Array.isArray(grafo?.edges) ? grafo.edges : []
  if (!nodes.length) return null
  const byId = {}
  nodes.forEach((n) => { byId[n.id] = n })
  const saindo = (id) => edges.filter((e) => e.source === id).map((e) => byId[e.target]).filter(Boolean)

  // Token único e determinístico por checkout (mesma ordem no prompt e na resolução do link).
  const linkPorToken = {}
  const tokenDe = {}
  let n = 0
  nodes.filter((x) => x.type === 'checkout' && x.data?.link).forEach((c) => {
    const tk = `CK${++n}`
    tokenDe[c.id] = tk
    linkPorToken[tk] = c.data.link
  })
  if (!n) return null // sem checkout válido → deixa o fallback por nome cuidar

  const rotulo = (x) => {
    if (x.type === 'plano') return 'PLANO'
    const k = x.data?.kind
    return k === 'up' ? 'UPSELL' : k === 'dw' ? 'DOWNSELL (mais barato, oferecer só se recusar o upsell)'
      : k === 'vsl' ? 'OFERTA PRINCIPAL (vídeo)' : k === 'tsl' ? 'OFERTA PRINCIPAL (texto)' : 'OFERTA'
  }
  const descreve = (x) => {
    const nome = x.data?.nome || 'Sem nome'
    const preco = x.data?.preco ? ` — ${x.data.preco}` : ''
    const prod = x.data?.grupoNome ? ` [produto: ${x.data.grupoNome}]` : ''
    const desc = x.data?.descricao ? `: ${x.data.descricao}` : ''
    const L = [`• ${rotulo(x)}: ${nome}${preco}${prod}${desc}`]
    const ck = saindo(x.id).find((y) => y.type === 'checkout')
    L.push(ck && tokenDe[ck.id]
      ? `   ↳ pra mandar o link de compra DESTE item, escreva EXATAMENTE [CHECKOUT: ${tokenDe[ck.id]}]`
      : `   ↳ (sem link configurado — se pedirem pra comprar, chame um humano)`)
    const base = ck || x
    const agr = saindo(base.id).find((y) => y.type === 'agradecimento')
    if (agr?.data?.texto) L.push(`   ↳ ao CONFIRMAR a compra deste, mande: "${agr.data.texto}"`)
    const prox = saindo((agr || base).id).filter((y) => y.type === 'oferta' || y.type === 'plano')
    if (prox.length) L.push(`   ↳ SÓ DEPOIS que ele comprar este, ofereça em seguida: ${prox.map((p) => p.data?.nome || '?').join(' → ')}`)
    return L.join('\n')
  }
  const peso = (x) => (x.type === 'plano' || x.data?.kind === 'vsl' || x.data?.kind === 'tsl') ? 0 : x.data?.kind === 'up' ? 1 : 2
  const vendaveis = nodes
    .filter((x) => (x.type === 'plano' || x.type === 'oferta') && (x.data?.nome || saindo(x.id).some((y) => y.type === 'checkout')))
    .sort((a, b) => peso(a) - peso(b))
  return { roteiro: vendaveis.map(descreve).join('\n'), linkPorToken }
}

function montarSystemAtendente(grupo, leadContexto) {
  const persona = ATENDENTE_TOM[grupo?.iaPersona] || ATENDENTE_TOM.amigavel
  const fluxo = serializarFluxoGrafo(grupo?.iaGraph)

  // Bloco de venda: vem do GRAFO (fiel) quando existe; senão, fallback pras listas achatadas (compat).
  let vendaBloco = ''
  if (fluxo && fluxo.roteiro) {
    vendaBloco = `\nFLUXO DE VENDAS (o mapa OFICIAL — siga à risca: ordem, links e escada; cada "↳ depois" só vale APÓS a compra confirmada):\n${fluxo.roteiro}`
  } else {
    const planos = Array.isArray(grupo?.iaPlanos) ? grupo.iaPlanos : []
    const planosTxt = planos.map((p) => `- ${p.nome}${p.preco ? ` (${p.preco})` : ''}${p.descricao ? `: ${p.descricao}` : ''} → [CHECKOUT: ${p.nome}]`).join('\n')
    const f = grupo?.iaFunil || {}
    const ups = Array.isArray(f.upsells) ? f.upsells : []
    const dws = Array.isArray(f.downsells) ? f.downsells : []
    let funilTxt = ''
    if (f.principal) { funilTxt += `\nOFERTA PRINCIPAL: ${f.principal.descricao || ''}${f.principal.checkoutLink ? ` → [CHECKOUT: OFERTA PRINCIPAL]` : ''}` }
    ups.forEach((u, i) => {
      funilTxt += `\nUPSELL ${u.nome}: ${u.descricao || ''}${u.checkoutLink ? ` → [CHECKOUT: ${u.nome}]` : ''}`
      const dw = dws[i]
      if (dw && (dw.checkoutLink || dw.descricao)) funilTxt += `\n   ↳ se recusar, DOWNSELL ${dw.nome}: ${dw.descricao || ''}${dw.checkoutLink ? ` → [CHECKOUT: ${dw.nome}]` : ''}`
    })
    const agr = Array.isArray(grupo?.iaAgradecimentos) ? grupo.iaAgradecimentos : []
    const agrTxt = agr.length ? '\nAGRADECIMENTOS (mande ao confirmar a compra):\n' + agr.map((a) => `  - ao comprar ${(Array.isArray(a.checkouts) ? a.checkouts : []).map((c) => `"${c.nome}"`).join(' ou ') || 'uma oferta'}: ${a.texto}`).join('\n') : ''
    vendaBloco = [funilTxt ? `\nFUNIL DE OFERTAS:${funilTxt}` : '', agrTxt, planosTxt ? `\nPLANOS:\n${planosTxt}` : ''].filter(Boolean).join('\n')
  }
  const temFluxo = !!vendaBloco

  const linhas = [
    `Você é um(a) vendedor(a) HUMANO(A) de verdade atendendo no WhatsApp sobre "${grupo?.nome || ''}". Tom: ${persona}. Você conversa como gente, com calor, e usa boas táticas de venda com sutileza — mas NUNCA inventa nada.`,
    (leadContexto && (leadContexto.produto || leadContexto.evento)) ? `\nCONTEXTO DESTE LEAD (personalize sem parecer robô nem citar "sistema"): chegou pelo evento "${EVENTO_LABEL[leadContexto.evento] || leadContexto.evento || ''}"${leadContexto.produto ? ` do produto "${leadContexto.produto}"` : ''}.` : '',
    grupo?.iaObjetivo ? `\nSEU OBJETIVO:\n${grupo.iaObjetivo}` : '',
    grupo?.iaContexto ? `\nSOBRE O PRODUTO (a ÚNICA fonte de verdade — só existe o que está escrito aqui):\n${grupo.iaContexto}` : '',
    grupo?.iaObjecoes ? `\nCOMO CONTORNAR OBJEÇÕES:\n${grupo.iaObjecoes}` : '',
    grupo?.iaProvaSocial ? `\nPROVA SOCIAL (use pra convencer):\n${grupo.iaProvaSocial}` : '',
    grupo?.iaSuporte ? `\nSUPORTE (encaminhe pra cá dúvidas de USO/técnicas — login, config, problemas):\n${grupo.iaSuporte}` : '',
    grupo?.iaLinkApp ? `\nLINK DO APP (o único link válido de acesso — nunca invente outro):\n${grupo.iaLinkApp}` : '',
    vendaBloco,
    `\nREGRAS OBRIGATÓRIAS:`,
    `- Seja HUMANO: fale curto (1 a 3 frases), natural e caloroso. Nada de textão nem de robô. Responda SEMPRE no idioma do cliente.`,
    `- Escreva como mensagem de WhatsApp de verdade: SEM títulos/rótulos (nada de "Resposta honesta:", "Sobre isso:", "Dica:") e SEM linhas em branco entre parágrafos. Texto corrido e direto — vá direto ao ponto, sem enfeite de formatação.`,
    `- MÉTODO CONSULTIVO (venda por perguntas, não por catálogo): antes de empurrar plano/preço, faça 1 pergunta rápida pra entender a REAL necessidade do cliente (o que ele quer resolver, o que usa hoje, qual o objetivo). Descubra a dor ANTES de oferecer.`,
    `- RECOMENDE 1, NÃO LISTE 3: com a dor na mão, sugira UMA opção — a que mais encaixa nele — e diga em 1 frase POR QUE encaixa (amarrada no que ELE falou). Se pedir "os planos", no máximo nome + preço em 1 linha e devolva perguntando o objetivo dele. NUNCA despeje os 3 com features (paredão espanta).`,
    `- UMA PERGUNTA POR VEZ: termine quase toda mensagem com UMA pergunta simples que faça o cliente responder e mantenha a conversa andando. Uma ideia por mensagem.`,
    `- ESPELHE O CLIENTE: copie o tom e a energia dele — formal↔formal, gíria/emoji↔acompanha, seco↔direto. Fale a língua dele pra criar afinidade.`,
    `- CONTORNE OBJEÇÃO COM EMPATIA (sentir → sentiram → descobriram): reconheça o sentimento ("entendo, faz sentido"), mostre que OUTROS clientes pensaram o mesmo no começo e viram que valeu (prova social — só se for REAL), e reframe com UM benefício concreto ligado à dor dele. Tente de novo com leveza; se não quiser, respeite e deixe a porta aberta (sem insistir sem parar).`,
    `- CRIE DESEJO COM SUTILEZA: benefício real amarrado na dor dele + prova social + (se existir de verdade) escassez/urgência. NUNCA invente gatilho.`,
    `- PROIBIDO INVENTAR (regra MÁXIMA, acima de tudo): nunca crie preço, plano, trial/teste grátis, garantia, desconto, promoção, prazo, funcionalidade ou link que não esteja LITERALMENTE escrito acima. Se perguntarem por algo que não existe (ex.: "tem 3 dias grátis?"), diga com naturalidade que NÃO tem. Na dúvida, é NÃO.`,
    temFluxo ? `- SIGA O FLUXO DE VENDAS acima à risca: ofereça na ordem definida e mande o link EXATO de cada item pelo marcador [CHECKOUT: token] correspondente — NUNCA o link de outro item, NUNCA uma URL escrita por você.` : `- NUNCA escreva uma URL você mesmo.`,
    temFluxo ? `- ESCADA (upsell): só ofereça o próximo item (o "↳ depois") DEPOIS que o cliente CONFIRMAR que comprou o anterior. Se recusar um upsell, ofereça o downsell dele (se houver) e siga. Quando o fluxo acabar, agradeça e PARE de empurrar venda.` : '',
    `- VOCÊ vende TUDO que está no fluxo — inclusive os upsells/downsells (ex.: Fireon). Você JÁ TEM os planos, preços e links deles aqui em cima. NUNCA diga que vai "chamar um especialista", "passar pra alguém" ou "te apresentar depois" pra mostrar plano/preço que já está no fluxo — isso é SEU trabalho: apresente e feche você mesmo, na hora. Só chame um humano de verdade pra suporte técnico/uso ou algo REALMENTE fora do que está escrito.`,
    `- Mande o link do que ELE pediu. Se pediu o GRATUITO, mande o gratuito — nunca empurre um pago no lugar. Se o item pedido não tem link configurado, chame um humano.`,
    `- COMO USAR / aprender / configurar / login / algo não funciona: NÃO ensine passo a passo nem invente telas/etapas. ${grupo?.iaSuporte ? 'Encaminhe pro SUPORTE acima.' : 'Diga que vai chamar um atendente humano.'}${grupo?.iaLinkApp ? ' Se quiser acessar, mande só o link do app acima.' : ''}`,
    grupo?.iaRegras ? `- ${grupo.iaRegras.replace(/\n/g, '\n- ')}` : '',
    `- Caso complexo ou fora do que está escrito: seja honesto e diga que vai chamar um atendente humano.`,
  ]
  return linhas.filter(Boolean).join('\n')
}

/** Troca os marcadores [CHECKOUT: nome] pelo link real (plano OU oferta do funil). */
/**
 * Converte Markdown pra formatação do WhatsApp (que os modelos novos ignoram por padrão).
 * WhatsApp: negrito = *um asterisco*. Markdown usa **dois** → apareceria literal.
 */
function paraFormatoWhatsApp(texto) {
  return String(texto || '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '*$1*')        // ***x*** (negrito+itálico) → *x*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')            // **negrito** → *negrito*
    .replace(/__(.+?)__/g, '*$1*')                // __negrito__ → *negrito*
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm, '*$1*') // # Título → *Título*
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2') // [txt](url) → txt: url
    .replace(/^\s{0,3}[-*]\s+/gm, '• ')           // bullets markdown → •
    .replace(/[ \t]+\n/g, '\n')                   // tira espaço no fim das linhas
    .replace(/\n{2,}/g, '\n')                     // sem linha em branco entre parágrafos
    .trim()
}

function injetarCheckouts(texto, grupo) {
  // Prioridade: tokens únicos do grafo (CKn) — link sempre certo, sem colisão de nome.
  const porToken = serializarFluxoGrafo(grupo?.iaGraph)?.linkPorToken || {}
  // Fallback: mapa por nome (configs antigas sem grafo, ou se o modelo usar o nome).
  const map = {}
  const add = (nome, link) => { if (nome && link) map[String(nome).trim().toLowerCase()] = link }
  ;(Array.isArray(grupo?.iaPlanos) ? grupo.iaPlanos : []).forEach((p) => add(p.nome, p.checkoutLink))
  const f = grupo?.iaFunil || {}
  if (f.principal) { add('oferta principal', f.principal.checkoutLink); add(f.principal.nome, f.principal.checkoutLink) }
  ;(Array.isArray(f.upsells) ? f.upsells : []).forEach((u) => add(u.nome, u.checkoutLink))
  ;(Array.isArray(f.downsells) ? f.downsells : []).forEach((d) => add(d.nome, d.checkoutLink))
  const out = String(texto || '').replace(/\[CHECKOUT:\s*([^\]]+)\]/gi, (m, chave) => {
    const raw = chave.trim()
    const tk = raw.toUpperCase().replace(/\s+/g, '')
    if (porToken[tk]) return porToken[tk] // token único CKn
    const alvo = raw.toLowerCase()
    if (map[alvo]) return map[alvo]
    const hit = Object.entries(map).find(([k]) => k.includes(alvo) || alvo.includes(k))
    return hit ? hit[1] : ''
  }).replace(/\n{3,}/g, '\n\n').trim()
  return paraFormatoWhatsApp(out)
}

/**
 * Mídias (imagem/áudio) que devem sair LOGO APÓS a resposta, disparadas pelo checkout enviado.
 * No editor, a mídia é ligada embaixo de um nó de checkout → gatilho { tipo:'checkout', link }.
 * Se o link daquele checkout está na resposta, a mídia acompanha (imagem/áudio depois do texto).
 */
/** True se a resposta contém ALGUM link de checkout do grupo (= Initiate Checkout / IC). */
function atingiuCheckout(grupo, texto) {
  if (!texto) return false
  const links = Object.values(serializarFluxoGrafo(grupo?.iaGraph)?.linkPorToken || {})
  const f = grupo?.iaFunil || {}
  ;(Array.isArray(grupo?.iaPlanos) ? grupo.iaPlanos : []).forEach((p) => p.checkoutLink && links.push(p.checkoutLink))
  if (f.principal?.checkoutLink) links.push(f.principal.checkoutLink)
  ;(Array.isArray(f.upsells) ? f.upsells : []).forEach((u) => u.checkoutLink && links.push(u.checkoutLink))
  ;(Array.isArray(f.downsells) ? f.downsells : []).forEach((d) => d.checkoutLink && links.push(d.checkoutLink))
  return links.some((l) => l && texto.includes(l))
}

function midiasDisparadas(grupo, textoFinal) {
  const graph = grupo?.iaGraph
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  if (!nodes.length || !textoFinal) return []
  const byId = {}; nodes.forEach((n) => { byId[n.id] = n })
  const pais = (id) => edges.filter((e) => e.target === id).map((e) => byId[e.source]).filter(Boolean)
  const filhos = (id) => edges.filter((e) => e.source === id).map((e) => byId[e.target]).filter(Boolean)
  const norm = (s) => String(s || '').toLowerCase().replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim()
  const resp = norm(textoFinal)

  // A mídia dispara pelo NÓ PAI DIRETO dela (não pelo avô!):
  //  - checkout      → quando o link daquele checkout vai na resposta
  //  - plano/oferta  → quando o link do checkout DELE (filho) vai na resposta
  //  - agradecimento → só quando a MENSAGEM de agradecimento é enviada (texto na resposta)
  const disparaPor = (pai) => {
    if (!pai) return false
    if (pai.type === 'checkout') return !!(pai.data?.link && textoFinal.includes(pai.data.link))
    if (pai.type === 'plano' || pai.type === 'oferta') {
      const ck = filhos(pai.id).find((n) => n.type === 'checkout' && n.data?.link)
      return !!(ck && textoFinal.includes(ck.data.link))
    }
    if (pai.type === 'agradecimento') {
      const t = norm(pai.data?.texto)
      if (!t) return false
      return resp.includes(t.length > 24 ? t.slice(0, 24) : t)
    }
    return false
  }

  const out = []
  const vistos = new Set()
  for (const m of nodes) {
    if ((m.type !== 'imagem' && m.type !== 'audio') || !m.data?.url || vistos.has(m.data.url)) continue
    if (pais(m.id).some(disparaPor)) {
      vistos.add(m.data.url)
      out.push({ tipo: m.type === 'audio' ? 'audio' : 'imagem', url: m.data.url, nome: m.data.nome || '' })
    }
  }
  return out
}

/** Blocos de 1 texto simples (contrato WF1/WAHA). */
function blocosTexto(texto) { return [{ tipo: 'texto', conteudo: String(texto || '') }] }

/** Blocos com mídia opcional: texto (+ imagem + áudio, nessa ordem). Texto já deve vir com variáveis trocadas. */
function blocosComMidia(texto, imagemUrl, audioUrl) {
  const blocos = []
  const t = String(texto || '').trim()
  if (t) blocos.push({ tipo: 'texto', conteudo: t })
  if (imagemUrl) blocos.push({ tipo: 'imagem', url: String(imagemUrl) })
  if (audioUrl) blocos.push({ tipo: 'audio', url: String(audioUrl) })
  return blocos
}

/**
 * Envio via WF1 (WAHA/n8n) — POST /webhook/remarketing.
 * O n8n resolve chatId (check-exists), picota, simula digitação e espaça os contatos.
 * @param {{ sessao: string, contatos: Array<{telefone:string, nome?:string, blocos?:any[]}>, blocos: any[], campanhaId?: string }} args
 */
async function enviarWAHA({ sessao, contatos, blocos, campanhaId }) {
  const payload = {
    sessao: sessao || '',
    campanhaId: campanhaId || '',
    blocos: Array.isArray(blocos) ? blocos : [],
    contatos: Array.isArray(contatos) ? contatos : [],
  }
  return fetch(N8N_REMARKETING_URL, { method: 'POST', headers: n8nHeaders(), body: JSON.stringify(payload) })
}

/** Envia uma mensagem de WhatsApp por uma instância ESPECÍFICA (via WF1/WAHA). */
async function enviarWhatsAppInstancia(inst, telefone, nome, mensagem) {
  const res = await enviarWAHA({
    sessao: inst?.nomeInstancia || '',
    contatos: [{ telefone, nome: nome || '' }],
    blocos: blocosTexto(mensagem),
    campanhaId: 'atendente',
  })
  return res.ok
}

/** Resolve uid + instância + atendente ATIVO a partir do nome da instância (ou uid dado). */
async function resolverAtendentePorInstancia(instanceName, uidHint) {
  let uid = uidHint || null
  let instDoc = null
  if (uid) {
    const s = await db.collection(`users/${uid}/instances`).where('nomeInstancia', '==', instanceName).limit(1).get()
    if (!s.empty) instDoc = { id: s.docs[0].id, ...s.docs[0].data() }
  } else {
    try {
      const s = await db.collectionGroup('instances').where('nomeInstancia', '==', instanceName).limit(1).get()
      if (!s.empty) { instDoc = { id: s.docs[0].id, ...s.docs[0].data() }; uid = s.docs[0].ref.path.split('/')[1] }
    } catch (e) { console.error('collectionGroup instances (índice?):', e?.message || e); return null }
  }
  if (!uid || !instDoc) return null
  const atSnap = await db.collection(`users/${uid}/atendentes`).where('instanceId', '==', instDoc.id).limit(1).get()
  if (atSnap.empty) return null
  const atendente = { id: atSnap.docs[0].id, ...atSnap.docs[0].data() }
  if (atendente.ativo !== true) return null
  return { uid, instDoc, atendente }
}

/** Parser flexível do payload de mensagem recebida (Evolution/n8n). */
function parseMsgRecebida(body) {
  const b = body || {}
  const d = b.data || b.message || b
  const instanceName = String(b.instance || b.instanceName || b.nomeInstancia || d.instance || '').trim()
  const waha = b._waha || {}
  const key = d.key || b.key || {}
  const jid = String(key.remoteJid || b.remoteJid || b.from || d.from || b.telefone || '').trim()
  // WAHA no motor GOWS entrega o número como @lid (ID interno), não o telefone real. O n8n já resolve
  // o telefone verdadeiro em _waha.telefone — preferir ele; o jid é só fallback.
  const telefone = String(waha.telefone || jid.replace(/@.*/, '')).replace(/\D/g, '')
  const fromMe = !!(key.fromMe ?? b.fromMe ?? d.fromMe)
  const id = String(key.id ?? d.id ?? b.id ?? '').trim()
  const msg = d.message || b.message || {}
  const texto = String(
    (typeof msg === 'string' ? msg : '') ||
    msg.conversation || msg?.extendedTextMessage?.text ||
    b.texto || b.text || b.mensagem || d.text || d.conversation || '',
  ).trim()
  const nome = String(d.pushName || b.pushName || b.nome || '').trim()
  const ehGrupo = jid.includes('@g.us')
  return { instanceName, telefone, fromMe, texto, nome, ehGrupo, id }
}

/**
 * Webhook do atendente IA: recebe as mensagens que chegam nas instâncias e responde com a Grok.
 * O Evolution/n8n deve fazer POST aqui a cada mensagem recebida. Aceita ?uid= pra pular o lookup.
 */
exports.waAtendenteWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' }, async (req, res) => {
  try {
    // SEGURANÇA: só o WF2 (n8n) pode acionar o vendedor. Exige Authorization: Bearer <API_SAAS_TOKEN>.
    // Sem isso, qualquer um forjaria inbound (gasta Grok, estoura cota da vítima, trava o bot).
    if (!callbackAutorizado(req)) {
      console.warn('[waAtendente] 401 — sem/errado o Bearer (WF2 precisa mandar Authorization: Bearer <API_SAAS_TOKEN>)')
      res.status(401).json({ responder: false, erro: 'unauthorized' }); return
    }
    const body = req.body || {}
    console.log('waAtendenteWebhook recebido:', JSON.stringify(body).slice(0, 1500))
    const m = parseMsgRecebida(body)
    if (!m.instanceName || !m.telefone || m.ehGrupo) { res.status(200).json({ ok: true, ignored: 'sem instancia/telefone ou grupo' }); return }

    const uidHint = (req.query && req.query.uid) || (body._waha && body._waha.uidCliente) || null
    const resolved = await resolverAtendentePorInstancia(m.instanceName, uidHint)
    if (!resolved) { console.log('waAtendente: SEM atendente ativo (não responde/não gasta)', { instance: m.instanceName, telefone: m.telefone }); res.status(200).json({ ok: true, ignored: 'sem atendente ativo' }); return }
    const { uid, instDoc, atendente } = resolved
    console.log('waAtendente: atendente RESOLVIDO (vai responder → gasta Grok)', { instance: m.instanceName, atendenteId: atendente.id, instanceIdAtendente: atendente.instanceId, instanceIdResolvido: instDoc.id, grupoId: atendente.grupoId, ativo: atendente.ativo, telefone: m.telefone })

    const gSnap = await db.doc(`users/${uid}/productGroups/${atendente.grupoId}`).get()
    if (!gSnap.exists) { res.status(200).json({ ok: true, ignored: 'sem produto' }); return }
    const grupo = gSnap.data()

    const convRef = db.doc(`users/${uid}/waConversas/${m.telefone}`)
    const convSnap = await convRef.get()
    const conv = convSnap.exists ? convSnap.data() : { messages: [] }
    const historico = Array.isArray(conv.messages) ? conv.messages : []
    const agora = Date.now()

    // Dedup: o WAHA pode reentregar a MESMA mensagem (retry do webhook, ou dispara message E message.any).
    // Sem isso a IA gera 2 respostas diferentes pro mesmo texto. Claim atômico do messageId (à prova de corrida).
    if (m.id) {
      let duplicado = false
      await db.runTransaction(async (tx) => {
        const s = await tx.get(convRef)
        if (s.exists && s.data().ultimoMsgId === m.id) { duplicado = true; return }
        tx.set(convRef, { ultimoMsgId: m.id }, { merge: true })
      })
      if (duplicado) { res.status(200).json({ responder: false, ignored: 'mensagem duplicada' }); return }
    }

    // fromMe = mensagem que SAIU deste número. Pode ser (a) eco do próprio bot, (b) o dono respondendo manual.
    // ⚠️ O WAHA no motor GOWS NÃO manda 'source' confiável (vem sempre 'app'), então NÃO dá pra usar _waha.source
    // pra distinguir bot × dono — se usasse, o bot se pausava sozinho após cada resposta.
    // Detecção por CONTEÚDO: se o texto do fromMe está contido na última resposta da IA → é eco do bot (ignora).
    // Sem texto (mídia/echo) também ignora. Texto NOVO saindo = o dono respondeu manual → handover (pausa 6h).
    if (m.fromMe) {
      const ultima = String(conv.iaUltimaMsg || '')
      const ehEco = !m.texto || (!!ultima && ultima.includes(m.texto))
      if (ehEco) { res.status(200).json({ responder: false, ignored: 'eco do bot' }); return }
      await convRef.set({ pausadoAte: agora + HANDOVER_HORAS * 3600000, fupStatus: null, messages: [...historico, { role: 'dono', text: m.texto, ts: agora }].slice(-30), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      res.status(200).json({ responder: false, handover: true }); return
    }

    // Bot pausado (dono assumiu) → só guarda a mensagem, não responde.
    const novoHist = [...historico, { role: 'user', text: m.texto, ts: agora }].slice(-30)
    if (conv.pausadoAte && conv.pausadoAte > agora) {
      await convRef.set({ messages: novoHist, nome: m.nome || conv.nome || '', fupStatus: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      res.status(200).json({ responder: false, pausado: true }); return
    }
    if (!m.texto) { res.status(200).json({ responder: false, ignored: 'sem texto' }); return }

    // ── Trava de CONVERSA (cota/crédito) + teto de mensagens ──
    // 1 conversa = 1 lead atendido no mês. Só cobra na 1ª msg do lead no mês; depois é continuação (grátis)
    // até o teto de mensagens. Sem cota/crédito → não responde (não gasta Grok).
    const mesConversa = mesAtualStr()
    let tenantDoc = {}
    try { const ts = await db.doc(`tenants/${uid}`).get(); tenantDoc = ts.exists ? ts.data() : {} } catch (_) {}
    const ehAdminTenant = String(tenantDoc.email || '').toLowerCase() === ADMIN_EMAIL || await ehAdminUid(uid)
    const novaConversaMes = conv.conversaMes !== mesConversa
    let fonteConsumo = null
    if (!ehAdminTenant) {
      if (novaConversaMes) {
        const gate = decidirCotaConversa(uid, tenantDoc)
        if (!gate.ok) {
          console.log('waAtendente: SEM cota/crédito de conversa (não responde)', { uid, telefone: m.telefone })
          await convRef.set({ messages: novoHist, nome: m.nome || conv.nome || '', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
          res.status(200).json({ responder: false, semCota: true }); return
        }
        fonteConsumo = gate.fonte
      } else if ((Number(conv.botMsgsMes) || 0) >= TETO_MSGS_CONVERSA) {
        console.log('waAtendente: teto de mensagens da conversa atingido (encerra)', { uid, telefone: m.telefone, teto: TETO_MSGS_CONVERSA })
        await convRef.set({ messages: novoHist, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        res.status(200).json({ responder: false, limiteMsgs: true }); return
      }
    }

    // Monta o prompt e chama a Grok (com o contexto do lead, se veio de um evento)
    const messages = [
      { role: 'system', content: montarSystemAtendente(grupo, conv.leadContexto) },
      ...novoHist.slice(-16).map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: x.text })),
    ]
    let respostaIA = ''
    try { respostaIA = await callGrok(messages, { model: GROK_MODEL_ATENDENTE, uso: { uid, atendenteId: atendente.id } }) } catch (e) { console.error('atendente Grok', e?.message || e) }
    respostaIA = injetarCheckouts(respostaIA, grupo)
    // Grok falhou/vazio: libera o claim do messageId (ultimoMsgId=null) pra um retry do WAHA reprocessar
    // (senão o retry seria deduplicado e o lead ficaria sem resposta).
    if (!respostaIA) { await convRef.set({ messages: novoHist, fupStatus: null, ultimoMsgId: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.status(200).json({ responder: false, semResposta: true }); return }

    // O ENVIO é feito pelo WF2 (n8n/WAHA) com digitação humana. A Cloud Function só devolve o texto pronto.

    // Custo de IA (Gastos CRM)
    try { const mesId = new Date(agora).toISOString().slice(0, 7); await db.doc(`tenants/${uid}`).set({ iaUso: { [mesId]: admin.firestore.FieldValue.increment(1) } }, { merge: true }) } catch (_) {}

    // Consome 1 conversa (crédito antes da cota) na 1ª msg do lead no mês.
    // Consumo ATÔMICO: transação "claim" em conversaMes garante que 2 msgs quase juntas (ou reativo+proativo)
    // do mesmo lead no mês NÃO cobrem 2x. Só quem grava o mês (1ª vez) debita.
    if (fonteConsumo) {
      let consumir = false
      try {
        await db.runTransaction(async (tx) => {
          const s = await tx.get(convRef)
          if (!(s.exists && s.data().conversaMes === mesConversa)) { tx.set(convRef, { conversaMes: mesConversa }, { merge: true }); consumir = true }
        })
        if (consumir) await consumirConversa(uid, fonteConsumo)
      } catch (e) { console.error('consumirConversa (claim)', e?.message || e) }
    }

    // IC (Initiate Checkout): o vendedor mandou um link de checkout nesta resposta?
    const ic = atingiuCheckout(grupo, respostaIA)

    await convRef.set({
      messages: [...novoHist, { role: 'assistant', text: respostaIA, ts: Date.now() }].slice(-30),
      iaUltimaMsg: respostaIA, atendenteId: atendente.id, grupoId: atendente.grupoId, nome: m.nome || conv.nome || '',
      conversaMes: mesConversa, botMsgsMes: novaConversaMes ? 1 : (Number(conv.botMsgsMes) || 0) + 1,
      ...(convSnap.exists ? {} : { criadaEm: admin.firestore.FieldValue.serverTimestamp() }),
      ...(ic ? { atingiuCheckout: true, atingiuCheckoutEm: admin.firestore.FieldValue.serverTimestamp() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    // Follow-up: o lead respondeu e o bot respondeu → (re)arma a janela de silêncio.
    await armarFollowup(convRef, grupo, atendente)

    // Mídias (imagem/áudio) ligadas ao nó enviado → saem logo após o texto.
    const midias = midiasDisparadas(grupo, respostaIA)
    // Contrato WF2: `blocos` = texto + mídias. O n8n picota o texto e envia cada bloco na ordem.
    const blocos = [{ tipo: 'texto', conteudo: respostaIA }, ...midias.map((md) => md.tipo === 'audio' ? { tipo: 'audio', url: md.url } : { tipo: 'imagem', url: md.url, legenda: '' })]
    res.status(200).json({ responder: true, blocos, mensagem: respostaIA, resposta: respostaIA, midias })
  } catch (err) {
    console.error('waAtendenteWebhook', err?.message || err)
    res.status(200).json({ responder: false, ok: false })
  }
})

/**
 * Relatório dos vendedores (Comercial → Relatório). Agrega por vendedor/produto:
 * pessoas atendidas, IC (chegaram ao checkout), vendas (webhook de compra do grupo),
 * conversão, tokens consumidos, e a série diária pro gráfico.
 * data: { mes?: 'YYYY-MM' } (default = mês atual, pros tokens)
 */
exports.getVendedorRelatorio = onCall({ region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const de = Number(request.data?.de) || null
  const ate = Number(request.data?.ate) || null
  // Meses (YYYY-MM) do período pros tokens — senão, o mês atual.
  const mesesTokens = []
  if (de && ate) {
    let y = new Date(de).getUTCFullYear(), m = new Date(de).getUTCMonth()
    const yF = new Date(ate).getUTCFullYear(), mF = new Date(ate).getUTCMonth()
    while (y < yF || (y === yF && m <= mF)) { mesesTokens.push(`${y}-${String(m + 1).padStart(2, '0')}`); m++; if (m > 11) { m = 0; y++ } }
  } else { mesesTokens.push(new Date().toISOString().slice(0, 7)) }
  const dentroPeriodo = (c) => {
    if (!de && !ate) return true
    const ts = c.criadaEm?.toMillis?.() ?? c.updatedAt?.toMillis?.() ?? 0
    if (!ts || (de && ts < de) || (ate && ts > ate)) return false
    return true
  }

  const [atSnap, gSnap, cSnap] = await Promise.all([
    db.collection(`users/${uid}/atendentes`).get(),
    db.collection(`users/${uid}/productGroups`).get(),
    db.collection(`users/${uid}/waConversas`).limit(5000).get(),
  ])
  const atendentes = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const grupos = {}
  gSnap.docs.forEach((d) => { grupos[d.id] = { nome: d.data().nome || '', imagem: d.data().imagem || d.data().imagemUrl || null, produtos: (Array.isArray(d.data().produtos) ? d.data().produtos : []).map((x) => String(x).toLowerCase()) } })
  const conversas = cSnap.docs.map((d) => ({ telefone: d.id, ...d.data() })).filter(dentroPeriodo)

  // Compras (leads com evento de compra) → telefone => [produtos comprados]
  const compraPorTel = {}
  try {
    const lSnap = await db.collection(`users/${uid}/leads`).limit(5000).get()
    lSnap.docs.forEach((d) => {
      const v = d.data()
      if (canonicalEvento(v.evento) !== 'order_status.purchase_approved') return
      const tel = String(v.telefone || '').replace(/\D/g, '')
      if (!tel) return
      ;(compraPorTel[tel] = compraPorTel[tel] || []).push(String(v.produto || '').toLowerCase())
    })
  } catch (_) {}
  const comprouDoGrupo = (tel, grupoId) => {
    const prods = compraPorTel[String(tel || '').replace(/\D/g, '')]
    if (!prods || !prods.length) return false
    const g = grupos[grupoId]
    if (!g || !g.produtos.length) return true // grupo sem produtos definidos → qualquer compra conta
    return prods.some((p) => g.produtos.includes(p))
  }

  const porDia = {}
  const vendedores = atendentes.map((a) => {
    const convs = conversas.filter((c) => c.atendenteId === a.id)
    const pessoas = convs.length
    const ic = convs.filter((c) => c.atingiuCheckout === true).length
    let vendas = 0
    convs.forEach((c) => {
      const vendeu = comprouDoGrupo(c.telefone, a.grupoId || c.grupoId)
      if (vendeu) vendas++
      const ts = c.criadaEm?.toMillis?.() ?? c.updatedAt?.toMillis?.() ?? 0
      if (ts) {
        const dia = new Date(ts).toISOString().slice(0, 10)
        const dd = (porDia[dia] = porDia[dia] || { pessoas: 0, ic: 0, vendas: 0 })
        dd.pessoas++; if (c.atingiuCheckout) dd.ic++; if (vendeu) dd.vendas++
      }
    })
    const tokens = mesesTokens.reduce((s, mm) => s + ((a.tokensMes && a.tokensMes[mm]) || 0), 0)
    return {
      atendenteId: a.id, nome: a.nome || 'Vendedor', grupoId: a.grupoId || '',
      grupoNome: grupos[a.grupoId]?.nome || '', grupoImagem: grupos[a.grupoId]?.imagem || null, ativo: a.ativo === true,
      pessoas, ic, vendas,
      conversaoIC: pessoas ? Math.round((ic / pessoas) * 100) : 0,
      conversaoVenda: pessoas ? Math.round((vendas / pessoas) * 100) : 0,
      tokens, tokensTotal: a.tokensTotal || 0,
    }
  })

  const total = vendedores.reduce((acc, r) => ({ pessoas: acc.pessoas + r.pessoas, ic: acc.ic + r.ic, vendas: acc.vendas + r.vendas, tokens: acc.tokens + r.tokens }), { pessoas: 0, ic: 0, vendas: 0, tokens: 0 })
  const serie = Object.keys(porDia).sort().map((dia) => ({ dia, ...porDia[dia] }))
  return { de, ate, total, vendedores, serie }
})

/**
 * Callback do WF1 (WAHA/n8n): registra que um contato de um disparo foi ENVIADO de verdade.
 * O n8n chama POST {API_SAAS_URL}/disparos com header Authorization: Bearer <API_SAAS_TOKEN>.
 * Body: { campanhaId, sessao, telefone, chatId, nome, enviadoEm }
 * Conta a entrega por contato de forma idempotente (doc por telefone) → retry não conta duas vezes.
 * campanhaId genérico (remarketing/funil/automacao) é ignorado — só conta disparos de verdade.
 */
exports.disparos = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, erro: 'method' }); return }
    const token = process.env.API_SAAS_TOKEN || ''
    if (!token || String(req.headers.authorization || '') !== `Bearer ${token}`) {
      console.warn('[disparos] 401 — token invalido/faltando (Authorization: Bearer <API_SAAS_TOKEN>)')
      res.status(401).json({ ok: false, erro: 'unauthorized' }); return
    }

    const b = req.body || {}
    const campanhaId = String(b.campanhaId || '').trim()
    // O campanhaId vem com o sufixo do lote (ex.: rmkt_123_0). O disparo é o id SEM o _<lote>.
    const disparoId = campanhaId.replace(/_\d+$/, '')
    const sessao = String(b.sessao || b.nomeInstancia || '').trim()
    const telefone = String(b.telefone || '').replace(/\D/g, '')
    console.log('[disparos] IN', { campanhaId, disparoId, sessao, telefone })
    if (!disparoId || !sessao || !telefone) { console.warn('[disparos] faltam campos', { disparoId, sessao, telefone }); res.status(200).json({ ok: true, ignored: 'faltam campos' }); return }

    // Resolve o uid dono da instância pelo nome da sessão (mesmo índice do atendente).
    let uid = null
    try {
      const s = await db.collectionGroup('instances').where('nomeInstancia', '==', sessao).limit(1).get()
      if (!s.empty) uid = s.docs[0].ref.path.split('/')[1]
    } catch (e) { console.error('disparos collectionGroup (índice?):', e?.message || e) }
    if (!uid) { console.warn('[disparos] sessao sem dono', sessao); res.status(200).json({ ok: true, ignored: 'sessao sem dono' }); return }

    // Conta a entrega (idempotente por telefone) E incrementa `enviados` (campo que o front lê),
    // auto-concluindo quando todos os contatos foram contabilizados.
    const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
    const entregaRef = dRef.collection('entregas').doc(telefone)
    let dbg = { achou: false }
    await db.runTransaction(async (tx) => {
      const dDoc = await tx.get(dRef)
      if (!dDoc.exists) { dbg = { achou: false }; return }
      const eDoc = await tx.get(entregaRef)
      if (eDoc.exists) { dbg = { achou: true, jaContado: true }; return } // já contado
      const d = dDoc.data()
      const enviados = (d.enviados || 0) + 1
      const total = d.total || 0
      const concluido = total > 0 && (enviados + (d.falhas || 0)) >= total && d.status === 'enviando'
      dbg = { achou: true, enviados, falhas: d.falhas || 0, total, concluido }
      tx.set(entregaRef, { telefone, nome: b.nome || '', chatId: b.chatId || '', enviadoEm: b.enviadoEm || null, ts: admin.firestore.FieldValue.serverTimestamp() })
      tx.set(dRef, { enviados, entregues: admin.firestore.FieldValue.increment(1), ...(concluido ? { status: 'concluido', concluidoEm: admin.firestore.FieldValue.serverTimestamp() } : {}), ultimaEntregaEm: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    })
    console.log('[disparos] OUT', { uid, disparoId, ...dbg })

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('disparos', err?.message || err)
    res.status(200).json({ ok: false })
  }
})

// ═════════════════════ DISPARO EM MASSA WhatsApp (WF4 /disparo) ═════════════════════
// WF4 aceita máx 50 contatos por POST e 1 campanha por sessão. Pra listas grandes, quebramos
// em lotes de 50 e disparamos um de cada vez: o próximo lote sai quando o WF4 avisa
// /campanhaConcluida do anterior. Progresso real vem por /disparoOk e /disparoFalha.
const WF4_DISPARO_URL = 'https://n8n.autsend.online/webhook/disparo'
const DISPARO_LOTE_MAX = 50

/** Resolve o uid dono da instância pelo nome da sessão (índice collectionGroup instances.nomeInstancia). */
async function uidPorSessao(sessao) {
  try {
    const s = await db.collectionGroup('instances').where('nomeInstancia', '==', sessao).limit(1).get()
    if (!s.empty) return s.docs[0].ref.path.split('/')[1]
  } catch (e) { console.error('uidPorSessao (índice?):', e?.message || e) }
  return null
}

/** Valida o Bearer token dos callbacks do n8n (API_SAAS_TOKEN). */
function callbackAutorizado(req) {
  const token = process.env.API_SAAS_TOKEN || ''
  if (!token) return false
  const got = Buffer.from(String(req.headers.authorization || ''))
  const exp = Buffer.from(`Bearer ${token}`)
  return got.length === exp.length && crypto.timingSafeEqual(got, exp)
}

/** Monta os blocos de um contato: texto personalizado (+ imagem + áudio, nessa ordem). */
function montarBlocosDisparo(template, nome, telefone, imagemUrl, audioUrl, produto = '', email = '') {
  const blocos = []
  const texto = replaceVariables(template || '', { nome: nome || '', telefone: telefone || '', email: email || '' }, { nome: produto || '' }).trim()
  if (texto) blocos.push({ tipo: 'texto', conteudo: texto })
  if (imagemUrl) blocos.push({ tipo: 'imagem', url: imagemUrl })
  if (audioUrl) blocos.push({ tipo: 'audio', url: audioUrl })
  return blocos
}

/** Dispara UM lote pro WF4. campanhaId = `${disparoId}_${loteIndex}`. */
async function dispararLoteWF4(uid, disparoId, loteIndex, sessao, webhookUrl) {
  const loteSnap = await db.doc(`users/${uid}/disparos/${disparoId}/lotes/${loteIndex}`).get()
  if (!loteSnap.exists) return false
  const lote = loteSnap.data()
  // Timeout de 15s: se o n8n não responder (travado/fora do ar), NÃO trava a função (o botão destrava).
  // webhookUrl = WF4 (disparo) OU WF1 (remarketing). Mesmo contrato: { sessao, campanhaId, contatos:[{...,blocos}] }.
  let ok = false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(webhookUrl || WF4_DISPARO_URL, {
      method: 'POST', headers: n8nHeaders(),
      body: JSON.stringify({ sessao: sessao || '', campanhaId: `${disparoId}_${loteIndex}`, contatos: lote.contatos || [] }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    ok = res.ok || res.status === 202
  } catch (e) { console.error('dispararLoteWF4 fetch (timeout/erro):', e?.message || e) }
  await db.doc(`users/${uid}/disparos/${disparoId}`).set({ loteAtual: loteIndex, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  return ok
}

/**
 * Inicia um disparo em massa. Quebra a lista em lotes de 50, grava os lotes e dispara o 1º.
 * Os próximos saem sozinhos no /campanhaConcluida. 1 disparo ATIVO por instância.
 * data: { sessao, nomeDisparo, mensagem (template), imagemUrl?, audioUrl?, contatos: [{telefone, nome}] }
 */
exports.iniciarDisparoWA = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTenantAtivo(uid)
  await assertRateLimit(request, 'disparo_wa', 10)
  const d = request.data || {}
  const sessao = String(d.sessao || '').trim()
  const nomeDisparo = String(d.nomeDisparo || '').trim() || `Disparo ${new Date().toISOString().slice(0, 10)}`
  const template = String(d.mensagem || '')
  const imagemUrl = d.imagemUrl ? String(d.imagemUrl) : null
  const audioUrl = d.audioUrl ? String(d.audioUrl) : null
  const contatosRaw = Array.isArray(d.contatos) ? d.contatos : []
  if (!sessao) throw new HttpsError('invalid-argument', 'Sem instância.')
  if (!contatosRaw.length) throw new HttpsError('invalid-argument', 'Lista de contatos vazia.')

  // A instância é do usuário?
  const instSnap = await db.collection(`users/${uid}/instances`).where('nomeInstancia', '==', sessao).limit(1).get()
  if (instSnap.empty) throw new HttpsError('failed-precondition', 'Instância não encontrada.')

  // 1 disparo ATIVO por instância: se já tem um 'enviando' RECENTE nessa sessão, barra.
  // Guard de validade: um 'enviando' parado há muito tempo provavelmente travou (WF4 não concluiu) → não bloqueia.
  const naSessao = await db.collection(`users/${uid}/disparos`).where('sessao', '==', sessao).get()
  const agoraMs = Date.now()
  const TRAVA_MS = 2 * 60 * 60 * 1000 // 2h
  const temAtivoRecente = naSessao.docs.some((x) => {
    const d = x.data()
    if (d.status !== 'enviando') return false
    const ts = d.updatedAt?.toMillis?.() ?? d.createdAt?.toMillis?.() ?? 0
    return (agoraMs - ts) < TRAVA_MS
  })
  if (temAtivoRecente) throw new HttpsError('failed-precondition', 'instancia_ocupada')

  // Limpa/dedup contatos e monta os blocos por contato.
  const vistos = new Set()
  const contatos = []
  for (const c of contatosRaw) {
    const tel = String(c.telefone || c.phone || '').replace(/\D/g, '')
    if (tel.length < 8 || vistos.has(tel)) continue
    vistos.add(tel)
    const nome = String(c.nome || c.name || '').trim()
    const blocos = montarBlocosDisparo(template, nome, tel, imagemUrl, audioUrl)
    if (!blocos.length) continue
    contatos.push({ telefone: tel, nome, blocos })
  }
  if (!contatos.length) throw new HttpsError('invalid-argument', 'Nenhum contato válido.')

  // Quebra em lotes de 50.
  const lotes = []
  for (let i = 0; i < contatos.length; i += DISPARO_LOTE_MAX) lotes.push(contatos.slice(i, i + DISPARO_LOTE_MAX))

  const disparoId = `disparo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
  const batch = db.batch()
  batch.set(dRef, {
    nomeDisparo, sessao, mensagem: template, total: contatos.length, totalLotes: lotes.length,
    loteAtual: 0, enviados: 0, falhas: 0, status: 'enviando', origem: 'disparo', webhookUrl: WF4_DISPARO_URL,
    temImagem: !!imagemUrl, temAudio: !!audioUrl,
    imagemUrl: imagemUrl || null, audioUrl: audioUrl || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  lotes.forEach((cs, i) => batch.set(dRef.collection('lotes').doc(String(i)), { contatos: cs, enviado: false }))
  await batch.commit()

  // Dispara o 1º lote (os próximos saem no /campanhaConcluida).
  await dispararLoteWF4(uid, disparoId, 0, sessao, WF4_DISPARO_URL)

  return { disparoId, total: contatos.length, totalLotes: lotes.length }
})

/**
 * Remarketing em massa — MESMA máquina do disparador (lotes de 50 + callbacks + progresso),
 * mas apontando pro WF1 (/remarketing) em vez do WF4. O contato carrega produto pra {nome_produto}.
 * data: { sessao, nomeDisparo?, mensagem (template), imagemUrl?, audioUrl?, contatos: [{telefone, nome, produto?, email?}] }
 */
exports.iniciarRemarketingWA = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertTenantAtivo(uid)
  await assertRateLimit(request, 'remarketing_wa', 10)
  const d = request.data || {}
  const sessao = String(d.sessao || '').trim()
  const nomeDisparo = String(d.nomeDisparo || '').trim() || `Remarketing ${new Date().toISOString().slice(0, 10)}`
  const template = String(d.mensagem || '')
  const imagemUrl = d.imagemUrl ? String(d.imagemUrl) : null
  const audioUrl = d.audioUrl ? String(d.audioUrl) : null
  const contatosRaw = Array.isArray(d.contatos) ? d.contatos : []
  if (!sessao) throw new HttpsError('invalid-argument', 'Sem instância.')
  if (!contatosRaw.length) throw new HttpsError('invalid-argument', 'Nenhum contato selecionado.')

  const instSnap = await db.collection(`users/${uid}/instances`).where('nomeInstancia', '==', sessao).limit(1).get()
  if (instSnap.empty) throw new HttpsError('failed-precondition', 'Instância não encontrada.')

  // 1 campanha ATIVA por instância (compartilha a trava com o disparador — mesmo número).
  const naSessao = await db.collection(`users/${uid}/disparos`).where('sessao', '==', sessao).get()
  const agoraMs = Date.now()
  const TRAVA_MS = 2 * 60 * 60 * 1000
  const ocupada = naSessao.docs.some((x) => {
    const dd = x.data()
    if (dd.status !== 'enviando') return false
    const ts = dd.updatedAt?.toMillis?.() ?? dd.createdAt?.toMillis?.() ?? 0
    return (agoraMs - ts) < TRAVA_MS
  })
  if (ocupada) throw new HttpsError('failed-precondition', 'instancia_ocupada')

  // Dedup + blocos por contato (com produto pra {nome_produto}).
  const vistos = new Set()
  const contatos = []
  for (const c of contatosRaw) {
    const tel = String(c.telefone || c.phone || c.numero || '').replace(/\D/g, '')
    if (tel.length < 8 || vistos.has(tel)) continue
    vistos.add(tel)
    const nome = String(c.nome || c.name || '').trim()
    const produto = String(c.produto || c.nome_produto || '').trim()
    const email = String(c.email || '').trim()
    const blocos = montarBlocosDisparo(template, nome, tel, imagemUrl, audioUrl, produto, email)
    if (!blocos.length) continue
    contatos.push({ telefone: tel, nome, blocos })
  }
  if (!contatos.length) throw new HttpsError('invalid-argument', 'Nenhum contato válido.')

  const lotes = []
  for (let i = 0; i < contatos.length; i += DISPARO_LOTE_MAX) lotes.push(contatos.slice(i, i + DISPARO_LOTE_MAX))

  const disparoId = `rmkt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
  const batch = db.batch()
  batch.set(dRef, {
    nomeDisparo, sessao, mensagem: template, total: contatos.length, totalLotes: lotes.length,
    loteAtual: 0, enviados: 0, falhas: 0, status: 'enviando', origem: 'remarketing', webhookUrl: N8N_REMARKETING_URL,
    temImagem: !!imagemUrl, temAudio: !!audioUrl, imagemUrl: imagemUrl || null, audioUrl: audioUrl || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  lotes.forEach((cs, i) => batch.set(dRef.collection('lotes').doc(String(i)), { contatos: cs, enviado: false }))
  await batch.commit()

  await dispararLoteWF4(uid, disparoId, 0, sessao, N8N_REMARKETING_URL)

  return { disparoId, total: contatos.length, totalLotes: lotes.length }
})

/** WF4 /disparoOk — 1 contato enviado. Incrementa o contador real (idempotente por telefone). */
exports.disparoOk = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    if (!callbackAutorizado(req)) { res.status(401).json({ ok: false }); return }
    const b = req.body || {}
    const campanhaId = String(b.campanhaId || '').trim()
    const disparoId = campanhaId.replace(/_\d+$/, '')
    const sessao = String(b.sessao || '').trim()
    const telefone = String(b.telefone || '').replace(/\D/g, '')
    if (!disparoId || !sessao) { res.status(200).json({ ok: true }); return }
    const uid = await uidPorSessao(sessao)
    if (!uid) { res.status(200).json({ ok: true }); return }
    const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
    const okRef = dRef.collection('enviados').doc(telefone || `x_${campanhaId}`)
    await db.runTransaction(async (tx) => {
      const dDoc = await tx.get(dRef)
      if (!dDoc.exists) return
      const eDoc = await tx.get(okRef)
      if (eDoc.exists) return
      const d = dDoc.data()
      const enviados = (d.enviados || 0) + 1
      const total = d.total || 0
      // Auto-conclui quando todos os contatos foram contabilizados (não depende do campanhaConcluida do WF4).
      const concluido = total > 0 && (enviados + (d.falhas || 0)) >= total && d.status === 'enviando'
      tx.set(okRef, { telefone, nome: b.nome || '', ts: admin.firestore.FieldValue.serverTimestamp() })
      tx.set(dRef, { enviados, ...(concluido ? { status: 'concluido', concluidoEm: admin.firestore.FieldValue.serverTimestamp() } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    })
    res.status(200).json({ ok: true })
  } catch (err) { console.error('disparoOk', err?.message || err); res.status(200).json({ ok: false }) }
})

/** WF4 /disparoFalha — número sem WhatsApp (ou verificação falhou). Conta a falha. */
exports.disparoFalha = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    if (!callbackAutorizado(req)) { console.warn('[disparoFalha] 401 — token invalido/faltando'); res.status(401).json({ ok: false }); return }
    const b = req.body || {}
    const campanhaId = String(b.campanhaId || '').trim()
    const disparoId = campanhaId.replace(/_\d+$/, '')
    const sessao = String(b.sessao || '').trim()
    const telefone = String(b.telefone || '').replace(/\D/g, '')
    console.log('[disparoFalha] IN', { campanhaId, disparoId, sessao, telefone, motivo: b.motivo || '' })
    if (!disparoId || !sessao) { console.warn('[disparoFalha] faltam campos', { disparoId, sessao }); res.status(200).json({ ok: true }); return }
    const uid = await uidPorSessao(sessao)
    if (!uid) { console.warn('[disparoFalha] sessao sem dono', sessao); res.status(200).json({ ok: true }); return }
    const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
    const falhaRef = dRef.collection('falhas').doc(telefone || `x_${Date.now()}`)
    let dbg = { achou: false }
    await db.runTransaction(async (tx) => {
      const dDoc = await tx.get(dRef)
      if (!dDoc.exists) { dbg = { achou: false }; return }
      const fDoc = await tx.get(falhaRef)
      if (fDoc.exists) { dbg = { achou: true, jaContado: true }; return }
      const d = dDoc.data()
      const falhas = (d.falhas || 0) + 1
      const total = d.total || 0
      // Auto-conclui quando todos os contatos foram contabilizados (WF4 não avisa fim quando tudo falha).
      const concluido = total > 0 && ((d.enviados || 0) + falhas) >= total && d.status === 'enviando'
      dbg = { achou: true, enviados: d.enviados || 0, falhas, total, concluido }
      tx.set(falhaRef, { telefone, nome: b.nome || '', motivo: b.motivo || 'sem_whatsapp', detalhe: b.detalhe || '', ts: admin.firestore.FieldValue.serverTimestamp() })
      tx.set(dRef, { falhas, ...(concluido ? { status: 'concluido', concluidoEm: admin.firestore.FieldValue.serverTimestamp() } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    })
    console.log('[disparoFalha] OUT', { uid, disparoId, ...dbg })
    res.status(200).json({ ok: true })
  } catch (err) { console.error('disparoFalha', err?.message || err); res.status(200).json({ ok: false }) }
})

/** WF4 /campanhaConcluida — um LOTE terminou. Dispara o próximo, ou fecha o disparo. */
exports.campanhaConcluida = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  try {
    if (!callbackAutorizado(req)) { console.warn('[campanhaConcluida] 401 — token invalido/faltando'); res.status(401).json({ ok: false }); return }
    const b = req.body || {}
    const campanhaId = String(b.campanhaId || '').trim()
    const mm = campanhaId.match(/_(\d+)$/)
    const loteIndex = mm ? parseInt(mm[1], 10) : 0
    const disparoId = campanhaId.replace(/_\d+$/, '')
    const sessao = String(b.sessao || '').trim()
    console.log('[campanhaConcluida] IN', { campanhaId, disparoId, loteIndex, sessao })
    if (!disparoId || !sessao) { console.warn('[campanhaConcluida] faltam campos', { disparoId, sessao }); res.status(200).json({ ok: true }); return }
    const uid = await uidPorSessao(sessao)
    if (!uid) { console.warn('[campanhaConcluida] sessao sem dono', sessao); res.status(200).json({ ok: true }); return }
    const dRef = db.doc(`users/${uid}/disparos/${disparoId}`)
    const dSnap = await dRef.get()
    if (!dSnap.exists) { console.warn('[campanhaConcluida] disparo nao encontrado', disparoId); res.status(200).json({ ok: true }); return }
    const disp = dSnap.data()
    await dRef.collection('lotes').doc(String(loteIndex)).set({ enviado: true }, { merge: true }).catch(() => {})
    const proximo = loteIndex + 1
    if (proximo < (disp.totalLotes || 1)) {
      console.log('[campanhaConcluida] proximo lote', { disparoId, proximo })
      await dispararLoteWF4(uid, disparoId, proximo, sessao, disp.webhookUrl)
      res.status(200).json({ ok: true, proximoLote: proximo }); return
    }
    console.log('[campanhaConcluida] CONCLUIDO', { disparoId })
    await dRef.set({ status: 'concluido', concluidoEm: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    res.status(200).json({ ok: true, concluido: true })
  } catch (err) { console.error('campanhaConcluida', err?.message || err); res.status(200).json({ ok: false }) }
})

/** WF4 /campanhaRejeitada — o WF4 recusou um lote (sessão ocupada/inválida). Marca erro. */
exports.campanhaRejeitada = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    if (!callbackAutorizado(req)) { res.status(401).json({ ok: false }); return }
    const b = req.body || {}
    const disparoId = String(b.campanhaId || '').trim().replace(/_\d+$/, '')
    const sessao = String(b.sessao || '').trim()
    if (!disparoId || !sessao) { res.status(200).json({ ok: true }); return }
    const uid = await uidPorSessao(sessao)
    if (!uid) { res.status(200).json({ ok: true }); return }
    await db.doc(`users/${uid}/disparos/${disparoId}`).set({ status: 'erro', erroMsg: b.mensagem || b.motivo || 'Campanha rejeitada pelo servidor', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
    res.status(200).json({ ok: true })
  } catch (err) { console.error('campanhaRejeitada', err?.message || err); res.status(200).json({ ok: false }) }
})

/**
 * Simulador de conversa: testa o atendente IA sem WhatsApp (usa o MESMO cérebro).
 * Recebe o histórico da conversa e devolve a próxima resposta da IA (com checkout injetado).
 */
exports.atendenteSimular = onCall({ region: 'us-central1', timeoutSeconds: 60, enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertRateLimit(request, 'simulador', 30)
  const { grupoId, mensagens } = request.data || {}
  if (!grupoId) throw new HttpsError('invalid-argument', 'Produto não informado.')
  const gSnap = await db.doc(`users/${uid}/productGroups/${grupoId}`).get()
  if (!gSnap.exists) throw new HttpsError('not-found', 'Produto não encontrado.')
  const grupo = gSnap.data()
  const hist = Array.isArray(mensagens) ? mensagens.slice(-16) : []
  const messages = [
    { role: 'system', content: montarSystemAtendente(grupo) },
    ...hist.map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.text || '') })),
  ]
  let resposta = ''
  try { resposta = await callGrok(messages, { model: GROK_MODEL_ATENDENTE }) } catch (e) { throw new HttpsError('internal', 'A IA não respondeu agora. Tente de novo.') }
  resposta = injetarCheckouts(resposta, grupo)
  const midias = midiasDisparadas(grupo, resposta)
  return { resposta, midias }
})

/** Checa (no servidor, sem cache) se o cliente ainda pode criar instância. Usado antes de abrir o form. */
exports.instanciaPodeCriar = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const s = await db.doc(`tenants/${uid}`).get()
  const t = s.exists ? s.data() : {}
  const isAdm = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const snap = await db.collection(`users/${uid}/instances`).get()
  const atual = snap.size
  const limite = isAdm ? -1 : (Number(limitesDoTenant(t).instancias) || 0)
  return { pode: isAdm || atual < limite, atual, limite }
})

/**
 * Cria um Tracker (webhook custom) com TRAVA de plano no servidor (limite `trackers`).
 * Conta os webhooks 'custom' existentes; cria o doc no Firestore (server-side) e devolve id + URL.
 */
exports.criarTrackerCustom = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  // Trava: quantos trackers (webhooks custom) o cliente já tem.
  const snap = await db.collection(`users/${uid}/webhooks`).get()
  const atuais = snap.docs.filter((d) => d.data()?.tipo === 'custom').length
  assertPodeCriarRecurso(request, tenant, 'trackers', atuais, 'tracker(s)')
  const p = request.data || {}
  const ref = await db.collection(`users/${uid}/webhooks`).add({
    tipo: 'custom',
    status: 'testing',
    nome: String(p.nome || 'Webhook custom').slice(0, 200),
    plataforma: p.plataforma || '',
    loja: p.loja || '',
    fieldMap: (p.fieldMap && typeof p.fieldMap === 'object') ? p.fieldMap : {},
    eventRules: Array.isArray(p.eventRules) ? p.eventRules : [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  const url = `https://us-central1-afiliadocdnx.cloudfunctions.net/customWebhook?webhookId=${ref.id}&userId=${uid}`
  await ref.set({ webhookUrl: url }, { merge: true })
  return { id: ref.id, webhookUrl: url }
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
      erro: x.erro || null, valorMensal: x.valorMensal || 29.9, vozAtiva: !!x.vozAtiva,
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
      erro: x.erro || null, restritoMotivo: x.restritoMotivo || null, valorMensal: x.valorMensal || 29.9, vozAtiva: !!x.vozAtiva,
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

/** Valida a API key da Telnyx (lista números — 200 = key ok, mesmo endpoint que a gente usa). */
async function validarTelnyxKey(apiKey) {
  try {
    const r = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=1', { headers: { Authorization: `Bearer ${apiKey}` } })
    if (r.ok) return true
    // fallback: alguns escopos de key não leem phone_numbers mas leem balance
    const r2 = await fetch('https://api.telnyx.com/v2/balance', { headers: { Authorization: `Bearer ${apiKey}` } })
    return r2.ok
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
  if (!ok) throw new HttpsError('failed-precondition', 'API key inválida. Atenção: use o VALOR da chave (mostrado ao CRIAR a key), não o "API Key ID". Como o valor fica encriptado, crie uma NOVA key em Telnyx → API Keys → Create API Key e copie na hora.')
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

/** Pacotes de recarga SMS EUA (Telnyx): chave → { priceId, quantidade, valor }. */
function pacotesCreditoSMS() {
  return {
    '500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_500, quantidade: 500, valor: 49 },
    '1000': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_1000, quantidade: 1000, valor: 89 },
    '2500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_2500, quantidade: 2500, valor: 199 },
  }
}

/** Pacotes de recarga SMS BRASIL (SMSDev): chave → { priceId, quantidade, valor }. */
function pacotesCreditoSmsBr() {
  return {
    '500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_500_BR, quantidade: 500, valor: 119 },
    '1000': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_1000_BR, quantidade: 1000, valor: 199 },
    '2500': { priceId: process.env.STRIPE_PRICE_CREDITO_SMS_2500_BR, quantidade: 2500, valor: 449 },
  }
}

/** priceId de crédito SMS BR → quantidade (usado no webhook). */
function creditosSmsBrDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoSmsBr()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].quantidade }
  return 0
}

/** priceId de crédito → quantidade de SMS (usado no webhook). */
function creditosDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoSMS()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].quantidade }
  return 0
}

/** Pacotes de crédito de CONVERSA do Vendedor IA (pagamento único): chave → { priceId, quantidade, valor }. */
function pacotesCreditoConversa() {
  return {
    '100': { priceId: process.env.STRIPE_PRICE_CONVERSA_100 || 'price_1TvpvkLvVsGXtCnTaGcuWTHy', quantidade: 100, valor: 79 },
    '300': { priceId: process.env.STRIPE_PRICE_CONVERSA_300 || 'price_1TvpwjLvVsGXtCnTCHwVISvR', quantidade: 300, valor: 199 },
    '1000': { priceId: process.env.STRIPE_PRICE_CONVERSA_1000 || 'price_1TvpxALvVsGXtCnTBDS6KYS5', quantidade: 1000, valor: 590 },
  }
}

/** priceId de crédito de conversa → quantidade (usado no webhook). */
function creditosConversaDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoConversa()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].quantidade }
  return 0
}

// Assinatura de Vendedor IA avulso (R$45/mês). Cada unidade: +1 slot de vendedor (conversas compradas à parte).
const STRIPE_PRICE_VENDEDOR = process.env.STRIPE_PRICE_VENDEDOR || 'price_1TvpjNLvVsGXtCnT0yuuxqzM'

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
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Autsend · ${pacote.quantidade} créditos de SMS` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('smsCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/** Cria o checkout Stripe (pagamento único) pra comprar um PACOTE de conversas do Vendedor IA. */
exports.conversaCriarCheckoutCredito = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const pacote = pacotesCreditoConversa()[String(request.data?.pacote || '')]
  if (!pacote || !pacote.priceId) throw new HttpsError('invalid-argument', 'Pacote de conversas inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Recarga ainda não configurada.')
  const stripe = require('stripe')(key)
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'credito_conversa', uid, quantidade: String(pacote.quantidade) }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true,
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Autsend · ${pacote.quantidade} conversas do Vendedor IA` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('conversaCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/** Cria o checkout Stripe (assinatura R$45/mês) pra comprar Vendedor(es) IA avulso(s). +1 slot de vendedor cada. */
exports.vendedorCriarCheckout = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const qtd = Math.max(1, Math.min(10, Number(request.data?.quantidade) || 1))
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !STRIPE_PRICE_VENDEDOR) throw new HttpsError('failed-precondition', 'A compra de vendedor ainda não foi configurada.')
  const stripe = require('stripe')(key)
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'vendedor', uid, quantidade: String(qtd) }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true,
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_VENDEDOR, quantity: qtd }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      subscription_data: { metadata: meta, description: `Autsend · ${qtd} Vendedor(es) IA` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('vendedorCriarCheckout', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

/** Cria o checkout Stripe embutido pra recarregar créditos de SMS BRASIL (SMSDev). */
exports.smsBrCriarCheckoutCredito = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const pacote = pacotesCreditoSmsBr()[String(request.data?.pacote || '')]
  if (!pacote || !pacote.priceId) throw new HttpsError('invalid-argument', 'Pacote de crédito inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Recarga ainda não configurada.')
  const stripe = require('stripe')(key)
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'credito_sms_br', uid, quantidade: String(pacote.quantidade) }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true,
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Autsend · ${pacote.quantidade} créditos de SMS (Brasil)` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('smsBrCriarCheckoutCredito', e)
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
  // Piso à prova de adulteração: contador server-only em tenants/ (cliente não pode apagar disparos p/ zerar).
  try {
    const s = await db.doc(`tenants/${uid}`).get()
    const contador = Number((s.exists ? s.data() : {})?.emailUso?.[mesAtualStr()]) || 0
    return Math.max(quota, contador)
  } catch (_) { return quota }
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
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Autsend · ${pacote.quantidade} créditos de e-mail` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('emailCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

// ═════════════════════ CALL MARKETING IA — créditos, cota e helpers ═════════════════════
// Ligação IA (Telnyx Voice). Unidade cobrada = SEGUNDO (crédito e cota são guardados em segundos).
// Preço de venda: R$ 1,50/min. Pacotes vendidos no Perfil. Crédito é consumido ANTES da cota do plano.

const CALL_PRECO_POR_MIN = 1.5

/** Pacotes de minutos de Ligação IA: chave (min) → { priceId, segundos, valor }. */
function pacotesCreditoCall() {
  return {
    '30': { priceId: process.env.STRIPE_PRICE_CREDITO_CALL_30, segundos: 30 * 60, valor: 44.9 },
    '60': { priceId: process.env.STRIPE_PRICE_CREDITO_CALL_60, segundos: 60 * 60, valor: 84.9 },
    '120': { priceId: process.env.STRIPE_PRICE_CREDITO_CALL_120, segundos: 120 * 60, valor: 159.9 },
  }
}

/** priceId de crédito de call → quantidade de SEGUNDOS (usado no webhook do Stripe). */
function creditosCallDoPriceStripe(priceId) {
  if (!priceId) return 0
  const p = pacotesCreditoCall()
  for (const k of Object.keys(p)) { if (p[k].priceId && p[k].priceId === priceId) return p[k].segundos }
  return 0
}

/** Segundos de ligação usados no mês (todos os canais/contas) — pra exibição. */
async function callSegundosUsadosNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let total = 0
  try {
    const ds = await db.collection(`users/${uid}/callLogs`).get()
    ds.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicio.getTime()) total += Number(x.segundos) || 0 })
  } catch (_) {}
  return total
}

/** Segundos pagos pela COTA DO PLANO neste mês (crédito é consumido primeiro; BYO/própria não conta). */
async function quotaCallSegUsadaNoMes(uid) {
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0, 0, 0, 0)
  let quota = 0
  try {
    const ds = await db.collection(`users/${uid}/callLogs`).get()
    ds.forEach((d) => {
      const x = d.data()
      if (x.contaPropria === true) return
      const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0)
      if (cm >= inicio.getTime()) quota += Number(x.cotaConsumidaSeg) || 0
    })
  } catch (_) {}
  return quota
}

/** Saldo disponível de ligação (em segundos): crédito comprado + o que resta da cota do plano. */
async function callSaldoDisponivel(uid, tenant, ehAdmin) {
  if (ehAdmin) return { creditoSeg: Infinity, cotaRestanteSeg: Infinity, totalSeg: Infinity, ilimitado: true }
  const lim = limitesDoTenant(tenant)
  const creditoSeg = Math.max(0, Number(tenant.callCreditos) || 0)
  const cotaTotalSeg = (Number(lim.callMin) || 0) * 60
  const usada = await quotaCallSegUsadaNoMes(uid)
  const cotaRestanteSeg = Math.max(0, cotaTotalSeg - usada)
  return { creditoSeg, cotaRestanteSeg, totalSeg: creditoSeg + cotaRestanteSeg, ilimitado: false }
}

/**
 * Debita os segundos cobrados de uma ligação atendida: crédito ANTES da cota.
 * Retorna { creditoConsumidoSeg, cotaConsumidaSeg }. BYO/própria e admin não debitam.
 */
async function debitarSegundosCall(uid, tenant, ehAdmin, contaPropria, segundos) {
  const seg = Math.max(0, Math.round(Number(segundos) || 0))
  if (!seg || ehAdmin || contaPropria) return { creditoConsumidoSeg: 0, cotaConsumidaSeg: 0 }
  const creditos = Math.max(0, Number(tenant.callCreditos) || 0)
  const creditoConsumidoSeg = Math.min(seg, creditos)
  const cotaConsumidaSeg = seg - creditoConsumidoSeg // o resto cai na cota do plano
  if (creditoConsumidoSeg > 0) {
    await db.doc(`tenants/${uid}`).set({ callCreditos: admin.firestore.FieldValue.increment(-creditoConsumidoSeg) }, { merge: true })
  }
  return { creditoConsumidoSeg, cotaConsumidaSeg }
}

/** Cria o checkout Stripe (pagamento único) pra comprar minutos de Ligação IA. */
exports.callCriarCheckoutCredito = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  const pacoteKey = String(request.data?.pacote || '')
  const pacote = pacotesCreditoCall()[pacoteKey]
  if (!pacote || !pacote.priceId) throw new HttpsError('invalid-argument', 'Pacote de minutos inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Recarga ainda não configurada.')
  const stripe = require('stripe')(key)
  const appUrl = (process.env.APP_URL || 'https://autsend.com.br').replace(/\/+$/, '')
  const email = (request.auth?.token?.email || tenant.email || '').toLowerCase() || undefined
  const meta = { tipo: 'credito_call', uid, segundos: String(pacote.segundos) }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'payment',
      line_items: [{ price: pacote.priceId, quantity: 1 }],
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : (email ? { customer_email: email } : {})),
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Autsend · ${Math.round(pacote.segundos / 60)} min de Ligação IA` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('callCriarCheckoutCredito', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout.')
  }
})

// ═════════════════════ CALL MARKETING IA — motor de voz (Telnyx Call Control) ═════════════════════
// Fase 1: TORPEDO DE VOZ IA (mão única). Grok escreve o roteiro → Telnyx fala (TTS) na ligação.
// Fluxo: POST /v2/calls → webhook call.answered → speak (SSML c/ velocidade) → speak.ended → hangup
//        → call.hangup → debita segundos (crédito antes da cota) → grava callLog.

const CALL_VOZES_PTBR = ['Polly.Camila-Neural', 'Polly.Vitoria-Neural', 'Polly.Ricardo', 'Polly.Thiago-Neural']
const CALL_VOZ_PADRAO = 'Polly.Camila-Neural'

/** Config de voz compartilhada (Voice API application / connection). */
async function getTelnyxVoiceConfig() {
  const base = await getTelnyxConfig()
  let connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || ''
  try {
    const s = await db.doc('config/telnyx').get()
    if (s.exists) connectionId = s.data().voiceConnectionId || connectionId
  } catch (_) {}
  return { apiKey: base.apiKey, connectionId }
}

/**
 * Resolve a config de LIGAÇÃO. Espelha resolverTelnyxEnvio.
 * forcar: 'api' → conta Telnyx própria (BYO) · 'eua' → nossa conta · null → auto (BYO primeiro).
 * Retorna { cfg: { apiKey, connectionId, from }, propria } ou { erro }.
 */
async function resolverCallEnvio(uid, ehAdmin, forcar) {
  if (forcar !== 'eua') {
    const prov = await getTelnyxProviderCliente(uid)
    if (prov) {
      const vc = await getTelnyxVoiceConfig()
      // BYO usa a key do cliente; a connection precisa existir na conta dele (configurada na integração).
      return { cfg: { apiKey: prov.apiKey, connectionId: prov.voiceConnectionId || vc.connectionId, from: prov.from }, propria: true }
    }
    if (forcar === 'api') return { erro: 'Conecte sua conta Telnyx para ligar por aqui.' }
  }
  const vc = await getTelnyxVoiceConfig()
  if (!vc.apiKey || !vc.connectionId) return { erro: 'A Ligação IA ainda não foi ativada pela plataforma.' }
  const num = await getTelnyxNumeroCliente(uid)
  if (num) return { cfg: { apiKey: vc.apiKey, connectionId: vc.connectionId, from: num.number }, propria: false }
  const base = await getTelnyxConfig()
  if (ehAdmin && base.from) return { cfg: { apiKey: vc.apiKey, connectionId: vc.connectionId, from: base.from }, propria: false }
  return { erro: 'Você ainda não tem um número (EUA). Vá em Call → Integração e ative a voz no seu chip.' }
}

/** Grok escreve um roteiro curto e natural pra ser FALADO na ligação (não é texto pra ler). */
// Objetivos de campanha (chave do front → instrução detalhada pro Grok).
const CALL_OBJETIVOS = {
  carrinho_abandonado: 'recuperar um carrinho abandonado e trazer o cliente de volta para finalizar a compra',
  boas_vindas: 'dar as boas-vindas a quem acabou de comprar e reforçar que fez uma ótima escolha',
  pos_venda: 'fazer um acompanhamento pós-venda, checar a satisfação e oferecer ajuda',
  recuperar_assinatura: 'reativar uma assinatura cancelada ou um pagamento que foi recusado',
  oferta: 'apresentar uma oferta especial e incentivar a compra agora',
  lembrete: 'lembrar o cliente sobre um prazo, evento ou pagamento pendente',
}
// Tom/emoção (chave do front → instrução pro Grok).
const CALL_TONS = {
  persuasivo: 'persuasivo e convincente, usando gatilhos de venda',
  engracado: 'leve e bem-humorado, arrancando um sorriso',
  direto: 'direto e objetivo, sem rodeios',
  emocional: 'emocional, tocando nas dores e desejos da pessoa',
  amigavel: 'amigável e caloroso, como um amigo próximo',
  urgente: 'com senso de urgência e escassez, incentivando a agir já',
}

// Idioma do roteiro (chave do front → instrução pro Grok).
const CALL_IDIOMAS = {
  pt: 'português do Brasil',
  en: 'inglês (English)',
  es: 'espanhol (Español)',
}

async function gerarRoteiroCallGrok({ objetivo, tom, produto, categoria, idioma }) {
  const obj = CALL_OBJETIVOS[objetivo] || objetivo || 'recuperar uma compra abandonada'
  const tomTxt = CALL_TONS[tom] || 'amigável e direto'
  const lang = CALL_IDIOMAS[idioma] || CALL_IDIOMAS.pt
  const sys = `Você é um VENDEDOR experiente que escreve roteiros CURTOS de ligação telefônica. O roteiro DEVE ser escrito 100% em ${lang}. O texto será FALADO em voz alta por uma IA — então escreva EXATAMENTE como se fala, não como se escreve. Regras rígidas: ` +
    'soe 100% humano, com emoção e calor na voz; frases curtas e naturais para a fala; no máximo 60 palavras; UMA única chamada pra ação clara no fim. ' +
    'PROIBIDO (porque fica ruim quando falado): emojis, markdown, hashtags, aspas, parênteses, asteriscos, qualquer símbolo; abreviações ou gírias escritas; soletrar links ou e-mails; siglas soltas. ' +
    'Escreva tudo por extenso como a pessoa fala. Números e valores por extenso quando fizer sentido. Use pontuação natural para dar ritmo de fala. ' +
    'IMPORTANTE: use exatamente {nome_cliente} onde entra o nome da pessoa e {nome_produto} onde entra o nome do produto (mantenha essas duas variáveis em inglês assim mesmo, com as chaves) — NUNCA invente nomes nem escreva colchetes você mesmo.'
  const usr = `Escreva o roteiro da ligação como um vendedor de verdade, em ${lang}.\n` +
    `Objetivo: ${obj}.\n` +
    `Tom/emoção: seja ${tomTxt}.\n` +
    `Produto: ${produto || '{nome_produto}'}.\n` +
    `O que é o produto (para você entender): ${categoria || 'não informado'}.\n` +
    `Comece cumprimentando por {nome_cliente}. Responda APENAS com o roteiro falado, sem aspas.`
  const content = await callGrok([{ role: 'system', content: sys }, { role: 'user', content: usr }])
  return String(content || '').trim().slice(0, 600)
}

/** Monta o SSML aplicando a velocidade (1.0–1.5 → prosody rate). */
function montarSSMLCall(texto, velocidade) {
  const v = Math.min(1.5, Math.max(0.8, Number(velocidade) || 1))
  const rate = Math.round(v * 100) + '%'
  const safe = semAcentosManter(texto)
  return `<speak><prosody rate="${rate}">${safe}</prosody></speak>`
}

/** Escapa caracteres de SSML/XML (mantém acentos — TTS PT-BR precisa deles). */
function semAcentosManter(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ───────── ElevenLabs — voz humanizada (gera o áudio; a Telnyx só toca) ─────────
// Cada "atendente" mapeia pra um voice_id do ElevenLabs, POR CANAL (EUA/BR).
// Defaults públicos garantem funcionamento; o cliente cola seus voice_id no .env.
function elevenVoiceId(voz, canal) {
  const pref = canal === 'api' ? 'BR' : 'EUA'
  const cfg = {
    'Polly.Camila-Neural': process.env[`ELEVEN_VOICE_${pref}_CAMILA`],
    'Polly.Vitoria-Neural': process.env[`ELEVEN_VOICE_${pref}_VITORIA`],
    'Polly.Thiago-Neural': process.env[`ELEVEN_VOICE_${pref}_THIAGO`],
    'Polly.Ricardo': process.env[`ELEVEN_VOICE_${pref}_RICARDO`],
  }
  const fallback = {
    'Polly.Camila-Neural': 'EXAVITQu4vr4xnSDxMaL',
    'Polly.Vitoria-Neural': '21m00Tcm4TlvDq8ikWAM',
    'Polly.Thiago-Neural': 'ErXwobaYiN019PkySvjV',
    'Polly.Ricardo': 'TxGEqnHWrfWFTfGW9XjX',
  }
  return cfg[voz] || fallback[voz] || fallback['Polly.Camila-Neural']
}

/** Gera o áudio (mp3) do texto com a voz humanizada do ElevenLabs. Retorna um Buffer. */
async function elevenTTS(texto, voz, velocidade, canal) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('Voz humanizada não configurada (ELEVENLABS_API_KEY).')
  const voiceId = elevenVoiceId(voz, canal)
  const speed = Math.min(1.2, Math.max(0.7, Number(velocidade) || 1))
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: String(texto || '').slice(0, 900),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed },
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 180)}`)
  }
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

/**
 * Áudio com CACHE: mesmo (canal+voz+velocidade+texto) → gera 1 vez só no ElevenLabs.
 * Economiza créditos na pré-escuta repetida e em roteiros sem {nome_cliente} (áudio igual pra todos).
 * Retorna o mp3 em base64.
 */
async function getOrGenAudioB64(texto, voz, velocidade, canal) {
  const speed = Math.min(1.2, Math.max(0.7, Number(velocidade) || 1))
  const hash = crypto.createHash('sha1').update(`${canal || 'eua'}|${voz}|${speed}|${texto}`).digest('hex')
  const ref = db.doc(`callAudioCache/${hash}`)
  try {
    const snap = await ref.get()
    if (snap.exists && snap.data().audioB64) {
      ref.set({ usadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
      return snap.data().audioB64
    }
  } catch (_) {}
  const buf = await elevenTTS(texto, voz, velocidade, canal)
  const audioB64 = buf.toString('base64')
  ref.set({ audioB64, createdAt: admin.firestore.FieldValue.serverTimestamp(), usadoEm: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {})
  return audioB64
}

/**
 * Gera o áudio de UM contato reaproveitando o cache ao máximo, SEM soar picotado:
 * quebra o roteiro em FRASES (após . ! ? … ou quebra de linha). A frase que tem o nome é gerada
 * inteira (o nome flui natural dentro dela); as pausas ficam só nos limites naturais entre frases.
 * Frases SEM variável são geradas 1x e reaproveitadas por toda a campanha (cache).
 */
async function gerarAudioContatoB64(rawTexto, contato, voz, velocidade, canal) {
  const texto = String(rawTexto || '').trim()
  if (!texto) return await getOrGenAudioB64('', voz, velocidade, canal)
  const frases = texto.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  const lista = frases.length ? frases : [texto]
  const buffers = []
  for (const frase of lista) {
    const filled = replaceVariables(frase, { nome: contato.nome || '', telefone: contato.telefone || '', email: contato.email || '' }, { nome: contato.produto || '' }).trim()
    if (!filled) continue
    const b64 = await getOrGenAudioB64(filled, voz, velocidade, canal)
    buffers.push(Buffer.from(b64, 'base64'))
  }
  if (!buffers.length) return await getOrGenAudioB64(texto, voz, velocidade, canal)
  return Buffer.concat(buffers).toString('base64')
}

/** Limpa o cache de áudio não usado há +7 dias (evita crescer sem limite). */
exports.limparCacheAudioCall = onSchedule({ schedule: 'every 24 hours', region: 'us-central1' }, async () => {
  const limite = Date.now() - 7 * 24 * 60 * 60 * 1000
  const snap = await db.collection('callAudioCache').where('usadoEm', '<', admin.firestore.Timestamp.fromMillis(limite)).limit(400).get()
  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  if (!snap.empty) await batch.commit()
})

/**
 * Inicia uma ligação torpedo. Cria a chamada e guarda o contexto em callPending/{ccid}
 * pro webhook saber o que falar e como debitar. Retorna { ok, ccid } ou lança.
 */
async function iniciarLigacaoTorpedo(cfg, to, ctx) {
  // 1) Áudio: se veio um template de áudio PRÓPRIO (audioUrl), a Telnyx toca esse mp3/wav direto —
  //    sem gerar na IA. Senão, gera o áudio da voz IA emendando trechos do cache.
  const usarAudioProprio = !!ctx.audioUrl
  const audioB64 = usarAudioProprio ? null : await gerarAudioContatoB64(
    ctx.texto,
    { nome: ctx.nome || '', produto: ctx.produto || '', telefone: to, email: ctx.email || '' },
    ctx.voz || CALL_VOZ_PADRAO, ctx.velocidade, ctx.canal,
  )
  const mensagemLog = usarAudioProprio
    ? `[Áudio: ${ctx.audioNome || 'template'}]`
    : replaceVariables(ctx.texto, { nome: ctx.nome || '', telefone: to, email: ctx.email || '' }, { nome: ctx.produto || '' })
  // 2) Cria a chamada na Telnyx.
  const res = await fetch('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection_id: cfg.connectionId, to, from: cfg.from, timeout_secs: 30, timeout_limit_secs: 180 }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || `HTTP ${res.status}`
    throw new Error(msg)
  }
  const ccid = data?.data?.call_control_id
  if (!ccid) throw new Error('A Telnyx não retornou o identificador da chamada.')
  // 3) Guarda o contexto + o áudio (a Telnyx busca via telnyxAudioServe e toca).
  await db.doc(`callPending/${ccid}`).set({
    uid: ctx.uid, apiKey: cfg.apiKey, from: cfg.from, to,
    texto: mensagemLog, voz: ctx.voz || CALL_VOZ_PADRAO, velocidade: ctx.velocidade || 1, audioB64,
    audioUrl: ctx.audioUrl || null,
    canal: ctx.canal || 'eua', contaPropria: !!ctx.contaPropria,
    leadId: ctx.leadId || null, produto: ctx.produto || '', nome: ctx.nome || '', agenteNome: ctx.agenteNome || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { ok: true, ccid }
}

/** Endpoint público que devolve o mp3 da ligação (a Telnyx busca essa URL pra tocar). */
exports.telnyxAudioServe = onRequest({ region: 'us-central1', timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
  try {
    const ccid = String(req.query.ccid || '')
    if (!ccid) { res.status(400).send('sem ccid'); return }
    const snap = await db.doc(`callPending/${ccid}`).get()
    const b64 = snap.exists ? snap.data().audioB64 : null
    if (!b64) { res.status(404).send('não encontrado'); return }
    const buf = Buffer.from(b64, 'base64')
    res.set('Content-Type', 'audio/mpeg')
    res.set('Content-Length', String(buf.length))
    res.set('Cache-Control', 'no-store')
    res.status(200).send(buf)
  } catch (err) {
    console.error('telnyxAudioServe', err?.message || err)
    res.status(500).send('erro')
  }
})

/** Ação da Telnyx: falar (TTS). */
async function telnyxSpeak(apiKey, ccid, ssml, voz) {
  await fetch(`https://api.telnyx.com/v2/calls/${ccid}/actions/speak`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: ssml, payload_type: 'ssml', voice: voz || CALL_VOZ_PADRAO, language: 'pt-BR' }),
  })
}
/** Ação da Telnyx: tocar um áudio (mp3 do ElevenLabs). */
async function telnyxPlayback(apiKey, ccid, audioUrl) {
  await fetch(`https://api.telnyx.com/v2/calls/${ccid}/actions/playback_start`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl }),
  })
}
/** Ação da Telnyx: desligar. */
async function telnyxHangup(apiKey, ccid) {
  await fetch(`https://api.telnyx.com/v2/calls/${ccid}/actions/hangup`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: '{}',
  })
}

const AUDIO_BASE_URL = 'https://us-central1-afiliadocdnx.cloudfunctions.net/telnyxAudioServe'

/** Webhook da Telnyx Voice (Call Control). Conduz o torpedo e debita os segundos ao desligar. */
exports.telnyxVoiceWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  try {
    const evt = req.body?.data || {}
    const tipo = evt.event_type || ''
    const ccid = evt.payload?.call_control_id
    if (!ccid) { res.status(200).json({ ok: true, ignored: 'sem ccid' }); return }
    const pendRef = db.doc(`callPending/${ccid}`)
    const pendSnap = await pendRef.get()
    if (!pendSnap.exists) { res.status(200).json({ ok: true, ignored: 'sem contexto' }); return }
    const p = pendSnap.data()

    if (tipo === 'call.answered') {
      await pendRef.set({ answeredAtMs: Date.now(), status: 'atendida' }, { merge: true })
      if (p.audioUrl) {
        await telnyxPlayback(p.apiKey, ccid, p.audioUrl) // áudio próprio do cliente (mp3/wav no Storage)
      } else if (p.audioB64) {
        await telnyxPlayback(p.apiKey, ccid, `${AUDIO_BASE_URL}?ccid=${encodeURIComponent(ccid)}`) // voz humanizada (ElevenLabs)
      } else {
        await telnyxSpeak(p.apiKey, ccid, montarSSMLCall(p.texto || '', p.velocidade), p.voz) // fallback TTS
      }
      res.status(200).json({ ok: true }); return
    }
    if (tipo === 'call.playback.ended' || tipo === 'call.speak.ended') {
      await telnyxHangup(p.apiKey, ccid) // terminou de tocar → desliga (fecha o torpedo)
      res.status(200).json({ ok: true }); return
    }
    if (tipo === 'call.hangup') {
      const atendida = !!p.answeredAtMs
      const segundos = atendida ? Math.max(1, Math.round((Date.now() - p.answeredAtMs) / 1000)) : 0
      const ehAdmin = await ehUidAdmin(p.uid)
      const tSnap = await db.doc(`tenants/${p.uid}`).get()
      const tenant = tSnap.exists ? tSnap.data() : {}
      const deb = await debitarSegundosCall(p.uid, tenant, ehAdmin, p.contaPropria, segundos)
      await db.collection(`users/${p.uid}/callLogs`).add({
        canal: p.canal || 'eua', telefone: p.to || '', nome: p.nome || '', produto: p.produto || '',
        leadId: p.leadId || null, agenteNome: p.agenteNome || '', mensagem: p.texto || '',
        status: atendida ? 'atendida' : 'nao_atendida',
        segundos, creditoConsumidoSeg: deb.creditoConsumidoSeg, cotaConsumidaSeg: deb.cotaConsumidaSeg,
        contaPropria: !!p.contaPropria, ccid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      await pendRef.delete().catch(() => {})
      res.status(200).json({ ok: true, segundos }); return
    }
    res.status(200).json({ ok: true, ignored: tipo }); return
  } catch (err) {
    console.error('telnyxVoiceWebhook', err?.message || err)
    res.status(200).json({ ok: false }) // 200 pra Telnyx não reenfileirar infinito
  }
})

/** Pré-escuta: gera o áudio ElevenLabs do roteiro e devolve como data URL (a mesma voz da ligação). */
exports.callPreviewVoz = onCall({ region: 'us-central1', timeoutSeconds: 30, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const d = request.data || {}
  const texto = String(d.texto || '').trim()
  if (!texto) throw new HttpsError('invalid-argument', 'Escreva ou gere o roteiro primeiro.')
  try {
    // Usa o mesmo stitching da ligação (nome de exemplo "Maria") — pré-aquece o cache dos trechos fixos.
    const audioB64 = await gerarAudioContatoB64(texto.slice(0, 800), { nome: 'Maria', produto: d.produto || 'o produto', telefone: '', email: '' }, d.voz || CALL_VOZ_PADRAO, d.velocidade, d.canal)
    return { audio: `data:audio/mpeg;base64,${audioB64}` }
  } catch (err) {
    throw new HttpsError('internal', err.message || 'Não consegui gerar a pré-escuta.')
  }
})

/** Builder do Agente IA: Grok escreve o roteiro falado da ligação. */
exports.callGerarRoteiro = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const d = request.data || {}
  const texto = await gerarRoteiroCallGrok({ objetivo: d.objetivo, tom: d.tom, produto: d.produto, categoria: d.categoria, idioma: d.idioma })
  if (!texto) throw new HttpsError('internal', 'Não consegui gerar o roteiro agora. Tente de novo.')
  return { texto }
})

/** Ativa a voz no chip EUA do cliente: associa o número à Voice API application (connection). */
/**
 * Lista TODOS os números de voz (EUA) do cliente pra tela "Ativar voz": comprados no Autsend
 * (users/{uid}/smsNumeros) + os da conta Telnyx própria/BYO (users/{uid}/smsProviders[].numeros),
 * deduplicados pelo número. Cada item: { id, numero, vozAtiva, fonte:'app'|'byo' }.
 */
exports.callListarNumerosVoz = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const norm = (s) => String(s || '').replace(/\D/g, '')
  const vistos = new Set()
  const out = []
  // 1) Comprados no app (conta da plataforma)
  const numSnap = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').get()
  for (const d of numSnap.docs) {
    const x = d.data(); const num = x.number
    if (!num) continue
    vistos.add(norm(num))
    out.push({ id: d.id, numero: num, vozAtiva: !!x.vozAtiva, fonte: 'app' })
  }
  // 2) Conta(s) Telnyx própria(s) do cliente (BYO)
  const provSnap = await db.collection(`users/${uid}/smsProviders`).get()
  for (const p of provSnap.docs) {
    const px = p.data()
    const nums = Array.isArray(px.numeros) ? px.numeros : []
    const ativas = new Set((Array.isArray(px.vozAtivas) ? px.vozAtivas : []).map(norm))
    for (const num of nums) {
      const nn = norm(num)
      if (!nn || vistos.has(nn)) continue // dedup: já apareceu como comprado no app
      vistos.add(nn)
      out.push({ id: `byo:${p.id}:${nn}`, numero: num, vozAtiva: ativas.has(nn), fonte: 'byo' })
    }
  }
  return { numeros: out }
})

exports.callAtivarVozNoChip = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const numeroId = String(request.data?.numeroId || '')
  const ativar = request.data?.ativar !== false // default true (compat)
  // Número da conta Telnyx PRÓPRIA (BYO): marca/desmarca a voz (soft, em smsProviders.vozAtivas).
  // A origem real da chamada pela conta do cliente entra no módulo de call center (a construir).
  if (numeroId.startsWith('byo:')) {
    const parts = numeroId.split(':'); const providerId = parts[1]; const num = parts[2] || ''
    if (!providerId || !num) throw new HttpsError('invalid-argument', 'Número inválido.')
    const op = ativar ? admin.firestore.FieldValue.arrayUnion(num) : admin.firestore.FieldValue.arrayRemove(num)
    await db.doc(`users/${uid}/smsProviders/${providerId}`).set({ vozAtivas: op }, { merge: true })
    return { ok: true, byo: true, vozAtiva: ativar }
  }
  // Número comprado no app: DESATIVAR = baixa a flag (mantém a config na Telnyx, só não usamos em ligação).
  if (!ativar) {
    const s = await db.doc(`users/${uid}/smsNumeros/${numeroId}`).get()
    if (s.exists) await s.ref.set({ vozAtiva: false }, { merge: true })
    return { ok: true, vozAtiva: false }
  }
  const vc = await getTelnyxVoiceConfig()
  if (!vc.apiKey || !vc.connectionId) throw new HttpsError('failed-precondition', 'A Ligação IA ainda não foi ativada pela plataforma.')
  const snap = await db.collection(`users/${uid}/smsNumeros`).where('status', '==', 'active').get()
  if (snap.empty) throw new HttpsError('failed-precondition', 'Você ainda não tem um número (EUA). Compre um chip em SMS → Integração.')
  let ativados = 0
  for (const doc of snap.docs) {
    if (numeroId && doc.id !== numeroId) continue // ativa só o chip escolhido
    const n = doc.data()
    if (!n.telnyxPhoneId) continue
    try {
      const r = await fetch(`https://api.telnyx.com/v2/phone_numbers/${n.telnyxPhoneId}/voice`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${vc.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: vc.connectionId }),
      })
      if (r.ok) { await doc.ref.set({ vozAtiva: true }, { merge: true }); ativados++ }
    } catch (e) { console.error('callAtivarVozNoChip', e?.message || e) }
  }
  if (!ativados) throw new HttpsError('internal', 'Não consegui ativar a voz no número. Tente de novo em instantes.')
  return { ok: true, ativados }
})

/** Dispara ligações torpedo pra uma lista de contatos. Retorna { iniciadas, erros, disparoId }. */
exports.callDisparar = onCall({ region: 'us-central1', timeoutSeconds: 300, enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const tenant = await assertTenantAtivo(uid)
  await assertTermosAceito(request, tenant)
  await assertRateLimit(request, 'call_disparar', 10)
  const ehAdmin = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const d = request.data || {}
  const canal = d.canal === 'api' ? 'api' : 'eua'
  const contatos = Array.isArray(d.contatos) ? d.contatos.slice(0, 500) : []
  if (!contatos.length) throw new HttpsError('invalid-argument', 'Nenhum contato para ligar.')

  // Áudio próprio (template de voz): a Telnyx toca esse mp3/wav; dispensa roteiro/voz/velocidade.
  const audioUrl = String(d.audioUrl || '').trim() || null
  const audioNome = String(d.audioNome || '').trim()

  // Roteiro/voz: do agente salvo ou passado direto.
  let texto = String(d.texto || '').trim()
  let voz = d.voz || CALL_VOZ_PADRAO
  let velocidade = Number(d.velocidade) || 1
  if (d.agenteId) {
    const ag = await db.doc(`users/${uid}/callAgents/${d.agenteId}`).get()
    if (ag.exists) { const a = ag.data(); texto = String(a.texto || texto); voz = a.voz || voz; velocidade = Number(a.velocidade) || velocidade }
  }
  if (!audioUrl && !texto) throw new HttpsError('invalid-argument', 'Escreva ou gere o roteiro da ligação primeiro.')
  if (!CALL_VOZES_PTBR.includes(voz)) voz = CALL_VOZ_PADRAO

  const rEnvio = await resolverCallEnvio(uid, ehAdmin, canal)
  if (rEnvio.erro) throw new HttpsError('failed-precondition', rEnvio.erro)
  const cfg = rEnvio.cfg
  const contaPropria = !!rEnvio.propria

  // Saldo (crédito + cota). BYO/própria e admin não consomem.
  if (!ehAdmin && !contaPropria) {
    const saldo = await callSaldoDisponivel(uid, tenant, ehAdmin)
    if (saldo.totalSeg <= 0) throw new HttpsError('resource-exhausted', 'Você não tem minutos de Ligação IA. Compre minutos no seu Perfil.')
  }

  let iniciadas = 0
  const erros = []
  for (const c of contatos) {
    const norm = normalizarE164(c.telefone || c.numero || '', { permitirBR: contaPropria })
    if (!norm.ok) { erros.push({ telefone: c.telefone, erro: motivoNumeroInvalido(norm.motivo) }); continue }
    try {
      // Passa o texto CRU (com variáveis) — o stitching gera só o nome/produto por valor e reaproveita o resto do cache.
      await iniciarLigacaoTorpedo(cfg, norm.e164, {
        uid, texto, voz, velocidade, canal, contaPropria, audioUrl, audioNome,
        leadId: c.leadId || null, produto: c.produto || '', nome: c.nome || '', email: c.email || '', agenteNome: d.agenteNome || '',
      })
      iniciadas++
    } catch (e) { erros.push({ telefone: norm.e164, erro: traduzErroVoz(e.message) }) }
  }

  const disparoRef = await db.collection(`users/${uid}/callDisparos`).add({
    canal, total: contatos.length, iniciadas, erros: erros.length, contaPropria,
    agenteNome: d.agenteNome || '', voz, velocidade,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { iniciadas, erros, disparoId: disparoRef.id }
})

/** Traduz erros comuns da Telnyx Voice pra PT (reaproveita o padrão do SMS). */
function traduzErroVoz(msg) {
  const s = String(msg || '')
  if (/insufficient|balance/i.test(s)) return 'Saldo insuficiente na conta Telnyx.'
  if (/not.*voice|voice.*not|connection/i.test(s)) return 'Número sem voz habilitada. Ative a voz no chip (Call → Integração).'
  if (/unauthorized|authentication|api key/i.test(s)) return 'Chave da Telnyx inválida ou sem permissão.'
  if (/invalid.*number|not a valid/i.test(s)) return 'Número de destino inválido.'
  return s || 'Falha ao iniciar a ligação.'
}

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
  const [emailsUsados, smsUsados, callSegUsados, smsBrUsados] = await Promise.all([emailsEnviadosNoMes(uid), smsEnviadosNoMes(uid), callSegundosUsadosNoMes(uid), smsBrEnviadosNoMes(uid)])
  const smsCreditos = Number(t.smsCreditos) || 0
  const emailCreditos = Number(t.emailCreditos) || 0
  const callCreditosSeg = Number(t.callCreditos) || 0
  return {
    plano: lim.plano, isAdmin: isAdm,
    nome: t.nome || (request.auth?.token?.name || '') || '',
    email: t.email || (request.auth?.token?.email || '') || '',
    fotoURL: t.fotoURL || null,
    emailsUsados, emailsLimite: isAdm ? -1 : (lim.emailsMes || 0), emailCreditos,
    smsUsados, smsLimite: isAdm ? -1 : (lim.smsMes || 0), smsCreditos,
    smsBrCreditos: Number(t.smsBrCreditos) || 0, smsBrUsados,
    // IA do construtor de e-mail (criações/edições no mês).
    iaUsados: Number(t?.iaUso?.[mesAtualStr()] || 0), iaLimite: isAdm ? -1 : (Number(lim.iaMes) || 0),
    // Vendedor IA: conversas do mês (1 conversa = 1 lead atendido no mês) + crédito comprado.
    conversasUsados: Number(t?.conversaUso?.[mesAtualStr()] || 0), conversasLimite: isAdm ? -1 : (Number(lim.conversasMes) || 0),
    conversaCreditos: Number(t.conversaCreditos) || 0,
    // Ligação IA: em minutos pra exibição (usados/limite) + crédito comprado em segundos.
    callMinUsados: Math.round((callSegUsados / 60) * 10) / 10,
    callMinLimite: isAdm ? -1 : (Number(lim.callMin) || 0),
    callCreditosSeg,
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
  // SEGURANÇA: exige assinatura Svix válida. Sem secret configurado, recusa (evita forjar
  // bounce/reclamação que pausaria o e-mail de um cliente — DoS — e inflar métricas).
  const secret = await getResendWebhookSecret()
  if (!secret) {
    console.error('resendWebhook: secret ausente — recusando (evento não verificável).')
    res.status(500).json({ error: 'webhook não configurado' }); return
  }
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : (typeof req.rawBody === 'string' ? req.rawBody : '')
  if (!verifySvixSignature(secret, req.headers || {}, raw)) {
    res.status(401).json({ error: 'assinatura inválida' }); return
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

// [REMOVIDO por segurança em 2026-07] kiwifyOnboarding — usado quando vendíamos o PLANO do app na Kiwify.
// Hoje os planos são 100% Stripe (stripeWebhook faz o provisionamento/boas-vindas). O endpoint era público
// sem token (permitia criar conta/mudar plano/derrubar cliente por payload forjado), então foi apagado.
// ⚠️ NÃO confundir com os webhooks das LOJAS dos clientes (kiwifyAbandonedCheckout/customWebhook) — esses seguem ativos.

// ───────────────────────── Stripe: checkout dos planos Autsend ─────────────────────────

/** price_... → plano do app, via env (STRIPE_PRICE_INICIAL/PADRAO/PRO). */
function planoDoPriceStripe(priceId) {
  if (!priceId) return null
  if (priceId === process.env.STRIPE_PRICE_INICIAL) return 'inicial'
  if (priceId === process.env.STRIPE_PRICE_PADRAO) return 'padrao'
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  return null
}

/**
 * Checkout EMBUTIDO de PLANO (assinatura). Funciona logado (upgrade no app) OU deslogado (landing) —
 * nesse caso a Stripe coleta o e-mail e o webhook cria a conta (garantirUsuarioKiwify). Devolve clientSecret.
 */
exports.planoCriarCheckout = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const plano = String(request.data?.plano || '')
  const price = { inicial: process.env.STRIPE_PRICE_INICIAL, padrao: process.env.STRIPE_PRICE_PADRAO, pro: process.env.STRIPE_PRICE_PRO }[plano]
  if (!price) throw new HttpsError('invalid-argument', 'Plano inválido.')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Checkout de plano ainda não configurado.')
  const stripe = require('stripe')(key)
  // Se logado (upgrade), anexa cliente/e-mail; senão a Stripe coleta o e-mail no próprio checkout.
  let customer, email
  const uid = request.auth?.uid
  if (uid) {
    try { const s = await db.doc(`tenants/${uid}`).get(); const t = s.exists ? s.data() : {}; if (t.stripeCustomerId) customer = t.stripeCustomerId; email = (request.auth?.token?.email || t.email || '').toLowerCase() || undefined } catch (_) {}
  }
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      allow_promotion_codes: true, // mostra o campo "Adicionar código promocional" no checkout
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      ...(customer ? { customer } : (email ? { customer_email: email } : {})),
      subscription_data: { description: `Autsend · Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)}` },
      redirect_on_completion: 'never',
    })
    return { clientSecret: session.client_secret }
  } catch (e) {
    console.error('planoCriarCheckout', e)
    throw new HttpsError('internal', e.message || 'Falha ao criar o checkout do plano.')
  }
})

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
  // SEGURANÇA: nunca aceitar evento sem verificar a assinatura. Sem o secret, recusa (evita forjar
  // créditos/planos com um POST falso). O secret DEVE estar configurado em produção.
  if (!whSecret) {
    console.error('stripeWebhook: STRIPE_WEBHOOK_SECRET ausente — recusando (evento não verificável).')
    res.status(500).send('Webhook não configurado'); return
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], whSecret)
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
        await registrarFaturamento(uidC, { tipo: 'credito_sms', descricao: `${quantidade} créditos de SMS`, quantidade, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, creditado: quantidade, uid: uidC }); return
      }

      // ── Recarga de crédito de SMS BRASIL (SMSDev) — soma smsBrCreditos no tenant. ──
      if (session.metadata?.tipo === 'credito_sms_br') {
        const uidC = session.metadata.uid
        let quantidade = Number(session.metadata.quantidade) || 0
        if (!quantidade) quantidade = creditosSmsBrDoPriceStripe((session.line_items?.data?.[0]?.price?.id) || null)
        if (!uidC || !quantidade) { res.status(200).json({ ok: true, ignored: 'credito_sms_br sem uid/quantidade' }); return }
        const recRef = db.doc(`tenants/${uidC}/recargasSmsBr/${session.id}`)
        if ((await recRef.get()).exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ smsBrCreditos: admin.firestore.FieldValue.increment(quantidade) }, { merge: true })
        await recRef.set({ quantidade, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        await registrarFaturamento(uidC, { tipo: 'credito_sms', descricao: `${quantidade} créditos de SMS (Brasil)`, quantidade, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, creditadoSmsBr: quantidade, uid: uidC }); return
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
        await registrarFaturamento(uidC, { tipo: 'credito_email', descricao: `${quantidade} créditos de e-mail`, quantidade, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, creditadoEmail: quantidade, uid: uidC }); return
      }

      // ── Recarga de MINUTOS de Ligação IA (pagamento único) — soma segundos no tenant. ──
      if (session.metadata?.tipo === 'credito_call') {
        const uidC = session.metadata.uid
        let segundos = Number(session.metadata.segundos) || 0
        if (!segundos) segundos = creditosCallDoPriceStripe((session.line_items?.data?.[0]?.price?.id) || null)
        if (!uidC || !segundos) { res.status(200).json({ ok: true, ignored: 'credito_call sem uid/segundos' }); return }
        const recRef = db.doc(`tenants/${uidC}/recargasCall/${session.id}`)
        const jaRec = await recRef.get()
        if (jaRec.exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ callCreditos: admin.firestore.FieldValue.increment(segundos) }, { merge: true })
        await recRef.set({ segundos, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        await registrarFaturamento(uidC, { tipo: 'credito_call', descricao: `${Math.round(segundos / 60)} min de ligação IA`, quantidade: Math.round(segundos / 60), valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, creditadoCallSeg: segundos, uid: uidC }); return
      }

      // ── Compra de INSTÂNCIA(S) de WhatsApp (assinatura) — soma ao limite via instanciasExtras. ──
      if (session.metadata?.tipo === 'instancia_wa') {
        const uidC = session.metadata.uid
        const qtd = Math.max(1, Number(session.metadata.quantidade) || 1)
        const subId = session.subscription || null
        if (!uidC) { res.status(200).json({ ok: true, ignored: 'instancia_wa sem uid' }); return }
        // Idempotência por sessão de checkout.
        const recRef = db.doc(`tenants/${uidC}/instanciaSubs/${session.id}`)
        const jaRec = await recRef.get()
        if (jaRec.exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ instanciasExtras: admin.firestore.FieldValue.increment(qtd) }, { merge: true })
        await recRef.set({ quantidade: qtd, stripeSubscriptionId: subId, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        await registrarFaturamento(uidC, { tipo: 'instancia', descricao: `${qtd} instância(s) de WhatsApp (assinatura)`, quantidade: qtd, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, instanciasExtras: qtd, uid: uidC }); return
      }

      // ── Recarga de crédito de CONVERSA do Vendedor IA (pagamento único) — soma conversaCreditos. ──
      if (session.metadata?.tipo === 'credito_conversa') {
        const uidC = session.metadata.uid
        let quantidade = Number(session.metadata.quantidade) || 0
        if (!quantidade) quantidade = creditosConversaDoPriceStripe((session.line_items?.data?.[0]?.price?.id) || null)
        if (!uidC || !quantidade) { res.status(200).json({ ok: true, ignored: 'credito_conversa sem uid/quantidade' }); return }
        const recRef = db.doc(`tenants/${uidC}/recargasConversa/${session.id}`)
        if ((await recRef.get()).exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ conversaCreditos: admin.firestore.FieldValue.increment(quantidade) }, { merge: true })
        await recRef.set({ quantidade, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        await registrarFaturamento(uidC, { tipo: 'credito_conversa', descricao: `${quantidade} conversas do Vendedor IA`, quantidade, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, creditadoConversa: quantidade, uid: uidC }); return
      }

      // ── Compra de VENDEDOR(ES) IA (assinatura) — soma vendedoresExtras (+1 slot de vendedor cada). ──
      if (session.metadata?.tipo === 'vendedor') {
        const uidC = session.metadata.uid
        const qtd = Math.max(1, Number(session.metadata.quantidade) || 1)
        const subId = session.subscription || null
        if (!uidC) { res.status(200).json({ ok: true, ignored: 'vendedor sem uid' }); return }
        const recRef = db.doc(`tenants/${uidC}/vendedorSubs/${session.id}`)
        if ((await recRef.get()).exists) { res.status(200).json({ ok: true, ja: true }); return }
        await db.doc(`tenants/${uidC}`).set({ vendedoresExtras: admin.firestore.FieldValue.increment(qtd) }, { merge: true })
        await recRef.set({ quantidade: qtd, stripeSubscriptionId: subId, valor: (session.amount_total || 0) / 100, em: admin.firestore.FieldValue.serverTimestamp() })
        await registrarFaturamento(uidC, { tipo: 'vendedor', descricao: `${qtd} Vendedor(es) IA (assinatura)`, quantidade: qtd, valor: (session.amount_total || 0) / 100, stripeId: session.id })
        res.status(200).json({ ok: true, vendedoresExtras: qtd, uid: uidC }); return
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
        await registrarFaturamento(uidN, { tipo: 'numero', descricao: `${comprados} número(s) de SMS (assinatura)`, quantidade: comprados, valor: (session.amount_total || 0) / 100, stripeId: session.id })
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
      await registrarFaturamento(uid, { tipo: 'plano', descricao: `${criado ? 'Assinou' : 'Mudou para'} o plano ${plano}`, valor: (session.amount_total || 0) / 100, stripeId: session.id })
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
        await registrarFaturamento(uidN, { tipo: 'cancelamento', descricao: `Cancelou assinatura de ${numSnap.size} número(s) de SMS`, quantidade: numSnap.size, stripeId: `cancel_num_${subId}` })
        res.status(200).json({ ok: true, numerosLiberados: numSnap.size }); return
      }

      // 1.5) Assinatura de INSTÂNCIA(S) WhatsApp? Tira do instanciasExtras e sai — não mexe no plano.
      const instSnap = await db.collectionGroup('instanciaSubs').where('stripeSubscriptionId', '==', subId).get()
      if (!instSnap.empty) {
        let revogadas = 0
        for (const doc of instSnap.docs) {
          const uidI = doc.ref.path.split('/')[1] // tenants/{uid}/instanciaSubs/{id}
          const qtd = Math.max(0, Number(doc.data().quantidade) || 0)
          if (qtd > 0) await db.doc(`tenants/${uidI}`).set({ instanciasExtras: admin.firestore.FieldValue.increment(-qtd) }, { merge: true })
          await doc.ref.delete()
          revogadas += qtd
        }
        const uidRev = instSnap.docs[0].ref.path.split('/')[1]
        await registrarFaturamento(uidRev, { tipo: 'cancelamento', descricao: `Cancelou assinatura de ${revogadas} instância(s)`, quantidade: revogadas, stripeId: `cancel_inst_${subId}` })
        res.status(200).json({ ok: true, instanciasRevogadas: revogadas }); return
      }

      // 1.6) Assinatura de VENDEDOR(ES) IA? Tira do vendedoresExtras e sai — não mexe no plano.
      const vendSnap = await db.collectionGroup('vendedorSubs').where('stripeSubscriptionId', '==', subId).get()
      if (!vendSnap.empty) {
        let revogados = 0
        for (const doc of vendSnap.docs) {
          const uidV = doc.ref.path.split('/')[1] // tenants/{uid}/vendedorSubs/{id}
          const qtd = Math.max(0, Number(doc.data().quantidade) || 0)
          if (qtd > 0) await db.doc(`tenants/${uidV}`).set({ vendedoresExtras: admin.firestore.FieldValue.increment(-qtd) }, { merge: true })
          await doc.ref.delete()
          revogados += qtd
        }
        const uidRev = vendSnap.docs[0].ref.path.split('/')[1]
        await registrarFaturamento(uidRev, { tipo: 'cancelamento', descricao: `Cancelou assinatura de ${revogados} Vendedor(es) IA`, quantidade: revogados, stripeId: `cancel_vend_${subId}` })
        res.status(200).json({ ok: true, vendedoresRevogados: revogados }); return
      }

      // 2) Assinatura de PLANO → volta pro Free (só se for mesmo a assinatura do plano do tenant).
      const snap = await db.collection('tenants').where('stripeCustomerId', '==', customerId).limit(1).get()
      if (!snap.empty) {
        const t = snap.docs[0].data()
        if (t.stripeSubscriptionId && t.stripeSubscriptionId !== subId) {
          res.status(200).json({ ok: true, ignored: 'assinatura não é a do plano' }); return
        }
        await snap.docs[0].ref.set({ plano: 'free', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        await registrarFaturamento(snap.docs[0].id, { tipo: 'cancelamento', descricao: `Cancelou o plano ${t.plano || ''} (voltou pro Free)`, stripeId: `cancel_plano_${subId}` })
        res.status(200).json({ ok: true, revogado: true }); return
      }
      res.status(200).json({ ok: true, ignored: 'tenant não encontrado pra revogar' }); return
    }

    // ── Reembolso (Stripe charge.refunded) — registra valor NEGATIVO no faturamento do cliente. ──
    if (tipo === 'charge.refunded') {
      const charge = event.data.object
      const customerId = charge.customer
      const refunded = (charge.amount_refunded || 0) / 100
      if (customerId && refunded > 0) {
        const snap = await db.collection('tenants').where('stripeCustomerId', '==', customerId).limit(1).get()
        if (!snap.empty) await registrarFaturamento(snap.docs[0].id, { tipo: 'reembolso', descricao: 'Reembolso Stripe', valor: -refunded, stripeId: `refund_${charge.id}` })
      }
      res.status(200).json({ ok: true, reembolso: refunded }); return
    }

    // ── Chargeback (Stripe charge.dispute.created) — registra valor NEGATIVO + marca alerta. ──
    if (tipo === 'charge.dispute.created') {
      const dispute = event.data.object
      const amount = (dispute.amount || 0) / 100
      let customerId = dispute.customer || null
      if (!customerId && dispute.charge) { try { const ch = await stripe.charges.retrieve(dispute.charge); customerId = ch.customer } catch (_) {} }
      if (customerId) {
        const snap = await db.collection('tenants').where('stripeCustomerId', '==', customerId).limit(1).get()
        if (!snap.empty) await registrarFaturamento(snap.docs[0].id, { tipo: 'chargeback', descricao: 'Chargeback (disputa) na Stripe', valor: -amount, stripeId: `dispute_${dispute.id}` })
      }
      res.status(200).json({ ok: true, chargeback: amount }); return
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
    // Automações de WhatsApp por GRUPO de produto — dispara se QUALQUER produto do checkout estiver no grupo.
    // 1 produto = 1 grupo (bloqueado na tela de Produtos), então basta o primeiro grupo que contém o produto.
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

    const n8nRes = await enviarWAHA({
      sessao: evolution.nomeInstancia || '',
      contatos: [{ telefone: customer.telefone, nome: customer.nome || '' }],
      blocos: blocosComMidia(mensagemFinal, autoMsg.imagemUrl, autoMsg.audioUrl),
      campanhaId: evento || 'automacao',
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
    return true // a automação de WhatsApp mandou a 1ª mensagem (o vendedor proativo cede a vez a ela)
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

/** Dispara as ações automáticas do evento: WhatsApp, E-mail, SMS e/ou Ligação IA (cada uma só se configurada e ativa). */
async function dispararAcoes(userId, leadRef, evento, customer, product, produtos) {
  const waAutoEnviou = await tryAutoSend(userId, leadRef, evento, customer, product, produtos)
  await tryAutoSendEmail(userId, leadRef, evento, customer, product, produtos)
  await tryAutoSendSMS(userId, leadRef, evento, customer, product, produtos)
  await tryAutoSendCall(userId, leadRef, evento, customer, product, produtos)
  // Vendedor proativo (Fase 3): guarda o contexto do lead e abre a conversa se não houver automação.
  await tryAtendenteEvento(userId, evento, customer, product, produtos, waAutoEnviou === true)
  // Compra aprovada → interrompe o follow-up ativo desse número (sai por "Sim" na hora).
  if (canonicalEvento(evento) === 'order_status.purchase_approved') await interromperFollowupPorCompra(userId, customer, product, produtos)
}

/**
 * Vendedor proativo (Fase 3). Quando um evento cai, o atendente ATIVO do grupo daquele produto
 * (que tenha o evento marcado no card) faz 2 coisas:
 *  1) guarda o CONTEXTO do lead (produto + evento) na conversa → o fluxo reativo abre personalizado;
 *  2) se NÃO houver automação pra aquele evento (automação tem prioridade), a IA manda a 1ª mensagem.
 */
async function tryAtendenteEvento(userId, evento, customer, product, produtos, automacaoJaEnviou) {
  try {
    const telefone = String(customer?.telefone || '').replace(/\D/g, '')
    if (!telefone) return
    const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
    const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const grupo = acharGrupo(grupos, produtos, product)
    if (!grupo) return

    // Atendente ATIVO desse grupo que tem ESTE evento marcado.
    const atSnap = await db.collection(`users/${userId}/atendentes`).where('grupoId', '==', grupo.id).get()
    const atendente = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .find((a) => a.ativo === true && Array.isArray(a.eventos) && a.eventos.includes(evento))
    if (!atendente) return

    const convRef = db.doc(`users/${userId}/waConversas/${telefone}`)
    const convSnap = await convRef.get()
    const conv = convSnap.exists ? convSnap.data() : {}
    const hist = Array.isArray(conv.messages) ? conv.messages : []

    // 1) Guarda o contexto do lead (o reativo usa isso pra personalizar a resposta).
    const leadContexto = { produto: product?.nome || '', evento, ts: Date.now() }
    await convRef.set({ leadContexto, atendenteId: atendente.id, nome: customer.nome || conv.nome || '', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })

    // 2) Automação tem prioridade: se ela já mandou a 1ª mensagem, o vendedor só reage quando o lead responder.
    if (automacaoJaEnviou) return

    // 3) Sem automação → o vendedor abre a conversa (IA gera a 1ª mensagem).
    const instSnap = await db.doc(`users/${userId}/instances/${atendente.instanceId}`).get()
    if (!instSnap.exists) return
    const inst = { id: instSnap.id, ...instSnap.data() }
    if (!inst.nomeInstancia) return

    // Trava de conversa: abrir a conversa é uma conversa nova no mês → consome 1 (crédito antes da cota).
    const mesConversa = mesAtualStr()
    let tenantDoc = {}
    try { const ts = await db.doc(`tenants/${userId}`).get(); tenantDoc = ts.exists ? ts.data() : {} } catch (_) {}
    const ehAdminTenant = String(tenantDoc.email || '').toLowerCase() === ADMIN_EMAIL || await ehAdminUid(userId)
    const novaConversaMes = conv.conversaMes !== mesConversa
    let fonteConsumo = null
    if (!ehAdminTenant && novaConversaMes) {
      const gate = decidirCotaConversa(userId, tenantDoc)
      if (!gate.ok) { console.log('tryAtendenteEvento: SEM cota/crédito de conversa (não abre)', { userId, telefone }); return }
      fonteConsumo = gate.fonte
    }

    const messages = [
      { role: 'system', content: montarSystemAtendente(grupo, leadContexto) },
      { role: 'user', content: '[INÍCIO PROATIVO] Você está começando a conversa (o lead ainda não falou). Mande a PRIMEIRA mensagem, curta e humana (1-2 frases), puxando papo com base no contexto do lead acima. Não diga que é um bot nem cite "sistema".' },
    ]
    let abertura = ''
    try { abertura = await callGrok(messages, { model: GROK_MODEL_ATENDENTE, uso: { uid: userId, atendenteId: atendente.id } }) } catch (e) { console.error('atendente abertura Grok', e?.message || e) }
    abertura = injetarCheckouts(abertura, grupo)
    if (!abertura) return

    await enviarWhatsAppInstancia(inst, telefone, customer.nome, abertura)
    try { const mesId = new Date().toISOString().slice(0, 7); await db.doc(`tenants/${userId}`).set({ iaUso: { [mesId]: admin.firestore.FieldValue.increment(1) } }, { merge: true }) } catch (_) {}
    // Consumo ATÔMICO (mesmo motivo do reativo): claim em conversaMes evita cobrar 2x.
    if (fonteConsumo) {
      let consumir = false
      try {
        await db.runTransaction(async (tx) => {
          const s = await tx.get(convRef)
          if (!(s.exists && s.data().conversaMes === mesConversa)) { tx.set(convRef, { conversaMes: mesConversa }, { merge: true }); consumir = true }
        })
        if (consumir) await consumirConversa(userId, fonteConsumo)
      } catch (e) { console.error('consumirConversa (claim)', e?.message || e) }
    }
    await convRef.set({
      messages: [...hist, { role: 'assistant', text: abertura, ts: Date.now() }].slice(-30),
      iaUltimaMsg: abertura,
      conversaMes: mesConversa, botMsgsMes: novaConversaMes ? 1 : (Number(conv.botMsgsMes) || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    await armarFollowup(convRef, grupo, atendente) // arma o follow-up após a abertura
  } catch (err) { console.error('tryAtendenteEvento', err?.message || err) }
}

/* ══════════════ FOLLOW-UP TEMPORIZADO DO ATENDENTE (nós Esperar / Condição / Mensagem) ══════════════
 * Estado por lead em users/{uid}/waConversas/{telefone}: fupStatus, fupNodeId, fupNextRunAt,
 * fupStartedAt, fupGrupoId, fupInstanceId, fupComprou. Um cron de 1 min avança o run pelo grafo.
 * Gatilho: o lead ficou em silêncio (armado após cada msg do bot; cancelado quando o lead responde). */

/** Entrada do follow-up = o nó Esperar ligado direto na bolinha do Atendente IA. */
function entradaFollowup(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  const byId = {}; nodes.forEach((n) => { byId[n.id] = n })
  const e = edges.find((ed) => ed.source === 'ia' && byId[ed.target]?.type === 'esperar')
  return e ? e.target : null
}
function msDoEsperar(node) {
  const v = Math.max(1, parseInt(node?.data?.valor ?? 5, 10) || 5)
  const u = node?.data?.unidade
  return v * (u === 'dia' ? 86400000 : u === 'hora' ? 3600000 : 60000)
}
/** O telefone comprou um produto DESTE grupo desde `desdeMs`? */
async function comprouDoGrupoDesde(uid, telefone, desdeMs, grupo) {
  try {
    if (!telefone) return false
    const prods = (Array.isArray(grupo?.produtos) ? grupo.produtos : []).map((x) => String(x).toLowerCase())
    const s = await db.collection('users').doc(uid).collection('leads').where('telefone', '==', telefone).limit(40).get()
    return s.docs.some((d) => {
      const v = d.data()
      if (canonicalEvento(v.evento) !== 'order_status.purchase_approved') return false
      const t = v.createdAt?.toMillis ? v.createdAt.toMillis() : 0
      if (t < desdeMs) return false
      if (!prods.length) return true
      return prods.includes(String(v.produto || '').toLowerCase()) || prods.includes(String(v.produtoId || '').toLowerCase())
    })
  } catch (e) { console.error('comprouDoGrupoDesde', e?.message || e); return false }
}
/** Gera uma mensagem de reativação com o MESMO cérebro (retorna cru, com marcadores). */
async function gerarReativacao(grupo, hint, hist) {
  const messages = [
    { role: 'system', content: montarSystemAtendente(grupo, null) },
    ...(Array.isArray(hist) ? hist : []).slice(-12).map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.text || '') })),
    { role: 'user', content: `[FOLLOW-UP] O lead ficou em silêncio. Mande UMA mensagem curta e natural pra reativar a conversa e retomar a venda, sem repetir o que já disse.${hint ? ' Instrução extra: ' + hint : ''}` },
  ]
  try { return await callGrok(messages, { model: GROK_MODEL_ATENDENTE }) } catch (e) { console.error('gerarReativacao', e?.message || e); return '' }
}
/** Arma/religa o follow-up após o bot mandar uma mensagem (a janela de silêncio recomeça agora). */
async function armarFollowup(convRef, grupo, atendente) {
  try {
    const entryId = entradaFollowup(grupo?.iaGraph)
    if (!entryId) return
    const node = (grupo.iaGraph.nodes || []).find((n) => n.id === entryId)
    const now = Date.now()
    await convRef.set({
      fupStatus: 'ativo', fupNodeId: entryId, fupComprou: false,
      fupStartedAt: admin.firestore.Timestamp.fromMillis(now),
      fupNextRunAt: admin.firestore.Timestamp.fromMillis(now + msDoEsperar(node)),
      fupGrupoId: atendente.grupoId, fupInstanceId: atendente.instanceId, fupAtendenteId: atendente.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch (e) { console.error('armarFollowup', e?.message || e) }
}
async function enviarBlocoWAHA(inst, telefone, nome, blocos) {
  try { await enviarWAHA({ sessao: inst?.nomeInstancia || '', contatos: [{ telefone, nome: nome || '' }], blocos, campanhaId: 'atendente-fup' }) } catch (e) { console.error('enviarBlocoWAHA', e?.message || e) }
}

/** Avança UM run de follow-up (chamado pelo cron quando o nextRunAt vence). */
async function avancarFollowup(convDoc) {
  const conv = convDoc.data()
  const telefone = convDoc.id
  const uid = convDoc.ref.parent.parent.id
  // Claim: empurra o nextRunAt pra frente antes de processar (evita reenvio se travar/crashar).
  await convDoc.ref.set({ fupNextRunAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60000) }, { merge: true })

  const gSnap = await db.doc(`users/${uid}/productGroups/${conv.fupGrupoId}`).get()
  if (!gSnap.exists) { await convDoc.ref.set({ fupStatus: null }, { merge: true }); return }
  const grupo = gSnap.data()
  const nodes = Array.isArray(grupo.iaGraph?.nodes) ? grupo.iaGraph.nodes : []
  const edges = Array.isArray(grupo.iaGraph?.edges) ? grupo.iaGraph.edges : []
  const byId = {}; nodes.forEach((n) => { byId[n.id] = n })
  const proxNos = (id) => edges.filter((e) => e.source === id).map((e) => byId[e.target]).filter(Boolean)
  const proxPorSaida = (id, handle) => {
    const cand = edges.filter((e) => e.source === id)
    const ed = handle ? cand.find((e) => e.sourceHandle === handle) : cand[0]
    return ed ? ed.target : null
  }
  const instSnap = await db.doc(`users/${uid}/instances/${conv.fupInstanceId}`).get()
  if (!instSnap.exists || !instSnap.data().nomeInstancia) { await convDoc.ref.set({ fupStatus: null }, { merge: true }); return }
  const inst = { id: instSnap.id, ...instSnap.data() }

  const startedMs = conv.fupStartedAt?.toMillis ? conv.fupStartedAt.toMillis() : Date.now()
  const comprou = conv.fupComprou === true || await comprouDoGrupoDesde(uid, telefone, startedMs, grupo)

  const hist = Array.isArray(conv.messages) ? conv.messages : []
  const enviados = []
  const finalizar = async (patch = {}) => {
    const msgs = enviados.length ? { messages: [...hist, ...enviados].slice(-30), iaUltimaMsg: enviados[enviados.length - 1].text } : {}
    await convDoc.ref.set({ ...patch, ...msgs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  }

  let cur = proxPorSaida(conv.fupNodeId) // 1º nó DEPOIS do Esperar atual (cujo tempo venceu)
  let steps = 0
  while (cur && steps < 25) {
    steps++
    const node = byId[cur]
    if (!node) { cur = null; break }

    if (node.type === 'esperar') {
      // próximo Esperar → reagenda e PARA (nova janela de silêncio)
      const now = Date.now()
      await finalizar({ fupNodeId: cur, fupComprou: false, fupStartedAt: admin.firestore.Timestamp.fromMillis(now), fupNextRunAt: admin.firestore.Timestamp.fromMillis(now + msDoEsperar(node)) })
      return
    }
    if (node.type === 'condicao') { cur = proxPorSaida(cur, comprou ? 'sim' : 'nao'); continue }
    if (node.type === 'mensagem') {
      let texto = node.data?.gerarIA !== false
        ? await gerarReativacao(grupo, node.data?.texto, [...hist, ...enviados])
        : replaceVariables(node.data?.texto || '', { nome: conv.nome || '', telefone, email: '' }, { nome: conv.leadContexto?.produto || '' })
      texto = injetarCheckouts(texto, grupo)
      const filhos = proxNos(cur)
      const midias = filhos.filter((n) => (n.type === 'imagem' || n.type === 'audio') && n.data?.url)
      if (texto) { await enviarBlocoWAHA(inst, telefone, conv.nome, blocosTexto(texto)); enviados.push({ role: 'assistant', text: texto, ts: Date.now() }) }
      for (const md of midias) await enviarBlocoWAHA(inst, telefone, conv.nome, [{ tipo: md.type, url: md.data.url }])
      const cont = filhos.find((n) => n.type !== 'imagem' && n.type !== 'audio')
      cur = cont ? cont.id : null
      continue
    }
    if (node.type === 'imagem' || node.type === 'audio') {
      if (node.data?.url) await enviarBlocoWAHA(inst, telefone, conv.nome, [{ tipo: node.type, url: node.data.url }])
      cur = proxPorSaida(cur)
      continue
    }
    // qualquer outro nó no meio do follow-up → só segue
    cur = proxPorSaida(cur)
  }
  await finalizar({ fupStatus: null }) // fim da cadeia
}

/** Cron: processa os follow-ups vencidos (mesmo padrão dos funis/lotes). */
exports.processarFollowupsAtendente = onSchedule({ schedule: 'every 1 minutes', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async () => {
  try {
    const agora = admin.firestore.Timestamp.fromMillis(Date.now())
    const snap = await db.collectionGroup('waConversas').where('fupStatus', '==', 'ativo').where('fupNextRunAt', '<=', agora).limit(300).get()
    for (const doc of snap.docs) {
      try { await avancarFollowup(doc) } catch (e) { console.error('avancarFollowup', doc.ref.path, e?.message || e) }
    }
  } catch (err) { console.error('processarFollowupsAtendente', err?.message || err) }
})

/** Compra bateu → se há follow-up ativo desse grupo pra esse número, sai por "Sim" na hora. */
async function interromperFollowupPorCompra(uid, customer, product, produtos) {
  try {
    const telefone = String(customer?.telefone || '').replace(/\D/g, '')
    if (!telefone) return
    const convRef = db.doc(`users/${uid}/waConversas/${telefone}`)
    const s = await convRef.get()
    if (!s.exists || s.data().fupStatus !== 'ativo') return
    const gSnap = await db.doc(`users/${uid}/productGroups/${s.data().fupGrupoId}`).get()
    if (!gSnap.exists) return
    if (!acharGrupo([{ id: gSnap.id, ...gSnap.data() }], produtos, product)) return // compra de outro grupo
    await convRef.set({ fupComprou: true, fupNextRunAt: admin.firestore.Timestamp.fromMillis(Date.now()) }, { merge: true })
  } catch (e) { console.error('interromperFollowupPorCompra', e?.message || e) }
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
    // Cada canal é independente: EUA (nossa conta Telnyx), API (Telnyx do cliente) e BRL (SMSDev, +55).
    for (const canal of ['eua', 'api', 'brl']) {
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

      // ── Canal BRASIL (SMSDev): só dispara pra +55; crédito-only. ──
      if (canal === 'brl') {
        const rSms = await resolverSmsBrEnvio(userId) // BYO (conta do cliente) tem prioridade
        if (rSms.erro) continue
        const normBr = normalizarE164(customer.telefone, { permitirBR: true })
        if (!normBr.ok || !String(normBr.e164).replace(/\D/g, '').startsWith('55')) continue // canal BR ignora não-+55
        if (!ehAdm && !rSms.propria) {
          const tSnap = await db.doc(`tenants/${userId}`).get()
          if ((Number(tSnap.data()?.smsBrCreditos) || 0) < 1) {
            await db.collection('users').doc(userId).collection('smsLogs').add({ leadId: leadRef.id, evento, canal: 'brl', produto: product.nome || '', telefone: normBr.e164, nome: customer.nome || '', status: 'erro', erroMsg: 'Sem créditos de SMS Brasil', mensagem: auto.mensagem || '', createdAt: admin.firestore.FieldValue.serverTimestamp() })
            continue
          }
        }
        const textoBr = replaceVariables(auto.mensagem || '', { ...customer, telefone: normBr.e164 }, product)
        let okBr = true, erroBr = null, smsdevIdBr = null
        try { const outBr = await enviarSMSDev(rSms.key, normBr.e164, textoBr); smsdevIdBr = outBr.id } catch (err) { okBr = false; erroBr = err.message || 'Falha no envio do SMS' }
        if (okBr && !ehAdm && !rSms.propria) await db.doc(`tenants/${userId}`).set({ smsBrCreditos: admin.firestore.FieldValue.increment(-1) }, { merge: true })
        const logBrRef = await db.collection('users').doc(userId).collection('smsLogs').add({ leadId: leadRef.id, evento, canal: 'brl', produto: product.nome || '', telefone: normBr.e164, nome: customer.nome || '', status: okBr ? 'enviado' : 'erro', erroMsg: erroBr, mensagem: textoBr, createdAt: admin.firestore.FieldValue.serverTimestamp() })
        // Rastreio DLR: liga a msg SMSDev ao smsLog pra o status de entrega (não entregue) atualizar o relatório depois.
        if (okBr && smsdevIdBr) {
          try {
            await db.doc(`users/${userId}/smsMensagens/${smsdevIdBr}`).set({ leadId: leadRef.id, smsLogId: logBrRef.id, canal: 'brl', to: normBr.e164, status: 'enviado', createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
            await db.doc(`smsdevIndex/${smsdevIdBr}`).set({ uid: userId }, { merge: true })
          } catch (_) {}
        }
        continue
      }

      const rEnvio = await resolverTelnyxEnvio(userId, ehAdm, canal)
      if (rEnvio.erro) continue
      const cfg = rEnvio.cfg
      const norm = normalizarE164(customer.telefone, { permitirBR: !!rEnvio.propria })
      if (!norm.ok) {
        // Número inválido: registra o motivo em vez de sumir silenciosamente, pra aparecer no relatório.
        await db.collection('users').doc(userId).collection('smsLogs').add({
          leadId: leadRef.id, evento, canal, produto: product.nome || '', telefone: customer.telefone || '', nome: customer.nome || '',
          status: 'erro', erroMsg: motivoNumeroInvalido(norm.motivo), mensagem: auto.mensagem || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        continue
      }
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

/**
 * Auto-liga (Ligação IA) pra um lead quando um evento dispara, se houver automação de call ativa.
 * Canais 'eua' (nossa conta) e 'api' (conta própria). Não altera o status do lead (canal secundário).
 * O callLog é gravado pelo webhook de voz ao desligar (status atendida/nao_atendida); falhas imediatas
 * (número inválido / sem minutos / erro ao criar a chamada) gravam um callLog 'erro' pra aparecer no relatório.
 */
async function tryAutoSendCall(userId, leadRef, evento, customer, product, produtos) {
  try {
    if (!customer.telefone) return
    const gruposSnap = await db.collection('users').doc(userId).collection('productGroups').get()
    const grupos = gruposSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const grupo = acharGrupo(grupos, produtos, product)
    const ehAdm = await ehUidAdmin(userId)
    for (const canal of ['eua', 'api']) {
      // Automação específica do grupo tem prioridade; senão a genérica do evento. Legado (sem prefixo) = eua.
      let auto = null
      if (grupo) {
        let s = await db.doc(`users/${userId}/callAutomations/${canal}__${grupo.id}__${evento}`).get()
        if (!s.exists && canal === 'eua') s = await db.doc(`users/${userId}/callAutomations/${grupo.id}__${evento}`).get()
        if (s.exists) { const d = s.data(); if (d.ativo === true && (d.roteiro || d.audioUrl)) auto = d }
      }
      if (!auto) {
        let s = await db.doc(`users/${userId}/callAutomations/${canal}__${evento}`).get()
        if (!s.exists && canal === 'eua') s = await db.doc(`users/${userId}/callAutomations/${evento}`).get()
        if (s.exists) { const d = s.data(); if (d.ativo === true && (d.roteiro || d.audioUrl) && !d.grupoId && !d.produto) auto = d }
      }
      if (!auto) continue

      const rEnvio = await resolverCallEnvio(userId, ehAdm, canal)
      if (rEnvio.erro) continue
      const cfg = rEnvio.cfg
      const contaPropria = !!rEnvio.propria
      const norm = normalizarE164(customer.telefone, { permitirBR: contaPropria })
      if (!norm.ok) {
        await db.collection('users').doc(userId).collection('callLogs').add({
          canal, leadId: leadRef.id, evento, telefone: customer.telefone || '', nome: customer.nome || '', produto: product.nome || '',
          status: 'erro', erroMsg: motivoNumeroInvalido(norm.motivo), segundos: 0, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        continue
      }
      // Saldo de minutos (só a NOSSA conta consome; admin/própria não).
      if (!ehAdm && !contaPropria) {
        const tSnap = await db.doc(`tenants/${userId}`).get()
        const saldo = await callSaldoDisponivel(userId, tSnap.exists ? tSnap.data() : {}, ehAdm)
        if (saldo.totalSeg <= 0) {
          await db.collection('users').doc(userId).collection('callLogs').add({
            canal, leadId: leadRef.id, evento, telefone: norm.e164, nome: customer.nome || '', produto: product.nome || '',
            status: 'erro', erroMsg: 'Sem minutos de Ligação IA', segundos: 0, createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          continue
        }
      }
      const voz = CALL_VOZES_PTBR.includes(auto.voz) ? auto.voz : CALL_VOZ_PADRAO
      try {
        await iniciarLigacaoTorpedo(cfg, norm.e164, {
          uid: userId, texto: auto.roteiro || '', voz, velocidade: Number(auto.velocidade) || 1, canal, contaPropria,
          audioUrl: auto.audioUrl || null, audioNome: auto.audioNome || '',
          leadId: leadRef.id, produto: product.nome || '', nome: customer.nome || '', email: customer.email || '', agenteNome: 'Automação',
        })
      } catch (e) {
        await db.collection('users').doc(userId).collection('callLogs').add({
          canal, leadId: leadRef.id, evento, telefone: norm.e164, nome: customer.nome || '', produto: product.nome || '',
          status: 'erro', erroMsg: traduzErroVoz(e.message), segundos: 0, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    }
  } catch (err) {
    console.error('Erro no auto-call:', err)
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
    if (!contato?.email || !templateId) return { ok: false, erroMsg: 'Contato sem e-mail ou template não definido' }
    const cfg = await resolverRemetente(userId, remetenteId || null)
    const from = cfg.from
    if (!cfg?.apiKey || !from) return { ok: false, erroMsg: 'Remetente de e-mail não configurado' }
    // Pausa de risco só bloqueia envios pela NOSSA conta compartilhada (não a API própria do cliente).
    const sharedKeyFn = await getSharedResendKey()
    if (!!sharedKeyFn && cfg.apiKey === sharedKeyFn && await emailPausadoUid(userId)) return { ok: false, erroMsg: 'Envios de e-mail pausados (conta em análise de risco)' }
    const tplSnap = await db.doc(`users/${userId}/emailTemplates/${templateId}`).get()
    if (!tplSnap.exists) return { ok: false, erroMsg: 'Template de e-mail não encontrado' }
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
    return { ok: true }
  } catch (err) { console.error('enviarTemplateFunil', err); return { ok: false, erroMsg: err.message || 'Falha no envio do e-mail' } }
}

/**
 * Faz uma Ligação IA de um nó de funil. canal 'eua' (nossa conta) | 'api' (própria).
 * nodeData: { roteiro, voz, velocidade }. Consome minutos (checa saldo). Retorna { ok, erroMsg }.
 * "ok" = ligação INICIADA (o atendida/não vem depois via callLog); falhas imediatas trazem o motivo.
 */
async function enviarLigacaoFunil(userId, contato, canal, nodeData) {
  try {
    if (!contato?.telefone || (!nodeData?.roteiro && !nodeData?.audioUrl)) return { ok: false, erroMsg: 'Contato sem telefone ou roteiro/áudio vazio' }
    const ehAdm = await ehUidAdmin(userId)
    const rEnvio = await resolverCallEnvio(userId, ehAdm, canal)
    if (rEnvio.erro) return { ok: false, erroMsg: rEnvio.erro }
    const cfg = rEnvio.cfg
    const contaPropria = !!rEnvio.propria
    const norm = normalizarE164(contato.telefone, { permitirBR: contaPropria })
    if (!norm.ok) return { ok: false, erroMsg: motivoNumeroInvalido(norm.motivo) }
    if (!ehAdm && !contaPropria) {
      const tSnap = await db.doc(`tenants/${userId}`).get()
      const saldo = await callSaldoDisponivel(userId, tSnap.exists ? tSnap.data() : {}, ehAdm)
      if (saldo.totalSeg <= 0) return { ok: false, erroMsg: 'Sem minutos de Ligação IA' }
    }
    const voz = CALL_VOZES_PTBR.includes(nodeData.voz) ? nodeData.voz : CALL_VOZ_PADRAO
    await iniciarLigacaoTorpedo(cfg, norm.e164, {
      uid: userId, texto: nodeData.roteiro || '', voz, velocidade: Number(nodeData.velocidade) || 1, canal, contaPropria,
      audioUrl: nodeData.audioUrl || null, audioNome: nodeData.audioNome || '',
      leadId: contato.leadId || null, produto: contato.produto || '', nome: contato.nome || '', email: contato.email || '', agenteNome: 'Funil',
    })
    return { ok: true }
  } catch (err) { console.error('enviarLigacaoFunil', err); return { ok: false, erroMsg: traduzErroVoz(err.message) } }
}

/** Cria o funnelRun no primeiro passo após o Início. canal: 'email' | 'whatsapp' | 'sms' | 'call'. */
async function inscreverNoFunil(userId, funnelId, funnel, contato, canal = 'email') {
  const inicio = nodeInicio(funnel)
  const primeiro = inicio ? proximoNode(funnel, inicio.id) : null
  const idKey = (canal === 'whatsapp' || canal === 'sms' || canal === 'call') ? (contato?.telefone || '') : (contato?.email || '')
  if (!primeiro || !idKey) return false
  await db.collection('users').doc(userId).collection('funnelRuns').add({
    funnelId,
    canal,
    contato: { email: contato.email || '', telefone: contato.telefone || '', nome: contato.nome || '', produto: contato.produto || '', leadId: contato.leadId || null },
    currentNodeId: primeiro,
    status: 'ativo',
    nextRunAt: admin.firestore.Timestamp.now(),
    enteredAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return true
}

/** Envia uma mensagem de WhatsApp de um nó de funil (via n8n/Evolution). */
async function enviarMensagemFunil(userId, mensagem, contato, imagemUrl, audioUrl) {
  try {
    if (!contato?.telefone || (!mensagem && !imagemUrl && !audioUrl)) return { ok: false, erroMsg: 'Contato sem telefone ou mensagem vazia' }
    const evolution = await getEvolutionConfigForUser(userId)
    if (!evolution?.nomeInstancia) return { ok: false, erroMsg: 'Nenhuma instância de WhatsApp conectada' }
    const customer = { nome: contato.nome || '', telefone: contato.telefone, email: contato.email || '' }
    const product = { nome: contato.produto || '' }
    const msg = replaceVariables(mensagem || '', customer, product)
    const res = await enviarWAHA({
      sessao: evolution.nomeInstancia || '',
      contatos: [{ telefone: customer.telefone, nome: customer.nome || '' }],
      blocos: blocosComMidia(msg, imagemUrl, audioUrl),
      campanhaId: 'funil',
    })
    if (!res.ok) return { ok: false, erroMsg: `Falha ao enviar pelo WhatsApp (instância/n8n respondeu ${res.status})` }
    return { ok: true }
  } catch (err) { console.error('enviarMensagemFunil', err); return { ok: false, erroMsg: err.message || 'Falha no envio do WhatsApp' } }
}

/**
 * Envia um SMS de um nó de funil. canal: 'eua'/'api' (Telnyx) | 'brl' (SMSDev, +55, crédito-only).
 * Retorna { ok, erroMsg, smsdevId, to } pra o relatório do funil mostrar o motivo do erro (hover) + rastrear DLR.
 */
async function enviarMensagemFunilSMS(userId, mensagem, contato, canal) {
  try {
    if (!contato?.telefone || !mensagem) return { ok: false, erroMsg: 'Sem telefone ou mensagem' }
    if (canal === 'brl') {
      const rSms = await resolverSmsBrEnvio(userId) // BYO (conta do cliente) tem prioridade
      if (rSms.erro) return { ok: false, erroMsg: rSms.erro }
      const normBr = normalizarE164(contato.telefone, { permitirBR: true })
      if (!normBr.ok || !String(normBr.e164).replace(/\D/g, '').startsWith('55')) return { ok: false, erroMsg: 'Número não é do Brasil (+55) — canal BR só envia para +55.' }
      const ehAdm = await ehUidAdmin(userId)
      if (!ehAdm && !rSms.propria) { const tSnap = await db.doc(`tenants/${userId}`).get(); if ((Number(tSnap.data()?.smsBrCreditos) || 0) < 1) return { ok: false, erroMsg: 'Sem créditos de SMS Brasil' } }
      const textoBr = replaceVariables(mensagem, { nome: contato.nome || '', telefone: normBr.e164, email: contato.email || '' }, { nome: contato.produto || '' })
      let smsdevId = null
      try { const out = await enviarSMSDev(rSms.key, normBr.e164, textoBr); smsdevId = out.id } catch (err) { return { ok: false, erroMsg: err.message || 'Falha no envio do SMS' } }
      if (!ehAdm && !rSms.propria) await db.doc(`tenants/${userId}`).set({ smsBrCreditos: admin.firestore.FieldValue.increment(-1) }, { merge: true })
      return { ok: true, smsdevId, to: normBr.e164 }
    }
    const rEnvio = await resolverTelnyxEnvio(userId, await ehUidAdmin(userId), canal === 'api' ? 'api' : 'eua')
    if (rEnvio.erro) return { ok: false, erroMsg: rEnvio.erro }
    const cfg = rEnvio.cfg
    const norm = normalizarE164(contato.telefone, { permitirBR: !!rEnvio.propria })
    if (!norm.ok) return { ok: false, erroMsg: motivoNumeroInvalido(norm.motivo) }
    const texto = replaceVariables(mensagem, { nome: contato.nome || '', telefone: norm.e164, email: contato.email || '' }, { nome: contato.produto || '' })
    try { await enviarSMSTelnyx(cfg, norm.e164, texto) } catch (err) { return { ok: false, erroMsg: err.message || 'Falha no envio do SMS' } }
    return { ok: true, to: norm.e164 }
  } catch (err) { console.error('enviarMensagemFunilSMS', err); return { ok: false, erroMsg: err.message || 'Erro interno' } }
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
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 8 },
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
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 8 },
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
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, nome: customer.nome, produto: product.nome, leadId: leadRef.id }, 'email')
        }
      }
      if (customer.telefone) {
        const funisWaSnap = await db.collection('users').doc(userId).collection('whatsappFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        for (const fdoc of funisWaSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true || !grupoOk(funnel)) continue
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, telefone: customer.telefone, nome: customer.nome, produto: product.nome, leadId: leadRef.id }, 'whatsapp')
        }
        // Funis de SMS por canal (funnel.smsCanal): BRL (SMSDev) só pega +55; EUA/API (Telnyx) só internacional.
        const funisSmsSnap = await db.collection('users').doc(userId).collection('smsFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        const normLeadSms = normalizarE164(customer.telefone, { permitirBR: true })
        const leadEhBr = normLeadSms.ok && String(normLeadSms.e164).replace(/\D/g, '').startsWith('55')
        for (const fdoc of funisSmsSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true || !grupoOk(funnel)) continue
          if ((funnel.smsCanal === 'brl') !== leadEhBr) continue // casa o país: funil BR ↔ lead +55
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, telefone: customer.telefone, nome: customer.nome, produto: product.nome, leadId: leadRef.id }, 'sms')
        }
        // Funis de Ligação IA (funnel.callCanal): eua = internacional (ignora +55) · api = conta própria (aceita +55).
        const funisCallSnap = await db.collection('users').doc(userId).collection('callFunnels')
          .where('gatilhoEvento', '==', evento).limit(20).get()
        for (const fdoc of funisCallSnap.docs) {
          const funnel = fdoc.data()
          if (funnel.ativo !== true || !grupoOk(funnel)) continue
          const callCanal = funnel.callCanal === 'api' ? 'api' : 'eua'
          if (callCanal === 'eua' && leadEhBr) continue // canal EUA não liga p/ +55
          await inscreverNoFunil(userId, fdoc.id, funnel, { email: customer.email, telefone: customer.telefone, nome: customer.nome, produto: product.nome, leadId: leadRef.id }, 'call')
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
  const col = canal === 'whatsapp' ? 'whatsappFunnels' : canal === 'sms' ? 'smsFunnels' : canal === 'call' ? 'callFunnels' : 'emailFunnels'
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
  } else if (canal === 'call') {
    // Ligação IA: canal eua = só internacional (ignora +55); api = conta própria (aceita +55).
    const permitirBR = funnel.callCanal === 'api'
    const validos = []
    for (const r of lista.slice(0, 2000)) {
      const norm = normalizarE164(r?.telefone || r?.numero || '', { permitirBR })
      if (norm.ok) validos.push({ telefone: norm.e164, nome: r.nome || '' })
    }
    for (const r of validos) {
      await inscreverNoFunil(uid, funnelId, funnel, r, 'call')
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
  const funnelCol = run.canal === 'whatsapp' ? 'whatsappFunnels' : run.canal === 'sms' ? 'smsFunnels' : run.canal === 'call' ? 'callFunnels' : 'emailFunnels'
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
        if (node.data?.mensagem || node.data?.imagemUrl || node.data?.audioUrl) {
          const res = await enviarMensagemFunil(userId, node.data.mensagem, run.contato, node.data.imagemUrl, node.data.audioUrl)
          try {
            await db.collection('users').doc(userId).collection('funnelSends').add({
              funnelId: run.funnelId, funnelNome: funnel.nome || '', nodeId: node.id, canal: 'whatsapp',
              contato: run.contato || {}, status: res.ok ? 'enviado' : 'erro', erroMsg: res.erroMsg || null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          } catch (_) {}
        }
      } else if (run.canal === 'sms') {
        if (node.data?.mensagem) {
          const smsCanal = ['api', 'brl'].includes(funnel.smsCanal) ? funnel.smsCanal : 'eua' // EUA (nossa Telnyx) · API (Telnyx do cliente) · BRL (SMSDev +55)
          const res = await enviarMensagemFunilSMS(userId, node.data.mensagem, run.contato, smsCanal)
          try {
            const sendRef = await db.collection('users').doc(userId).collection('funnelSends').add({
              funnelId: run.funnelId, funnelNome: funnel.nome || '', nodeId: node.id, canal: 'sms', smsCanal,
              contato: run.contato || {}, status: res.ok ? 'enviado' : 'erro', erroMsg: res.erroMsg || null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
            // DLR BR: liga a msg SMSDev ao funnelSend pra o status de entrega (não entregue) atualizar o relatório depois.
            if (res.ok && res.smsdevId && smsCanal === 'brl') {
              await db.doc(`users/${userId}/smsMensagens/${res.smsdevId}`).set({ funnelSendId: sendRef.id, canal: 'brl', to: res.to, status: 'enviado', createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
              await db.doc(`smsdevIndex/${res.smsdevId}`).set({ uid: userId }, { merge: true })
            }
          } catch (_) {}
        }
      } else if (run.canal === 'call') {
        if (node.data?.roteiro) {
          const callCanal = funnel.callCanal === 'api' ? 'api' : 'eua'
          const res = await enviarLigacaoFunil(userId, run.contato, callCanal, node.data)
          try {
            await db.collection('users').doc(userId).collection('funnelSends').add({
              funnelId: run.funnelId, funnelNome: funnel.nome || '', nodeId: node.id, canal: 'call', callCanal,
              contato: run.contato || {}, status: res.ok ? 'enviado' : 'erro', erroMsg: res.erroMsg || null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          } catch (_) {}
        }
      } else if (node.data?.templateId) {
        const res = await enviarTemplateFunil(userId, node.data.templateId, run.contato, [
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
            status: res.ok ? 'enviado' : 'erro',
            erroMsg: res.erroMsg || null,
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
      if (run.canal === 'whatsapp' || run.canal === 'sms' || run.canal === 'call') {
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
// Modelo usado SÓ no construtor de e-mail (IA): grok-code-fast-1 (feito pra código, barato).
// Configurável via .env (GROK_MODEL_IA) sem mexer no grok-4 dos outros usos.
const GROK_MODEL_IA = process.env.GROK_MODEL_IA || 'grok-code-fast-1'
// Modelo do VENDEDOR/atendente IA (conversa de venda no WhatsApp + simulador "Testar IA").
// grok-4.1-fast: geração nova, barato e conversacional. Trocável via .env sem mexer no resto.
const GROK_MODEL_ATENDENTE = process.env.GROK_MODEL_ATENDENTE || 'grok-4.20-0309-reasoning'

async function callGrok(messages, { json = false, model, uso } = {}) {
  if (!GROK_API_KEY) throw new HttpsError('failed-precondition', 'Chave do Grok não configurada (functions/.env → GROK_API).')
  const body = { model: model || GROK_MODEL, messages, temperature: 0.5 }
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
  // Rastreia tokens por vendedor (pro Relatório). uso = { uid, atendenteId }.
  const totalTokens = data?.usage?.total_tokens || 0
  if (uso?.uid && uso?.atendenteId && totalTokens) {
    const mesId = new Date().toISOString().slice(0, 7)
    db.doc(`users/${uso.uid}/atendentes/${uso.atendenteId}`).set({ tokensMes: { [mesId]: admin.firestore.FieldValue.increment(totalTokens) }, tokensTotal: admin.firestore.FieldValue.increment(totalTokens) }, { merge: true }).catch(() => {})
  }
  const content = data?.choices?.[0]?.message?.content || ''
  // Remove tokens especiais do modelo que às vezes vazam no texto (ex.: <|eos|>, <|endoftext|>, <|im_end|>).
  return content.replace(/<[|｜][^>]*?[|｜]>/g, '').trim()
}

/** IA (Grok): gera/edita um e-mail em HTML+CSS EMAIL-SAFE a partir do chat do construtor. */
exports.iaGerarEmailHtml = onCall({ region: 'us-central1', timeoutSeconds: 180 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  const mensagens = request.data?.mensagens
  if (!Array.isArray(mensagens) || !mensagens.length) throw new HttpsError('invalid-argument', 'Sem mensagem pra IA.')

  // ── TRAVA DE SEGURANÇA: limite de criações com IA por mês (por plano) ──
  const tRef = db.doc(`tenants/${uid}`)
  const tSnap = await tRef.get()
  const t = tSnap.exists ? tSnap.data() : {}
  const lim = limitesDoTenant(t)
  const isAdm = (request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL
  const mes = mesAtualStr()
  const limite = Number(lim.iaMes) || 0
  const usada = Number(t?.iaUso?.[mes] || 0)
  if (!isAdm) {
    if (limite <= 0) throw new HttpsError('permission-denied', 'Seu plano não inclui criar e-mails com IA. Faça upgrade do plano pra liberar.')
    if (usada >= limite) throw new HttpsError('resource-exhausted', `Você já usou suas ${limite} criações com IA deste mês. Faça upgrade do plano pra ter mais.`)
  }

  const sys = [
    'Você é um assistente que cria e-mails de marketing em HTML e conversa com o usuário em português.',
    'FORMATO OBRIGATÓRIO DA RESPOSTA (exatamente assim, sem markdown, sem crases):',
    '[uma frase CURTA e animada em português, no máximo 12 palavras — ex.: "Prontinho! Olha aqui do lado 🚀" ou "Boaaa, deixei os botões laranja 🔥"]',
    '@@@HTML@@@',
    '[o HTML completo do e-mail]',
    '',
    'REGRAS DO HTML (siga TODAS):',
    '1) HTML + CSS 100% EMAIL-SAFE: layout em TABELAS (<table>), estilos INLINE em cada elemento (style="..."), cores em HEX fixo.',
    '2) PROIBIDO: CSS grid, flexbox, variáveis CSS (var()), @import, ::before/::after, position absolute/fixed, JavaScript.',
    '3) Largura do e-mail no máximo 640px, centralizado (margin:0 auto). Fonte: Arial, Helvetica, sans-serif.',
    '4) Responsividade (empilhar colunas no mobile) SÓ via um único <style> com @media (max-width:620px){...} usando classes simples.',
    '5) Quando o usuário mandar uma URL de imagem, use EXATAMENTE essa URL no src da <img> (com width e style inline).',
    '6) Se o usuário pedir uma alteração, devolva o HTML COMPLETO já modificado (não só o trecho) e a frase curta comentando a mudança.',
    '7) Botões devem ser links <a> estilizados dentro de <td> (email-safe), nunca <button>.',
  ].join('\n')

  const messages = [
    { role: 'system', content: sys },
    ...mensagens.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) })),
  ]
  // Usa o modelo MAIS BARATO só aqui no construtor (os outros usos do Grok seguem no grok-4).
  const raw = String(await callGrok(messages, { model: GROK_MODEL_IA }) || '').trim()

  // Separa a frase curta do HTML
  let mensagem = ''
  let html = raw
  const sep = raw.indexOf('@@@HTML@@@')
  if (sep >= 0) {
    mensagem = raw.slice(0, sep).trim()
    html = raw.slice(sep + '@@@HTML@@@'.length).trim()
  }
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim()
  mensagem = mensagem.replace(/```/g, '').trim() || 'Prontinho! Olha aqui do lado 🚀'

  // Conta o uso SÓ depois de gerar com sucesso (contador mensal no tenant).
  // Sempre incrementa (pro contador refletir o real) — o admin só não é BLOQUEADO.
  let usados = usada + 1
  try { await tRef.set({ iaUso: { [mes]: admin.firestore.FieldValue.increment(1) } }, { merge: true }) } catch (_) { usados = usada }
  return { mensagem, html, usados, limite: isAdm ? -1 : limite }
})

/** IA: analisa uma amostra de webhook e sugere fieldMap + eventRules. */
exports.aiMapFields = onCall({ region: 'us-central1', timeoutSeconds: 120, enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertRateLimit(request, 'ai_map', 30)
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
exports.aiGenerateMessage = onCall({ region: 'us-central1', timeoutSeconds: 120, enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  await assertRateLimit(request, 'ai_generate', 30)
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
exports.linkPreview = onCall({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB', enforceAppCheck: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login.')
  let url = String(request.data?.url || '').trim()
  if (!url) throw new HttpsError('invalid-argument', 'URL vazia.')
  await assertRateLimit(request, 'link_preview', 30)
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!urlPublicaSegura(url)) throw new HttpsError('invalid-argument', 'URL não permitida.')
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
  let ovLimites = null, ovFeatures = null
  if (p.overrides && typeof p.overrides === 'object') {
    if (p.overrides.limites && typeof p.overrides.limites === 'object') {
      ovLimites = {}
      for (const k of ['trackers', 'instancias', 'emailsMes', 'smsMes', 'dominios', 'callMin', 'iaMes', 'atendentes', 'conversasMes']) {
        if (p.overrides.limites[k] != null) ovLimites[k] = Math.max(0, Number(p.overrides.limites[k]) || 0)
      }
    }
    if (p.overrides.features && typeof p.overrides.features === 'object') {
      ovFeatures = {}
      for (const k of Object.keys(p.overrides.features)) ovFeatures[k] = !!p.overrides.features[k]
    }
  }
  if (patch.status === 'approved') patch.aprovadoEm = admin.firestore.FieldValue.serverTimestamp()
  await db.doc(`tenants/${uid}`).set(patch, { merge: true })
  // SUBSTITUI (não deep-merge) os mapas de override enviados — assim limites que voltaram ao padrão
  // do plano deixam de ser override e o cliente volta a HERDAR o plano (e acompanha mudanças futuras).
  const ovUpdate = {}
  if (ovLimites) ovUpdate['overrides.limites'] = ovLimites
  if (ovFeatures) ovUpdate['overrides.features'] = ovFeatures
  if (Object.keys(ovUpdate).length) await db.doc(`tenants/${uid}`).update(ovUpdate)
  // Auditoria: registra no faturamento quando plano/limites são alterados no admin (pra ninguém mexer sem rastro).
  if (p.plano != null || ovLimites) {
    await registrarFaturamento(uid, { tipo: 'ajuste', descricao: `Ajuste no admin${p.plano ? ` · plano ${p.plano}` : ''}${ovLimites && Object.keys(ovLimites).length ? ` · limites custom: ${Object.entries(ovLimites).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}` })
  }
  return { ok: true }
})

/**
 * Histórico financeiro/custos COMPLETO de um cliente (aba Crédito no admin).
 * Une o log de faturamento (canônico) + coleções legadas de recarga (dedup por stripeId),
 * saldos atuais, uso que gera custo (e-mails, SMS, ligação, IA) e limites/overrides.
 */
exports.adminGetClienteCredito = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  const tSnap = await db.doc(`tenants/${uid}`).get()
  const t = tSnap.exists ? tSnap.data() : {}
  const lim = limitesDoTenant(t)
  const toMs = (x) => (x && x.toMillis) ? x.toMillis() : (typeof x === 'number' ? x : (x && x._seconds ? x._seconds * 1000 : 0))

  const movimentos = []
  const vistos = new Set()
  const pushMov = (m) => {
    const key = m.stripeId || `${m.tipo}_${m.emMs}_${m.valor}`
    if (vistos.has(key)) return
    vistos.add(key); movimentos.push(m)
  }

  // 1) Log canônico de faturamento (compras novas, planos, reembolsos, chargebacks, ajustes).
  try {
    const fs = await db.collection(`tenants/${uid}/faturamento`).get()
    fs.forEach((d) => { const x = d.data(); pushMov({ tipo: x.tipo, descricao: x.descricao, quantidade: x.quantidade ?? null, valor: x.valor ?? null, stripeId: x.stripeId || d.id, emMs: toMs(x.em) }) })
  } catch (_) {}

  // 2) Legado: recargas antigas (antes do log). Dedup por stripeId = id da sessão.
  const legado = [
    { col: 'recargasSMS', tipo: 'credito_sms', desc: (x) => `${x.quantidade} créditos de SMS`, qtd: (x) => x.quantidade },
    { col: 'recargasEmail', tipo: 'credito_email', desc: (x) => `${x.quantidade} créditos de e-mail`, qtd: (x) => x.quantidade },
    { col: 'recargasCall', tipo: 'credito_call', desc: (x) => `${Math.round((x.segundos || 0) / 60)} min de ligação`, qtd: (x) => Math.round((x.segundos || 0) / 60) },
    { col: 'instanciaSubs', tipo: 'instancia', desc: (x) => `${x.quantidade} instância(s) de WhatsApp`, qtd: (x) => x.quantidade },
  ]
  for (const l of legado) {
    try {
      const s = await db.collection(`tenants/${uid}/${l.col}`).get()
      s.forEach((d) => { const x = d.data(); pushMov({ tipo: l.tipo, descricao: l.desc(x), quantidade: l.qtd(x), valor: x.valor ?? null, stripeId: d.id, emMs: toMs(x.em) }) })
    } catch (_) {}
  }
  // Números SMS (legado): users/{uid}/smsNumeros
  try {
    const s = await db.collection(`users/${uid}/smsNumeros`).get()
    s.forEach((d) => { const x = d.data(); pushMov({ tipo: 'numero', descricao: `Número ${x.number || ''}`.trim(), quantidade: 1, valor: x.valorMensal ?? 29.9, stripeId: `num_${d.id}`, emMs: toMs(x.createdAt) }) })
  } catch (_) {}

  movimentos.sort((a, b) => (b.emMs || 0) - (a.emMs || 0))

  // 3) Uso que gera custo (totais).
  const somaCampo = async (col, campo) => {
    let total = 0
    try { const s = await db.collection(`users/${uid}/${col}`).get(); s.forEach((d) => { total += Number(d.data()?.[campo]) || 0 }) } catch (_) {}
    return total
  }
  const emailsEnviados = await somaCampo('emailDisparos', 'enviados')
  const smsEnviados = await somaCampo('smsDisparos', 'enviados')
  let ligacaoSeg = 0
  try { const s = await db.collection(`users/${uid}/callLogs`).get(); s.forEach((d) => { ligacaoSeg += Number(d.data()?.segundos) || 0 }) } catch (_) {}
  const iaUso = t.iaUso || {}
  const iaUsadosTotal = Object.values(iaUso).reduce((a, b) => a + (Number(b) || 0), 0)

  const totalGasto = movimentos.filter((m) => (m.valor || 0) > 0).reduce((a, m) => a + m.valor, 0)
  const totalReembolsado = movimentos.filter((m) => (m.valor || 0) < 0).reduce((a, m) => a + m.valor, 0)

  return {
    movimentos,
    saldos: {
      emailCreditos: Number(t.emailCreditos) || 0,
      smsCreditos: Number(t.smsCreditos) || 0,
      callMin: Math.floor((Number(t.callCreditos) || 0) / 60),
      instanciasExtras: Number(t.instanciasExtras) || 0,
    },
    uso: { emailsEnviados, smsEnviados, ligacaoMin: Math.round(ligacaoSeg / 60), iaUsadosTotal },
    plano: t.plano || 'free',
    limites: lim,
    overrides: (t.overrides && t.overrides.limites) || null,
    totalGasto, totalReembolsado,
  }
})

/**
 * CRM de MARGEM por cliente (aba Gastos): quanto o cliente NOS custa (Grok/Telnyx/Resend/instâncias)
 * vs quanto pagou (mensalidade + produtos). Retorna breakdown do mês atual + histórico mensal p/ gráfico.
 */
exports.adminGetClienteGastos = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  const tSnap = await db.doc(`tenants/${uid}`).get()
  const t = tSnap.exists ? tSnap.data() : {}
  const toMs = (x) => (x && x.toMillis) ? x.toMillis() : (typeof x === 'number' ? x : (x && x._seconds ? x._seconds * 1000 : 0))
  const mesDeMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

  const meses = {} // 'YYYY-MM' -> agregados
  const bump = (mes, campo, v) => { if (!mes) return; (meses[mes] = meses[mes] || { emails: 0, sms: 0, smsBr: 0, callMin: 0, ia: 0, receita: 0, mensalidade: 0, produtos: 0 })[campo] += v }

  try { const s = await db.collection(`users/${uid}/emailDisparos`).get(); s.forEach((d) => { const x = d.data(); const ms = toMs(x.createdAt); if (ms) bump(mesDeMs(ms), 'emails', Number(x.enviados) || 0) }) } catch (_) {}
  try { const s = await db.collection(`users/${uid}/smsDisparos`).get(); s.forEach((d) => { const x = d.data(); const ms = toMs(x.createdAt); if (ms) bump(mesDeMs(ms), x.canal === 'brl' ? 'smsBr' : 'sms', Number(x.enviados) || 0) }) } catch (_) {}
  try { const s = await db.collection(`users/${uid}/callLogs`).get(); s.forEach((d) => { const x = d.data(); const ms = toMs(x.createdAt); if (ms) bump(mesDeMs(ms), 'callMin', (Number(x.segundos) || 0) / 60) }) } catch (_) {}
  const iaUso = t.iaUso || {}
  for (const [mes, n] of Object.entries(iaUso)) bump(mes, 'ia', Number(n) || 0)
  try {
    const s = await db.collection(`tenants/${uid}/faturamento`).get()
    s.forEach((d) => { const x = d.data(); const v = Number(x.valor) || 0; if (v <= 0) return; const ms = toMs(x.em); if (!ms) return; const mes = mesDeMs(ms); bump(mes, 'receita', v); bump(mes, x.tipo === 'plano' ? 'mensalidade' : 'produtos', v) })
  } catch (_) {}

  let instanciasQtd = 0
  try { const s = await db.collection(`users/${uid}/instances`).get(); instanciasQtd = s.size } catch (_) {}
  const custoInstanciaMes = instanciasQtd * CUSTOS_UNIT.instanciaMes
  const mesAtual = mesDeMs(Date.now())

  const lista = Object.entries(meses).map(([mes, m]) => {
    const custoResend = m.emails * CUSTOS_UNIT.email
    const custoSms = m.sms * CUSTOS_UNIT.sms // Telnyx (EUA)
    const custoSmsBr = m.smsBr * CUSTOS_UNIT.smsBr // SMSDev (Brasil)
    const custoCall = m.callMin * CUSTOS_UNIT.callMin
    const custoGrok = m.ia * CUSTOS_UNIT.ia
    const custoInst = (mes === mesAtual) ? custoInstanciaMes : 0 // instância só no mês atual (sem histórico de contagem)
    const custoTotal = custoResend + custoSms + custoSmsBr + custoCall + custoGrok + custoInst
    return {
      mes, emails: m.emails, sms: m.sms, smsBr: m.smsBr, callMin: Math.round(m.callMin), ia: m.ia,
      custoResend, custoSms, custoSmsBr, custoCall, custoGrok, custoInst, custoTotal,
      receita: m.receita, mensalidade: m.mensalidade, produtos: m.produtos, lucro: m.receita - custoTotal,
    }
  }).sort((a, b) => (a.mes < b.mes ? 1 : -1))

  const atual = lista.find((x) => x.mes === mesAtual) || { mes: mesAtual, emails: 0, sms: 0, smsBr: 0, callMin: 0, ia: 0, custoResend: 0, custoSms: 0, custoSmsBr: 0, custoCall: 0, custoGrok: 0, custoInst: custoInstanciaMes, custoTotal: custoInstanciaMes, receita: 0, mensalidade: 0, produtos: 0, lucro: -custoInstanciaMes }

  return { custos: CUSTOS_UNIT, instanciasQtd, custoInstanciaMes, mesAtual: atual, meses: lista }
})

/** Inventário de tudo que o cliente tem CONECTADO no app (monitoramento de risco/custo). */
exports.adminGetClienteConectados = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  const listar = async (path) => { try { return (await db.collection(path).get()).docs.map((d) => ({ id: d.id, ...d.data() })) } catch (_) { return [] } }
  const [dom, inst, chips, telnyx, resend, wh] = await Promise.all([
    listar(`users/${uid}/emailDomains`), listar(`users/${uid}/instances`), listar(`users/${uid}/smsNumeros`),
    listar(`users/${uid}/smsProviders`), listar(`users/${uid}/emailProviders`), listar(`users/${uid}/webhooks`),
  ])
  return {
    dominios: dom.map((d) => ({ nome: d.name || d.dominio || '—', status: d.status || d.dnsStatus || (d.verified ? 'verificado' : 'pendente') })),
    instancias: inst.map((d) => ({ nome: d.nomeInstancia || d.nome || '—', numero: d.numeroWhatsapp || d.numeroWhatsApp || '', conectado: !!d.conectado })),
    chips: chips.map((d) => ({ numero: d.number || '—', status: d.status || 'active', principal: !!d.principal, voz: !!d.vozAtiva })),
    telnyxApi: telnyx.map((d) => ({ nome: d.nome || '—', from: d.from || d.numeroPrincipal || '', principal: !!d.principal })),
    resendApi: resend.map((d) => ({ nome: d.nome || d.fromName || '—', from: d.fromEmail || d.from || '', principal: !!d.principal })),
    trackers: wh.filter((d) => d.tipo === 'custom').map((d) => ({ nome: d.nome || '—', loja: d.loja || '', status: d.status || '' })),
  }
})

/** Reenvia o Termo de Uso: zera a aceitação, obrigando o cliente a aceitar de novo no próximo acesso. */
exports.adminResetTermos = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const uid = request.data?.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid obrigatório.')
  if (uid === request.auth?.uid) throw new HttpsError('permission-denied', 'A conta admin não usa termo.')
  await db.doc(`tenants/${uid}`).set({ termos: { aceito: false, resetEm: admin.firestore.FieldValue.serverTimestamp(), resetPor: (request.auth?.token?.email || 'admin') } }, { merge: true })
  return { ok: true }
})

// ───────────────────────── Fiscalização de segurança (LOGS SECURITY) ─────────────────────────

/** Calcula o risco (score + motivos) de UM cliente: financeiro, jurídico e abuso. */
async function scanRiscoTenant(uid, t) {
  const motivos = []
  let score = 0
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
  const inicioMesMs = inicioMes.getTime()
  const agora = Date.now()
  const mesStr = `${inicioMes.getFullYear()}-${String(inicioMes.getMonth() + 1).padStart(2, '0')}`
  const somaMes = async (col, campo) => {
    let total = 0
    try { const s = await db.collection(`users/${uid}/${col}`).get(); s.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicioMesMs) total += Number(x[campo]) || 0 }) } catch (_) {}
    return total
  }

  // 1) Overrides que ELEVAM limite acima do plano (alguém bumpou os limites do cliente).
  const ov = (t.overrides && t.overrides.limites) || {}
  const base = PLAN_LIMITS[t.plano] || PLAN_LIMITS.free
  for (const k of Object.keys(ov)) {
    if (Number(ov[k]) > Number(base[k] || 0)) { motivos.push(`Limite '${k}' custom ACIMA do plano (${ov[k]} vs ${base[k] || 0})`); score += 20 }
  }

  // 2) Custo (nós) x Receita do mês → margem negativa = prejuízo.
  const emailsMes = await somaMes('emailDisparos', 'enviados')
  let smsMes = 0, smsBrMes = 0
  try { const s = await db.collection(`users/${uid}/smsDisparos`).get(); s.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicioMesMs) { if (x.canal === 'brl') smsBrMes += Number(x.enviados) || 0; else smsMes += Number(x.enviados) || 0 } }) } catch (_) {}
  let callMinMes = 0
  try { const s = await db.collection(`users/${uid}/callLogs`).get(); s.forEach((d) => { const x = d.data(); const cm = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt || 0); if (cm >= inicioMesMs) callMinMes += (Number(x.segundos) || 0) / 60 }) } catch (_) {}
  const iaMes = Number((t.iaUso || {})[mesStr] || 0)
  let instQtd = 0
  try { instQtd = (await db.collection(`users/${uid}/instances`).count().get()).data().count } catch (_) {}
  const custoMes = emailsMes * CUSTOS_UNIT.email + smsMes * CUSTOS_UNIT.sms + smsBrMes * CUSTOS_UNIT.smsBr + callMinMes * CUSTOS_UNIT.callMin + iaMes * CUSTOS_UNIT.ia + instQtd * CUSTOS_UNIT.instanciaMes

  // 3) Reclamação/bounce (spam) → risco de BAN da conta Resend compartilhada (financeiro + reputação).
  let complained = 0, bounced = 0, enviadosTotal = 0
  try { const s = await db.collection(`users/${uid}/emailDisparos`).get(); s.forEach((d) => { enviadosTotal += Number(d.data()?.enviados) || 0 }) } catch (_) {}
  try { complained = (await db.collection(`users/${uid}/emailEvents`).where('tipo', '==', 'complained').count().get()).data().count } catch (_) {}
  try { bounced = (await db.collection(`users/${uid}/emailEvents`).where('tipo', '==', 'bounced').count().get()).data().count } catch (_) {}
  const compRate = enviadosTotal > 0 ? (complained / enviadosTotal) * 100 : 0
  const bounceRate = enviadosTotal > 0 ? (bounced / enviadosTotal) * 100 : 0
  if (compRate >= 0.1) { motivos.push(`Reclamação de spam ALTA (${compRate.toFixed(2)}%) — pode derrubar nossa conta Resend`); score += 30 }
  else if (compRate >= 0.05) { motivos.push(`Reclamação de spam subindo (${compRate.toFixed(2)}%)`); score += 15 }
  if (bounceRate >= 5) { motivos.push(`Bounce alto (${bounceRate.toFixed(1)}%) — lista suja`); score += 20 }

  // 4) Faturamento: chargebacks, reembolsos, rajada de compras (teste de cartão), receita do mês.
  let receitaMes = 0, chargebacks = 0, reembolsos = 0, compras24h = 0
  try {
    const s = await db.collection(`tenants/${uid}/faturamento`).get()
    s.forEach((d) => {
      const x = d.data(); const v = Number(x.valor) || 0; const em = x.em?.toMillis ? x.em.toMillis() : (x.em || 0)
      if (x.tipo === 'chargeback') chargebacks++
      if (x.tipo === 'reembolso') reembolsos++
      if (v > 0 && em >= inicioMesMs) receitaMes += v
      if (v > 0 && em >= agora - 86400000) compras24h++
    })
  } catch (_) {}
  if (chargebacks > 0) { motivos.push(`${chargebacks} CHARGEBACK(s) na Stripe — risco jurídico/financeiro`); score += 40 * chargebacks }
  if (reembolsos > 0) { motivos.push(`${reembolsos} reembolso(s)`); score += 10 * reembolsos }
  if (compras24h >= 4) { motivos.push(`${compras24h} compras em 24h — possível teste de cartão/fraude`); score += 25 }

  // 5) Margem negativa.
  if (custoMes > receitaMes && custoMes > 5) { motivos.push(`Custo do mês (R$${custoMes.toFixed(2)}) MAIOR que a receita (R$${receitaMes.toFixed(2)}) — prejuízo`); score += 20 }

  // 6) Marcado pelo setor de risco.
  if (t.risco && (t.risco.pausadoPorRisco || t.risco.override)) { motivos.push('Marcado pelo setor de risco'); score += 15 }

  const nivel = score >= 60 ? 'critico' : score >= 30 ? 'alto' : score >= 15 ? 'medio' : 'ok'
  return { score, nivel, motivos, custoMes: Number(custoMes.toFixed(2)), receitaMes: Number(receitaMes.toFixed(2)) }
}

/** Roda a varredura em TODOS os clientes e grava o relatório em config/securityReport. */
async function rodarSecurityScan() {
  const snap = await db.collection('tenants').get()
  const alertas = []
  for (const doc of snap.docs) {
    const t = doc.data()
    if ((t.email || '').toLowerCase() === ADMIN_EMAIL) continue
    try {
      const r = await scanRiscoTenant(doc.id, t)
      if (r.nivel !== 'ok') alertas.push({ uid: doc.id, nome: t.nome || '', email: t.email || '', plano: t.plano || 'free', ...r })
    } catch (e) { console.error('scanRiscoTenant', doc.id, e) }
  }
  alertas.sort((a, b) => b.score - a.score)
  await db.doc('config/securityReport').set({
    geradoEm: admin.firestore.FieldValue.serverTimestamp(),
    total: alertas.length,
    criticos: alertas.filter((a) => a.nivel === 'critico').length,
    altos: alertas.filter((a) => a.nivel === 'alto').length,
    medios: alertas.filter((a) => a.nivel === 'medio').length,
    alertas: alertas.slice(0, 100),
  })
  // Grava LOG PERSISTENTE (nunca apagado) dos críticos/altos ainda não logados nas últimas 20h (evita repetir toda hora).
  try {
    const desde = admin.firestore.Timestamp.fromMillis(Date.now() - 20 * 3600 * 1000)
    const recentes = await db.collection('securityLogs').where('em', '>=', desde).get()
    const jaLogado = new Set(recentes.docs.filter((d) => d.data().tipo === 'risco').map((d) => d.data().uid))
    for (const a of alertas) {
      if ((a.nivel === 'critico' || a.nivel === 'alto') && !jaLogado.has(a.uid)) {
        await db.collection('securityLogs').add({ tipo: 'risco', uid: a.uid, nome: a.nome, email: a.email, nivel: a.nivel, score: a.score, motivos: a.motivos, em: admin.firestore.FieldValue.serverTimestamp() })
        jaLogado.add(a.uid)
      }
    }
  } catch (e) { console.error('securityLogs risco', e) }
  return alertas.length
}

/** Cron: a cada 1h fiscaliza todos os clientes (risco financeiro/jurídico/abuso). */
exports.securityScan = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'America/Sao_Paulo', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => { const n = await rodarSecurityScan(); console.log('securityScan: alertas =', n) },
)

/** Admin: lê o último relatório de segurança + se há alertas não vistos (pra bolinha vermelha). */
exports.adminGetSecurityReport = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  const [rep, meta] = await Promise.all([db.doc('config/securityReport').get(), db.doc('config/securityMeta').get()])
  const data = rep.exists ? rep.data() : { alertas: [], total: 0, criticos: 0, altos: 0, medios: 0 }
  const geradoEmMs = data.geradoEm?.toMillis ? data.geradoEm.toMillis() : 0
  const lastSeen = meta.exists && meta.data().lastSeenAt?.toMillis ? meta.data().lastSeenAt.toMillis() : 0
  const naoVisto = geradoEmMs > lastSeen && ((data.criticos || 0) + (data.altos || 0)) > 0
  return { alertas: data.alertas || [], total: data.total || 0, criticos: data.criticos || 0, altos: data.altos || 0, medios: data.medios || 0, geradoEmMs, naoVisto }
})

/** Admin: roda a varredura AGORA (botão Atualizar na página de Logs Security). */
exports.adminRunSecurityScan = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  assertAdmin(request)
  const n = await rodarSecurityScan()
  return { ok: true, alertas: n }
})

/** Admin: marca o relatório como visto (limpa a bolinha vermelha). */
exports.adminMarkSecuritySeen = onCall({ region: 'us-central1' }, async (request) => {
  assertAdmin(request)
  await db.doc('config/securityMeta').set({ lastSeenAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true }
})

/** Admin: log PERSISTENTE de segurança (conteúdo suspeito + risco), paginado. Nunca é apagado. */
exports.adminGetSecurityLogs = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  assertAdmin(request)
  const page = Math.max(1, Number(request.data?.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(request.data?.pageSize) || 20))
  let total = 0
  try { total = (await db.collection('securityLogs').count().get()).data().count } catch (_) {}
  let logs = []
  try {
    const s = await db.collection('securityLogs').orderBy('em', 'desc').offset((page - 1) * pageSize).limit(pageSize).get()
    logs = s.docs.map((d) => {
      const x = d.data()
      return { id: d.id, tipo: x.tipo, uid: x.uid, nome: x.nome || '', email: x.email || '', canal: x.canal || null, nivel: x.nivel || null, score: x.score ?? null, palavras: x.palavras || null, motivos: x.motivos || null, amostra: x.amostra || null, ref: x.ref || null, emMs: x.em?.toMillis ? x.em.toMillis() : 0 }
    })
  } catch (_) {}
  return { logs, total, page, pageSize }
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
  // Voz ativada em algum chip? (pro menu do Call mostrar o canal EUA pronto)
  let temCallVoz = false
  try { const v = await db.collection(`users/${uid}/smsNumeros`).where('vozAtiva', '==', true).limit(1).get(); temCallVoz = !v.empty } catch (_) {}
  const lim = limitesDoTenant(t)
  return {
    plano, status: t.status || 'approved', overrides: t.overrides || null,
    mustChangePassword: !!t.mustChangePassword, isAdmin: isAdm,
    termosAceito: !!(t.termos && t.termos.aceito),
    nome: t.nome || (request.auth?.token?.name || '') || '',
    documento: t.documento || '',
    email: t.email || (request.auth?.token?.email || '') || '',
    fotoURL: t.fotoURL || null,
    temSmsApi,
    temCallVoz, callMin: isAdm ? -1 : (Number(lim.callMin) || 0), temCallApi: temSmsApi,
    instanciasExtras: Number(t.instanciasExtras) || 0,
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

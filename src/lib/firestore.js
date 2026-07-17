import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'

export function userRef(uid) {
  return doc(db, 'users', uid)
}

export function userWebhooksRef(uid) {
  return collection(db, 'users', uid, 'webhooks')
}

export function userAbandonedCartsRef(uid) {
  return collection(db, 'users', uid, 'abandonedCarts')
}

export function userEvolutionRef(uid) {
  return doc(db, 'users', uid, 'config', 'evolution')
}

export function userInstancesRef(uid) {
  return collection(db, 'users', uid, 'instances')
}

export function userRemarketingLogRef(uid) {
  return collection(db, 'users', uid, 'remarketingLog')
}

/** Coleção de disparos (linha do tempo de envios) — usuário por usuário */
export function userDisparosRef(uid) {
  return collection(db, 'users', uid, 'disparos')
}

/** Lista disparos do usuário, mais recentes primeiro */
export async function getDisparos(uid) {
  if (!uid) return []
  const q = query(userDisparosRef(uid), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    const createdAt = data.createdAt?.toMillis?.() ?? data.createdAt ?? 0
    const endTime = data.endTime?.toMillis?.() ?? data.endTime ?? 0
    return { disparoId: d.id, ...data, createdAt, endTime }
  })
}

/** Cria ou substitui um disparo (id = disparoId) */
export async function setDisparo(uid, disparoId, data) {
  const ref = doc(db, 'users', uid, 'disparos', disparoId)
  await setDoc(ref, removeUndefined(data))
}

/** Atualiza campos de um disparo */
export async function updateDisparo(uid, disparoId, patch) {
  const ref = doc(db, 'users', uid, 'disparos', disparoId)
  await updateDoc(ref, removeUndefined(patch))
}

/** Remove um disparo da linha do tempo */
export async function deleteDisparo(uid, disparoId) {
  const ref = doc(db, 'users', uid, 'disparos', disparoId)
  await deleteDoc(ref)
}

/** Remove campos undefined do objeto (Firestore não aceita undefined) */
function removeUndefined(obj) {
  if (obj == null || typeof obj !== 'object') return obj
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export async function saveEvolutionConfig(uid, data) {
  const clean = removeUndefined({ ...data, updatedAt: serverTimestamp() })
  await setDoc(userEvolutionRef(uid), clean, { merge: true })
}

/** Retorna a instância selecionada para automações (Remarketing, etc.). Se houver várias, usa selectedInstanceId; senão a primeira ou o config antigo. */
export async function getEvolutionConfig(uid) {
  const configRef = userEvolutionRef(uid)
  const configSnap = await getDoc(configRef)
  const config = configSnap.exists() ? configSnap.data() : null
  const selectedId = config?.selectedInstanceId

  if (selectedId) {
    const instRef = doc(db, 'users', uid, 'instances', selectedId)
    const instSnap = await getDoc(instRef)
    if (instSnap.exists()) return { ...instSnap.data(), id: instSnap.id }
  }

  const instancesSnap = await getDocs(userInstancesRef(uid))
  const instances = instancesSnap.docs.map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
  if (instances.length > 0) return instances[0]

  if (config && (config.nomeInstancia || config.hash)) return config
  return null
}

export async function getInstances(uid) {
  let snap = await getDocs(userInstancesRef(uid))
  let list = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  if (list.length === 0) {
    const configSnap = await getDoc(userEvolutionRef(uid))
    const config = configSnap.exists ? configSnap.data() : null
    if (config && (config.nomeInstancia || config.hash)) {
      const newId = await addInstance(uid, {
        nomeInstancia: config.nomeInstancia,
        numeroWhatsapp: config.numeroWhatsapp,
        hash: config.hash,
        instanceId: config.instanceId,
        conectado: config.conectado ?? false,
        grupos: config.grupos ?? [],
      })
      await setDoc(userEvolutionRef(uid), { selectedInstanceId: newId }, { merge: true })
      snap = await getDocs(userInstancesRef(uid))
      list = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    }
  }
  return list.sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
    const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
    return tb - ta
  })
}

export async function addInstance(uid, data) {
  const ref = await addDoc(userInstancesRef(uid), {
    ...removeUndefined(data),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateInstance(uid, instanceId, data) {
  const ref = doc(db, 'users', uid, 'instances', instanceId)
  await updateDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }))
}

export async function setSelectedInstance(uid, instanceId) {
  await setDoc(userEvolutionRef(uid), { selectedInstanceId: instanceId }, { merge: true })
}

export async function deleteInstance(uid, instanceId) {
  const ref = doc(db, 'users', uid, 'instances', instanceId)
  await deleteDoc(ref)
}

const WEBHOOK_BASE_URL = 'https://us-central1-afiliadocdnx.cloudfunctions.net/kiwifyAbandonedCheckout'

export async function createWebhook(uid, payload) {
  const ref = await addDoc(userWebhooksRef(uid), {
    ...payload,
    createdAt: serverTimestamp(),
  })
  const url = `${WEBHOOK_BASE_URL}?webhookId=${ref.id}&userId=${uid}`
  await setDoc(ref, { webhookUrl: url }, { merge: true })
  return ref.id
}

export async function getWebhooks(uid) {
  const snap = await getDocs(userWebhooksRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

/** Só os webhooks Kiwify (exclui os 'custom' do Tracker — evita apagá-los por engano nas Integrações). */
export async function getKiwifyWebhooks(uid) {
  const todos = await getWebhooks(uid)
  return todos.filter((w) => w.tipo !== 'custom')
}

export async function updateWebhook(uid, webhookId, data) {
  const ref = doc(db, 'users', uid, 'webhooks', webhookId)
  await updateDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }))
}

// ── Webhooks custom (qualquer plataforma) + Tracker ──

// Criação passa pela Cloud Function `criarTrackerCustom` — a trava de plano (limite `trackers`)
// roda no servidor. O doc é gravado server-side; aqui só repassamos o payload.
export async function createCustomWebhook(uid, payload = {}) {
  const call = httpsCallable(functions, 'criarTrackerCustom')
  const r = await call({
    nome: payload.nome || 'Webhook custom',
    plataforma: payload.plataforma || '',
    loja: payload.loja || '',
    fieldMap: payload.fieldMap || {},
    eventRules: payload.eventRules || [],
  })
  return r.data?.id // id do webhook criado
}

/** Só os webhooks custom, mais recentes primeiro. */
export async function getCustomWebhooks(uid) {
  const snap = await getDocs(userWebhooksRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((w) => w.tipo === 'custom')
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export function userWebhookSamplesRef(uid, webhookId) {
  return collection(db, 'users', uid, 'webhooks', webhookId, 'samples')
}

/** Amostras de teste capturadas pela Cloud Function, mais recentes primeiro. */
export async function getWebhookSamples(uid, webhookId) {
  const q = query(userWebhookSamplesRef(uid, webhookId), orderBy('receivedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
}

/** Salva mapeamento de campos e/ou regras de evento e/ou status do webhook. */
export async function updateWebhookMapping(uid, webhookId, data) {
  const ref = doc(db, 'users', uid, 'webhooks', webhookId)
  await updateDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }))
}

export async function deleteWebhook(uid, webhookId) {
  const ref = doc(db, 'users', uid, 'webhooks', webhookId)
  await deleteDoc(ref)
}

export async function getAbandonedCarts(uid) {
  const snap = await getDocs(userAbandonedCartsRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function updateAbandonedCartRemarketingSent(uid, cartId, message) {
  const ref = doc(db, 'users', uid, 'abandonedCarts', cartId)
  await setDoc(ref, { remarketingEnviado: true, remarketingEm: serverTimestamp(), mensagemEnviada: message }, { merge: true })
}

export async function addRemarketingLog(uid, payload) {
  await addDoc(userRemarketingLogRef(uid), {
    ...payload,
    createdAt: serverTimestamp(),
  })
}

export async function getRemarketingLog(uid) {
  const snap = await getDocs(userRemarketingLogRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

// ── Leads (todos os eventos Kiwify) ──

export function userLeadsRef(uid) {
  return collection(db, 'users', uid, 'leads')
}

export async function getLeads(uid) {
  const snap = await getDocs(userLeadsRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function updateLeadStatus(uid, leadId, data) {
  const ref = doc(db, 'users', uid, 'leads', leadId)
  await updateDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }))
}

/** Apaga um documento de lead (um evento). Um contato pode ter vários. */
export async function deleteLead(uid, leadId) {
  await deleteDoc(doc(db, 'users', uid, 'leads', leadId))
}

// ── Config de E-mail (Resend) ──

export function userEmailConfigRef(uid) {
  return doc(db, 'users', uid, 'config', 'email')
}

export async function getEmailConfig(uid) {
  const snap = await getDoc(userEmailConfigRef(uid))
  return snap.exists() ? snap.data() : null
}

export async function saveEmailConfig(uid, data) {
  await setDoc(userEmailConfigRef(uid), removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
}

// ── Provedores de e-mail (Resend) — múltiplos, cada um com vários remetentes ──
export async function getEmailProviders(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'emailProviders'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
}

export async function saveEmailProvider(uid, id, data) {
  if (id) {
    await setDoc(doc(db, 'users', uid, 'emailProviders', id), removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'users', uid, 'emailProviders'), removeUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  return ref.id
}

export async function deleteEmailProvider(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'emailProviders', id))
}

// ── Produtos escondidos do seletor de WhatsApp (preferência do usuário) ──
export async function getWaHiddenProducts(uid) {
  const snap = await getDoc(doc(db, 'users', uid, 'config', 'whatsapp'))
  return snap.exists() ? snap.data().hiddenProducts || [] : []
}

export async function saveWaHiddenProducts(uid, hiddenProducts) {
  await setDoc(doc(db, 'users', uid, 'config', 'whatsapp'), { hiddenProducts, updatedAt: serverTimestamp() }, { merge: true })
}

/** Contador de reenvios manuais de um lead (para o "Enviado +N"). */
export async function setLeadReenvios(uid, leadId, reenvios) {
  await setDoc(doc(db, 'users', uid, 'leads', leadId), { reenvios }, { merge: true })
}

// ── Checkouts: lojas + links de checkout dos produtos ──
export async function getCheckoutStores(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'checkoutStores'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
}

export async function saveCheckoutStore(uid, id, data) {
  if (id) {
    await setDoc(doc(db, 'users', uid, 'checkoutStores', id), removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'users', uid, 'checkoutStores'), removeUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  return ref.id
}

export async function deleteCheckoutStore(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'checkoutStores', id))
}

// ── Templates de E-mail (construtor GrapesJS) ──

export function userEmailTemplatesRef(uid) {
  return collection(db, 'users', uid, 'emailTemplates')
}

export async function getEmailTemplates(uid) {
  const snap = await getDocs(userEmailTemplatesRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

/** Cria (id vazio) ou atualiza um template. Retorna o id. */
export async function saveEmailTemplate(uid, id, data) {
  if (id) {
    const ref = doc(db, 'users', uid, 'emailTemplates', id)
    await setDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(userEmailTemplatesRef(uid), {
    ...removeUndefined(data),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteEmailTemplate(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'emailTemplates', id))
}

// ── Blocos gerados por IA (Grok) no construtor — reusáveis pelo bloco "IA" ──
export function userIaBlocksRef(uid) {
  return collection(db, 'users', uid, 'iaBlocks')
}
export async function getIaBlocks(uid) {
  const snap = await getDocs(userIaBlocksRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}
export async function saveIaBlock(uid, { id, nome, html }) {
  if (id) {
    await setDoc(doc(db, 'users', uid, 'iaBlocks', id), removeUndefined({ nome, html, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(userIaBlocksRef(uid), removeUndefined({ nome, html, createdAt: serverTimestamp() }))
  return ref.id
}
export async function deleteIaBlock(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'iaBlocks', id))
}

// ── Templates de mensagens (copys de WhatsApp salvas) ──

export function userMessageTemplatesRef(uid) {
  return collection(db, 'users', uid, 'messageTemplates')
}

export async function getMessageTemplates(uid) {
  if (!uid) return []
  const snap = await getDocs(userMessageTemplatesRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

/** Cria (id vazio) ou atualiza um template de mensagem. Retorna o id. */
export async function saveMessageTemplate(uid, id, data) {
  if (id) {
    const ref = doc(db, 'users', uid, 'messageTemplates', id)
    await setDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(userMessageTemplatesRef(uid), {
    ...removeUndefined(data),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteMessageTemplate(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'messageTemplates', id))
}

// ── Automações de E-mail (evento → template) ──

export function userEmailAutomationsRef(uid) {
  return collection(db, 'users', uid, 'emailAutomations')
}

export async function getEmailAutomations(uid) {
  const snap = await getDocs(userEmailAutomationsRef(uid))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
}

/** docId = `${grupoId}__${evento}`. Automação por (grupo de produto, evento). */
export async function saveEmailAutomation(uid, grupoId, evento, data) {
  const ref = doc(db, 'users', uid, 'emailAutomations', `${grupoId}__${evento}`)
  await setDoc(ref, removeUndefined({ grupoId, evento, ...data, updatedAt: serverTimestamp() }), { merge: true })
}

// ── Grupos de produtos ──

export function userProductGroupsRef(uid) {
  return collection(db, 'users', uid, 'productGroups')
}

export async function getProductGroups(uid) {
  const snap = await getDocs(userProductGroupsRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
}

export async function saveProductGroup(uid, id, data) {
  if (id) {
    const ref = doc(db, 'users', uid, 'productGroups', id)
    await setDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(userProductGroupsRef(uid), { ...removeUndefined(data), createdAt: serverTimestamp() })
  return ref.id
}

// ── Nichos (segmentos de leads para disparo) ──
export function userNichosRef(uid) {
  return collection(db, 'users', uid, 'nichos')
}

export async function getNichos(uid) {
  const snap = await getDocs(userNichosRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function saveNicho(uid, id, data) {
  if (id) {
    const ref = doc(db, 'users', uid, 'nichos', id)
    await setDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(userNichosRef(uid), { ...removeUndefined(data), createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteNicho(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'nichos', id))
}

export async function deleteProductGroup(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'productGroups', id))
}

// ── Disparos de E-mail (envio em massa) ──

export async function getEmailDisparos(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'emailDisparos'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function deleteEmailDisparo(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'emailDisparos', id))
}

// ── Disparos de SMS (Telnyx / internacional) ──

/** canal opcional: 'eua' | 'api'. Filtra pelos disparos daquele canal (default de docs antigos = 'eua'). */
export async function getSmsDisparos(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'smsDisparos'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((d) => !canal || (d.canal || (d.contaPropria ? 'api' : 'eua')) === canal)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function deleteSmsDisparo(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'smsDisparos', id))
}

// ── Eventos de E-mail (aberturas, cliques, entregas — vindos do Resend) ──

export async function getEmailEvents(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'emailEvents'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

// ── Funis de E-mail (construtor visual) ──

export async function getEmailFunnels(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'emailFunnels'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function saveEmailFunnel(uid, id, data) {
  if (id) {
    const ref = doc(db, 'users', uid, 'emailFunnels', id)
    await setDoc(ref, removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'users', uid, 'emailFunnels'), {
    ...removeUndefined(data),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteEmailFunnel(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'emailFunnels', id))
}

// ── Funil de WhatsApp (mesmo motor do funil de e-mail, canal 'whatsapp') ──
export async function getWhatsappFunnels(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'whatsappFunnels'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
}

export async function saveWhatsappFunnel(uid, id, data) {
  if (id) {
    await setDoc(doc(db, 'users', uid, 'whatsappFunnels', id), removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'users', uid, 'whatsappFunnels'), removeUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  return ref.id
}

export async function deleteWhatsappFunnel(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'whatsappFunnels', id))
}

// ── Funil de SMS (Telnyx / internacional) ──

export async function getSmsFunnels(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'smsFunnels'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => !canal || (d.smsCanal || 'eua') === canal)
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
}

export async function saveSmsFunnel(uid, id, data) {
  if (id) {
    await setDoc(doc(db, 'users', uid, 'smsFunnels', id), removeUndefined({ ...data, updatedAt: serverTimestamp() }), { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'users', uid, 'smsFunnels'), removeUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  return ref.id
}

export async function deleteSmsFunnel(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'smsFunnels', id))
}

// ── Automações de SMS (por grupo de produto × evento) ──

export async function getSmsAutomations(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'smsAutomations'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => !canal || (d.canal || 'eua') === canal)
}

export async function saveSmsAutomationGrupo(uid, grupoId, evento, data, canal = 'eua') {
  // Chave namespaced por canal (eua/api) — legado (sem prefixo) = eua.
  const key = canal === 'eua' ? `${grupoId}__${evento}` : `${canal}__${grupoId}__${evento}`
  const ref = doc(db, 'users', uid, 'smsAutomations', key)
  await setDoc(ref, removeUndefined({ grupoId, evento, canal, ...data, updatedAt: serverTimestamp() }), { merge: true })
  return key
}

export async function getSmsLogs(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'smsLogs'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((d) => !canal || (d.canal || 'eua') === canal)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

/** Mensagens de SMS enviadas em disparos em massa (users/{uid}/smsMensagens). Usado nas métricas. */
export async function getSmsMensagens(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'smsMensagens'))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
}

/** Registros de envio do funil (um por e-mail enviado por um nó "Enviar"). */
export async function getFunnelSends(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'funnelSends'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

// ── Call Marketing IA (Ligação IA — Telnyx Voice) ──

/** Agentes de IA (roteiro + voz + velocidade). */
export async function getCallAgents(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'callAgents'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((d) => !canal || (d.canal || 'eua') === canal)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}
export async function saveCallAgent(uid, id, data) {
  if (id) { await setDoc(doc(db, 'users', uid, 'callAgents', id), { ...data, updatedAt: serverTimestamp() }, { merge: true }); return id }
  const ref = await addDoc(collection(db, 'users', uid, 'callAgents'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}
export async function deleteCallAgent(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'callAgents', id))
}

/** Configurações de chamada salvas (presets reutilizáveis). */
export async function getCallConfigs(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'callConfigs'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}
export async function saveCallConfig(uid, data) {
  const ref = await addDoc(collection(db, 'users', uid, 'callConfigs'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}
export async function deleteCallConfig(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'callConfigs', id))
}

/** Disparos de ligação (resumo de cada campanha). */
export async function getCallDisparos(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'callDisparos'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((d) => !canal || (d.canal || 'eua') === canal)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

/** Logs de ligação (um por chamada — status, segundos, débito). */
export async function getCallLogs(uid, canal) {
  const snap = await getDocs(collection(db, 'users', uid, 'callLogs'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((d) => !canal || (d.canal || 'eua') === canal)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

// ── Logs de E-mail ──

export async function getEmailLogs(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'emailLogs'))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

// ── Products ──

export function userProductsRef(uid) {
  return collection(db, 'users', uid, 'products')
}

export async function getProducts(uid) {
  const snap = await getDocs(userProductsRef(uid))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
}

// ── AutoMessages (templates por evento) ──

export function userAutoMessagesRef(uid) {
  return collection(db, 'users', uid, 'autoMessages')
}

export async function getAutoMessages(uid) {
  const snap = await getDocs(userAutoMessagesRef(uid))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
}

/** Gera id do doc: um por (evento, produto). Produto vazio = mensagem global para o evento. */
function autoMessageDocId(evento, produto) {
  const p = (produto || '').toString().trim().replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80)
  return p ? `${p}_${evento}` : evento
}

export async function saveAutoMessage(uid, evento, produto, data) {
  const docId = autoMessageDocId(evento, produto ?? '')
  const ref = doc(db, 'users', uid, 'autoMessages', docId)
  await setDoc(ref, removeUndefined({ evento, produto: produto ?? '', ...data, updatedAt: serverTimestamp() }), { merge: true })
}

/** Automação de WhatsApp por GRUPO de produto (mesmo modelo do e-mail). docId: `${grupoId}__${evento}`. */
export async function saveAutoMessageGrupo(uid, grupoId, evento, data) {
  const ref = doc(db, 'users', uid, 'autoMessages', `${grupoId}__${evento}`)
  await setDoc(ref, removeUndefined({ grupoId, evento, ...data, updatedAt: serverTimestamp() }), { merge: true })
}

// ── Message Logs ──

export function userMessageLogsRef(uid) {
  return collection(db, 'users', uid, 'messageLogs')
}

export async function getMessageLogs(uid) {
  const snap = await getDocs(userMessageLogsRef(uid))
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function addMessageLog(uid, payload) {
  await addDoc(userMessageLogsRef(uid), {
    ...removeUndefined(payload),
    createdAt: serverTimestamp(),
  })
}

// ── Re-enviar lead individual ──

export async function reenviarLead(uid, lead, mensagemTemplate, evolution) {
  const { WEBHOOK_REMARKETING } = await import('./constants')

  const mensagem = mensagemTemplate
    .replace(/\{nome_cliente\}/gi, lead.nome || '')
    .replace(/\{numero_cliente\}/gi, lead.telefone || '')
    .replace(/\{email_cliente\}/gi, lead.email || '')
    .replace(/\{nome_produto\}/gi, lead.produto || '')

  const numeroWhatsApp = (evolution?.numeroWhatsapp || evolution?.numeroWhatsApp || '').toString().replace(/\D/g, '')
  const payload = {
    tipoAcao: 'enviar_remarketing',
    contatos: [{ nome: lead.nome, telefone: lead.telefone, email: lead.email }],
    mensagem,
    nomeInstancia: evolution?.nomeInstancia || '',
    hash: evolution?.hash || '',
    instanciaId: evolution?.instanceId || evolution?.hash || '',
    numeroWhatsApp: numeroWhatsApp || undefined,
    evento: lead.evento,
    produto: lead.produto,
  }

  const res = await fetch(WEBHOOK_REMARKETING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // Respeita a resposta real do n8n: se ele disser que falhou, é erro (mesmo com HTTP 200)
  let body = {}
  try { const t = await res.text(); if (t && t.trim()) body = JSON.parse(t) } catch (_) {}
  let ok = res.ok
  if (res.ok && body && typeof body === 'object') {
    if (body.success === false || body.enviado === false || body.sent === false) ok = false
    else if (body.success === true || body.enviado === true || body.sent === true || body.ok === true) ok = true
  }
  const erroMsg = ok ? null : (body.erro || body.error || body.message || `n8n respondeu ${res.status}`)

  await updateLeadStatus(uid, lead.id, {
    status: ok ? 'enviado' : 'erro',
    erroMsg,
    mensagemEnviada: mensagem,
    enviadoEm: serverTimestamp(),
  })

  await addMessageLog(uid, {
    leadId: lead.id,
    evento: lead.evento,
    produto: lead.produto,
    telefone: lead.telefone,
    nome: lead.nome,
    status: ok ? 'enviado' : 'erro',
    erroMsg,
    mensagem,
  })

  return ok
}

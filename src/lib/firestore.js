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
import { db } from './firebase'

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
    if (instSnap.exists()) return { id: instSnap.id, ...instSnap.data() }
  }

  const instancesSnap = await getDocs(userInstancesRef(uid))
  const instances = instancesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
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
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
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
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
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
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
      const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
      return tb - ta
    })
}

export async function updateWebhook(uid, webhookId, data) {
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
    .map((d) => ({ id: d.id, ...d.data() }))
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
    .map((d) => ({ id: d.id, ...d.data() }))
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
    .map((d) => ({ id: d.id, ...d.data() }))
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

// ── Products ──

export function userProductsRef(uid) {
  return collection(db, 'users', uid, 'products')
}

export async function getProducts(uid) {
  const snap = await getDocs(userProductsRef(uid))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── AutoMessages (templates por evento) ──

export function userAutoMessagesRef(uid) {
  return collection(db, 'users', uid, 'autoMessages')
}

export async function getAutoMessages(uid) {
  const snap = await getDocs(userAutoMessagesRef(uid))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
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

// ── Message Logs ──

export function userMessageLogsRef(uid) {
  return collection(db, 'users', uid, 'messageLogs')
}

export async function getMessageLogs(uid) {
  const snap = await getDocs(userMessageLogsRef(uid))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
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

  const payload = {
    tipoAcao: 'enviar_remarketing',
    contatos: [{ nome: lead.nome, telefone: lead.telefone, email: lead.email }],
    mensagem,
    nomeInstancia: evolution?.nomeInstancia || '',
    hash: evolution?.hash || '',
    instanciaId: evolution?.instanceId || evolution?.hash || '',
    evento: lead.evento,
    produto: lead.produto,
  }

  const res = await fetch(WEBHOOK_REMARKETING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const ok = res.ok
  await updateLeadStatus(uid, lead.id, {
    status: ok ? 'enviado' : 'erro',
    erroMsg: ok ? null : `n8n respondeu ${res.status}`,
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
    erroMsg: ok ? null : `n8n respondeu ${res.status}`,
    mensagem,
  })

  return ok
}

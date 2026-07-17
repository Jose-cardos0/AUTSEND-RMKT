import { WEBHOOK_EVOLUTION } from './constants'
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

/** Evita "Unexpected end of JSON input" quando o webhook retorna body vazio ou não-JSON */
async function parseJsonResponse(res) {
  const text = await res.text()
  if (!text || text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return { _raw: text }
  }
}

/**
 * Cria a instância via Cloud Function `waCriarInstancia`: a trava de plano (limite `instancias`)
 * roda no servidor, que cria no Evolution E grava o doc no Firestore (o client não cria mais —
 * a coleção `instances` bloqueia `create` nas rules). Devolve o id do doc + o QR/hash.
 */
export async function criarInstancia(nomeInstancia, numeroWhatsapp = '') {
  const numero = (numeroWhatsapp || '').trim().replace(/\D/g, '')
  const call = httpsCallable(functions, 'waCriarInstancia')
  const r = await call({ nomeInstancia: (nomeInstancia || '').trim(), numeroWhatsapp: numero })
  return r.data // { id, base64, hash, instanceId }
}

/** Checa no servidor (sem cache) se o cliente ainda pode criar instância. */
export async function podeCriarInstancia() {
  const call = httpsCallable(functions, 'instanciaPodeCriar')
  const r = await call()
  return r.data // { pode, atual, limite }
}

export async function verificarStatus(nomeInstancia, getParticipants = false, numeroWhatsapp = '') {
  const payload = {
    tipoAcao: 'verificar_status',
    nomeInstancia: nomeInstancia || '',
    getParticipants,
  }
  const numero = (numeroWhatsapp || '').trim().replace(/\D/g, '')
  if (numero) payload.numeroWhatsApp = numero
  const res = await fetch(WEBHOOK_EVOLUTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data?.message || data?.error || 'Falha ao verificar status')
  return data
}

export async function buscarGrupos({ nomeInstancia, hash, instanciaId }) {
  const res = await fetch(WEBHOOK_EVOLUTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipoAcao: 'buscar_grupo',
      nomeInstancia: nomeInstancia || '',
      hash: hash || '',
      instanciaId: instanciaId || '',
    }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data?.message || data?.error || 'Falha ao buscar grupos')
  return data
}

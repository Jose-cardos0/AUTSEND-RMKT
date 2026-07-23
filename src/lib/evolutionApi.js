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
  return r.data // { id, base64 (data URI do QR), nomeInstancia (normalizado p/ WAHA), hash:null, instanceId:null }
}

/**
 * Renova o QR de uma sessão WAHA (o anterior expira em ~60s / 20s).
 * Vai pela Cloud Function (servidor→n8n) — fetch direto do browser é bloqueado por CORS.
 */
export async function obterQr(nomeInstancia) {
  const call = httpsCallable(functions, 'waInstanciaAcao')
  const r = await call({ tipoAcao: 'obter_qr', nomeInstancia: (nomeInstancia || '').trim() })
  return r.data
}

/** Reinicia a sessão (restart) sem apagar credencial — usado pra reconectar quando cai. */
export async function reconectarInstancia(nomeInstancia) {
  const call = httpsCallable(functions, 'waInstanciaAcao')
  const r = await call({ tipoAcao: 'reconectar', nomeInstancia: (nomeInstancia || '').trim() })
  return r.data
}

/** Exclui a sessão no WAHA (via WF3, rota excluir_instancia) — servidor→n8n. Chamar ANTES de apagar o doc. */
export async function excluirInstanciaWaha(nomeInstancia) {
  const call = httpsCallable(functions, 'waInstanciaAcao')
  const r = await call({ tipoAcao: 'excluir_instancia', nomeInstancia: (nomeInstancia || '').trim() })
  return r.data
}

/** Checa no servidor (sem cache) se o cliente ainda pode criar instância. */
export async function podeCriarInstancia() {
  const call = httpsCallable(functions, 'instanciaPodeCriar')
  const r = await call()
  return r.data // { pode, atual, limite }
}

/** Status da sessão WAHA — via Cloud Function (servidor→n8n), sem CORS. */
export async function verificarStatus(nomeInstancia, getParticipants = false, numeroWhatsapp = '') {
  const call = httpsCallable(functions, 'waInstanciaAcao')
  const r = await call({
    tipoAcao: 'verificar_status',
    nomeInstancia: (nomeInstancia || '').trim(),
    numeroWhatsApp: (numeroWhatsapp || '').trim().replace(/\D/g, ''),
  })
  return r.data
}

/** Busca grupos via Cloud Function (servidor→n8n com a chave secreta). O browser não fala com o n8n direto. */
export async function buscarGrupos({ nomeInstancia, hash, instanciaId }) {
  const call = httpsCallable(functions, 'waBuscarGrupos')
  const r = await call({ nomeInstancia: nomeInstancia || '', hash: hash || '', instanciaId: instanciaId || '' })
  return r.data
}

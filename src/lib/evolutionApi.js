import { WEBHOOK_EVOLUTION } from './constants'

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

export async function criarInstancia(nomeInstancia, numeroWhatsapp = '') {
  const numero = (numeroWhatsapp || '').trim().replace(/\D/g, '')
  const payload = {
    tipoAcao: 'criar_instancia',
    nomeInstancia: (nomeInstancia || '').trim() || `instancia_${Date.now()}`,
  }
  if (numero) payload.numeroWhatsApp = numero
  const res = await fetch(WEBHOOK_EVOLUTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data?.message || data?.error || 'Falha ao criar instância')
  return data
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

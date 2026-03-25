import { WEBHOOK_MSG_WHATSAPP } from './constants'

function buildEvolutionPayload(evolution) {
  return {
    nomeInstancia: evolution?.nomeInstancia ?? '',
    numeroWhatsApp: (evolution?.numeroWhatsapp ?? evolution?.numeroWhatsApp ?? '').toString().replace(/\D/g, '') || undefined,
    hash: evolution?.hash ?? '',
    instanciaId: evolution?.instanceId ?? evolution?.hash ?? '',
  }
}

/** Envia um único lead para o n8n (com disparoId e nomeDisparo). */
export async function enviarUmaMensagemLead(contato, mensagem, evolution, disparoId, nomeDisparo) {
  const payload = {
    tipoDisparo: 'leads',
    tipoAcao: 'enviar_mensagem',
    disparoId,
    nomeDisparo: nomeDisparo || '',
    contatos: [{ telefone: String(contato.telefone || '').replace(/\D/g, '') || contato.telefone, nome: contato.nome || '' }],
    mensagem: mensagem || '',
    ...buildEvolutionPayload(evolution),
  }
  const res = await fetch(WEBHOOK_MSG_WHATSAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao enviar mensagem')
  const text = await res.text()
  if (!text?.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Um único POST para o n8n com todos os contatos + mensagem (template com {nome}).
 * O n8n deve iterar o array e enviar com pausa (ex.: intervaloMinutos entre cada).
 * @param {Array<{ telefone?: string, nome?: string }>} contatos
 * @param {string} mensagem - template; o n8n pode substituir {nome} por contato.nome
 * @param {object} evolution
 * @param {{ disparoId?: string, nomeDisparo?: string, intervaloMinutos?: number }} [extra]
 */
export async function enviarMensagemWhatsApp(contatos, mensagem, evolution, extra = {}) {
  const { disparoId = '', nomeDisparo = '', intervaloMinutos = 5 } = extra
  const payload = {
    tipoDisparo: 'leads',
    tipoAcao: 'enviar_mensagem',
    disparoId,
    nomeDisparo,
    intervaloMinutos,
    contatos: contatos.map((c) => {
      const nome = (c.nome || '').trim()
      const telefone = String(c.telefone || '').replace(/\D/g, '') || c.telefone
      return {
        telefone,
        nome,
        // Já vai pronto para o n8n: um array com numero + nome + mensagem por contato
        mensagem: (mensagem || '').replace(/\{nome\}/gi, nome),
      }
    }),
    mensagem: mensagem || '',
    ...buildEvolutionPayload(evolution),
  }
  const res = await fetch(WEBHOOK_MSG_WHATSAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao enviar mensagem')
  const text = await res.text()
  if (!text?.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

const ENVIAR_GRUPOS_TIMEOUT_MS = 25000

/**
 * Envia mensagem de remarketing para grupos no WhatsApp.
 * Usa a instância conectada em Integrações: nomeInstancia, numeroWhatsApp, hash, instanciaId.
 * Se o n8n responder 200 dentro do timeout, retorna sucesso. Se der timeout, considera enviado (evita loading infinito).
 */
export async function enviarMensagemParaGrupos(grupos, mensagemTexto, evolution) {
  const payload = {
    tipoDisparo: 'grupos',
    mensagem: { texto: mensagemTexto },
    grupos,
    nomeInstancia: evolution?.nomeInstancia ?? '',
    numeroWhatsApp: (evolution?.numeroWhatsapp ?? evolution?.numeroWhatsApp ?? '').toString().replace(/\D/g, '') || undefined,
    hash: evolution?.hash ?? undefined,
    instanciaId: evolution?.instanceId ?? evolution?.hash ?? undefined,
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ENVIAR_GRUPOS_TIMEOUT_MS)
  try {
    const res = await fetch(WEBHOOK_MSG_WHATSAPP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error('Falha ao enviar mensagem para grupos')
    const text = await res.text()
    if (!text?.trim()) return {}
    try {
      return JSON.parse(text)
    } catch {
      return {}
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      // n8n pode demorar; mensagem já foi aceita. Considera enviado para não travar a UI.
      return {}
    }
    throw err
  }
}

import { WEBHOOK_REMARKETING } from './constants'

/**
 * Envia campanha de remarketing para o n8n.
 * @param {Array<{ nome?: string, telefone?: string, email?: string, [key: string]: any }>} contatos
 * @param {string} mensagem
 * @param {object} [evolution] - config da instância (nomeInstancia, hash, instanceId) para o n8n
 */
export async function enviarRemarketing(contatos, mensagem, evolution) {
  const payload = {
    tipoAcao: 'enviar_remarketing',
    contatos,
    mensagem,
    nomeInstancia: evolution?.nomeInstancia ?? '',
    hash: evolution?.hash ?? '',
    instanciaId: evolution?.instanceId ?? evolution?.hash ?? '',
  }
  const res = await fetch(WEBHOOK_REMARKETING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao enviar remarketing')
  const text = await res.text()
  if (!text?.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

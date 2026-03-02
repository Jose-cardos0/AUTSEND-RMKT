import { WEBHOOK_MSG_WHATSAPP } from './constants'

/**
 * Envia mensagem para leads via n8n (lista separada da plataforma).
 */
export async function enviarMensagemWhatsApp(contatos, mensagem, instanciaId) {
  const res = await fetch(WEBHOOK_MSG_WHATSAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipoAcao: 'enviar_mensagem',
      contatos,
      mensagem,
      instanciaId,
    }),
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
 * Envia mensagem de remarketing para grupos no WhatsApp.
 * Usa a instância conectada em Integrações: nomeInstancia, numeroWhatsApp, hash, instanciaId.
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
  const res = await fetch(WEBHOOK_MSG_WHATSAPP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao enviar mensagem para grupos')
  const text = await res.text()
  if (!text?.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

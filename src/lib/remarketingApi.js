import { WEBHOOK_REMARKETING } from './constants'

/**
 * Envia campanha de remarketing para o n8n.
 * Substitui {nome} na mensagem pelo nome de cada contato antes de enviar.
 * @param {Array<{ nome?: string, name?: string, telefone?: string, email?: string, [key: string]: any }>} contatos
 * @param {string} mensagem - template; {nome} é trocado pelo nome do contato
 * @param {object} [evolution] - config da instância (nomeInstancia, hash, instanceId) para o n8n
 */
export async function enviarRemarketing(contatos, mensagem, evolution) {
  const basePayload = {
    tipoAcao: 'enviar_remarketing',
    nomeInstancia: evolution?.nomeInstancia ?? '',
    hash: evolution?.hash ?? '',
    instanciaId: evolution?.instanceId ?? evolution?.hash ?? '',
  }

  for (const contato of contatos) {
    const nome = contato.nome ?? contato.name ?? ''
    const produto = contato.produto ?? contato.nome_produto ?? ''
    const email = contato.email ?? ''
    const telefone = contato.telefone ?? contato.phone ?? contato.numero ?? ''
    const mensagemPersonalizada = mensagem
      .replace(/\{nome_cliente\}/gi, nome)
      .replace(/\{nome_produto\}/gi, produto)
      .replace(/\{numero_cliente\}/gi, telefone)
      .replace(/\{email_cliente\}/gi, email)
      .replace(/\{nome\}/gi, nome)
    const payload = {
      ...basePayload,
      contatos: [contato],
      mensagem: mensagemPersonalizada,
    }
    const res = await fetch(WEBHOOK_REMARKETING, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Falha ao enviar remarketing')
    const text = await res.text()
    if (text?.trim()) {
      try {
        JSON.parse(text)
      } catch {
        // ignora resposta não-JSON
      }
    }
  }
  return {}
}

import { WEBHOOK_REMARKETING } from './constants'

/**
 * Envia campanha de remarketing para o n8n.
 * Substitui {nome} na mensagem pelo nome de cada contato antes de enviar.
 * @param {Array<{ nome?: string, name?: string, telefone?: string, email?: string, [key: string]: any }>} contatos
 * @param {string} mensagem - template; {nome} é trocado pelo nome do contato
 * @param {object} [evolution] - config da instância (nomeInstancia, hash, instanceId) para o n8n
 */
export async function enviarRemarketing(contatos, mensagem, evolution, midia = {}) {
  const sessao = evolution?.nomeInstancia ?? ''
  const imagemUrl = midia.imagemUrl || null
  const audioUrl = midia.audioUrl || null

  for (const contato of contatos) {
    const nome = contato.nome ?? contato.name ?? ''
    const produto = contato.produto ?? contato.nome_produto ?? ''
    const email = contato.email ?? ''
    const telefone = String(contato.telefone ?? contato.phone ?? contato.numero ?? '').replace(/\D/g, '')
    const mensagemPersonalizada = (mensagem || '')
      .replace(/\{nome_cliente\}/gi, nome)
      .replace(/\{nome_produto\}/gi, produto)
      .replace(/\{numero_cliente\}/gi, telefone)
      .replace(/\{email_cliente\}/gi, email)
      .replace(/\{nome\}/gi, nome)
    // Contrato WF1 (WAHA): { sessao, campanhaId, blocos, contatos }. Sem hash/tipoAcao.
    // Blocos: texto (+ imagem + áudio, nessa ordem) — o WF1 renderiza cada tipo.
    const blocos = []
    if (mensagemPersonalizada.trim()) blocos.push({ tipo: 'texto', conteudo: mensagemPersonalizada })
    if (imagemUrl) blocos.push({ tipo: 'imagem', url: imagemUrl })
    if (audioUrl) blocos.push({ tipo: 'audio', url: audioUrl })
    const payload = {
      sessao,
      campanhaId: 'remarketing',
      blocos,
      contatos: [{ telefone, nome }],
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

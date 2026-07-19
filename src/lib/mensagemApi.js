import { WEBHOOK_MSG_WHATSAPP } from './constants'

/** Normaliza nome vindo de Excel/cópia (NBSP, zero-width, etc.). */
export function normalizeNomeContato(str) {
  return String(str ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
}

/** Substitui {nome} / {{nome}} / { nome } / ｛nome｝ e remove caracteres invisíveis no template. */
export function personalizarMensagemComNome(template, nome) {
  const n = normalizeNomeContato(nome)
  let t = String(template ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  // Ordem: {{nome}} antes de {nome}, senão "{{nome}}" vira "{fulano}" errado
  t = t.replace(/\{\{nome\}\}/gi, n)
  t = t.replace(/｛\s*nome\s*｝/gi, n)
  t = t.replace(/\{\s*nome\s*\}/gi, n)
  return t
}

/** 1 bloco de texto (contrato WF1/WAHA). */
function blocoTexto(texto) {
  return [{ tipo: 'texto', conteudo: String(texto ?? '') }]
}

/** Envia um único lead via WF1 (WAHA). */
export async function enviarUmaMensagemLead(contato, mensagem, evolution, disparoId, nomeDisparo) {
  const nome = normalizeNomeContato(contato.nome || contato.name || '')
  const telefone = String(contato.telefone || '').replace(/\D/g, '') || contato.telefone
  const payload = {
    sessao: evolution?.nomeInstancia ?? '',
    campanhaId: disparoId || nomeDisparo || 'disparo',
    blocos: blocoTexto(personalizarMensagemComNome(mensagem, nome)),
    contatos: [{ telefone, nome }],
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
 * Um único POST para o WF1 (WAHA) com TODOS os contatos. O n8n resolve o chatId de cada um,
 * picota o texto e espaça 35–75s entre contatos (anti-ban). A personalização por lead vai em
 * `contatos[].blocos` (o WF1 usa o bloco do contato quando presente; `blocos` no topo é fallback).
 * @param {Array<{ telefone?: string, nome?: string }>} contatos
 * @param {string} mensagem - template com {nome}
 * @param {object} evolution
 * @param {{ disparoId?: string, nomeDisparo?: string }} [extra]
 */
export async function enviarMensagemWhatsApp(contatos, mensagem, evolution, extra = {}) {
  const { disparoId = '', nomeDisparo = '' } = extra
  const contatosPayload = contatos.map((c) => {
    const nome = normalizeNomeContato(c.nome || c.name || '')
    const telefone = String(c.telefone || '').replace(/\D/g, '') || c.telefone
    return { telefone, nome, blocos: blocoTexto(personalizarMensagemComNome(mensagem, nome)) }
  })
  const payload = {
    sessao: evolution?.nomeInstancia ?? '',
    campanhaId: disparoId || nomeDisparo || 'disparo',
    // Fallback caso o WF1 não leia contatos[].blocos (personalização por lead está em cada contato).
    blocos: blocoTexto(mensagem || ''),
    contatos: contatosPayload,
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
 * Envia mensagem de remarketing para grupos no WhatsApp.
 * Usa a instância conectada em Integrações: nomeInstancia, numeroWhatsApp, hash, instanciaId.
 * Se o n8n responder 200 dentro do timeout, retorna sucesso. Se der timeout, considera enviado (evita loading infinito).
 */
export async function enviarMensagemParaGrupos() {
  // Disparo para GRUPOS ainda não foi portado para o WAHA (o servidor novo não tem esse fluxo).
  // Assim que o WF1 ganhar suporte a grupos, reativar aqui.
  throw new Error('Disparo para grupos está temporariamente indisponível (migração WAHA em andamento).')
}

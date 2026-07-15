// Traduz mensagens de erro de SMS (Telnyx vem em inglês) para português.
// Usado nos relatórios de Automações, Funil e Disparos.

const PADROES = [
  [/source and destination cannot be the same number:?\s*(\+?\d+)?/i,
    (m) => `Número de origem e destino são o mesmo${m[1] ? `: ${m[1]}` : ''}. Envie para outro número.`],
  [/the ['"]?to['"]? address should be a single valid number/i,
    () => 'Número de destino inválido — verifique o DDI e a quantidade de dígitos (ex.: +1 e mais 10 dígitos).'],
  [/the ['"]?from['"]? address should be a single valid number/i,
    () => 'Número de origem inválido. Verifique o número configurado.'],
  [/invalid.*(to|destination).*number/i,
    () => 'Número de destino inválido.'],
  [/(is not a valid|invalid) phone number/i,
    () => 'Número de telefone inválido.'],
  [/not a valid destination/i,
    () => 'Destino inválido — este número não pode receber SMS.'],
  [/unreachable|not reachable/i,
    () => 'Número inalcançável — não foi possível entregar o SMS.'],
  [/blocked|blocklist|do not originate/i,
    () => 'Número bloqueado para envio.'],
  [/messaging profile/i,
    () => 'Perfil de mensagens da Telnyx não configurado corretamente.'],
  [/insufficient.*(fund|balance)|balance.*insufficient/i,
    () => 'Saldo insuficiente na conta Telnyx.'],
  [/rate limit|too many requests/i,
    () => 'Muitos envios em pouco tempo — tente novamente em instantes.'],
  [/unauthorized|invalid api key|authentication/i,
    () => 'Chave de API da Telnyx inválida ou sem permissão.'],
  [/number.*not.*sms.*capable|not sms enabled|sms.*not.*enabled/i,
    () => 'Este número não tem SMS habilitado.'],
  [/^HTTP\s*(\d+)/i,
    (m) => `Falha na Telnyx (código ${m[1]}).`],
]

/** Recebe a mensagem de erro (pt ou en) e devolve em português quando reconhecida. */
export function traduzErroSMS(msg) {
  const s = String(msg || '').trim()
  if (!s) return ''
  for (const [re, fn] of PADROES) {
    const m = s.match(re)
    if (m) return fn(m)
  }
  return s // desconhecida: mantém original
}

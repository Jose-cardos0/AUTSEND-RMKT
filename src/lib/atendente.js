// App do atendente (call center) — fala DIRETO com os endpoints públicos (onRequest),
// sem Firebase auth. A sessão é um token HMAC de 30 dias guardado no aparelho.
const BASE = 'https://us-central1-afiliadocdnx.cloudfunctions.net'

const LS_SESSAO = 'atendente:sessao'
const LS_RAMAL = 'atendente:ramal'

export function getSessao() { try { return localStorage.getItem(LS_SESSAO) || '' } catch { return '' } }
export function getRamalSalvo() { try { return JSON.parse(localStorage.getItem(LS_RAMAL) || 'null') } catch { return null } }
export function salvarSessao(sessao, ramal) {
  try { localStorage.setItem(LS_SESSAO, sessao); if (ramal) localStorage.setItem(LS_RAMAL, JSON.stringify(ramal)) } catch { /* ignore */ }
}
export function limparSessao() {
  try { localStorage.removeItem(LS_SESSAO); localStorage.removeItem(LS_RAMAL) } catch { /* ignore */ }
}

/** Pareia com a pairKey → devolve { sessao, ramal }. Lança Error com mensagem amigável. */
export async function parear(pairKey) {
  const r = await fetch(`${BASE}/ramalParear`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairKey }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.erro || 'Não consegui parear este dispositivo.')
  return data // { sessao, ramal: { nome, numero } }
}

/** Gera o token efêmero WebRTC pra sessão atual. Lança Error (401 = sessão expirada). */
export async function obterTokenWebrtc() {
  const sessao = getSessao()
  if (!sessao) throw new Error('SEM_SESSAO')
  const r = await fetch(`${BASE}/ramalWebrtcToken`, {
    method: 'POST', headers: { Authorization: `Bearer ${sessao}` },
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) { limparSessao(); throw new Error(data?.erro || 'Sessão expirada. Pareie de novo.') }
  if (!r.ok) throw new Error(data?.erro || 'Não consegui conectar ao servidor de voz.')
  return data // { token, numero, nome }
}

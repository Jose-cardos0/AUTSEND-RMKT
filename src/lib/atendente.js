// App do atendente (call center) — fala DIRETO com os endpoints públicos (onRequest),
// sem Firebase auth. A sessão é um token HMAC de 30 dias guardado no aparelho.
const BASE = 'https://us-central1-afiliadocdnx.cloudfunctions.net'

const LS_SESSAO = 'atendente:sessao'
const LS_RAMAL = 'atendente:ramal'
const LS_HIST = 'atendente:historico'

export function getSessao() { try { return localStorage.getItem(LS_SESSAO) || '' } catch { return '' } }
export function getRamalSalvo() { try { return JSON.parse(localStorage.getItem(LS_RAMAL) || 'null') } catch { return null } }
export function salvarSessao(sessao, ramal) {
  try { localStorage.setItem(LS_SESSAO, sessao); if (ramal) localStorage.setItem(LS_RAMAL, JSON.stringify(ramal)) } catch { /* ignore */ }
}
export function limparSessao() {
  try { localStorage.removeItem(LS_SESSAO); localStorage.removeItem(LS_RAMAL); localStorage.removeItem(LS_HIST) } catch { /* ignore */ }
}

/** Reporta uma ligação concluída pro servidor (relatório do dono). Best-effort. */
export function registrarChamadaServidor(item) {
  const sessao = getSessao()
  if (!sessao) return
  const body = JSON.stringify({ ...item, sessao })
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(`${BASE}/ramalRegistrarChamada`, new Blob([body], { type: 'application/json' }))
      return
    }
    fetch(`${BASE}/ramalRegistrarChamada`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao}` }, body, keepalive: true }).catch(() => {})
  } catch { /* ignore */ }
}

// ── Histórico de ligações (local, por aparelho) ──
export function getHistorico() { try { return JSON.parse(localStorage.getItem(LS_HIST) || '[]') } catch { return [] } }
/** Adiciona uma ligação ao histórico e devolve a lista atualizada (máx 60). item: { id, dir:'in'|'out', num, atendida, dur, ts } */
export function addHistorico(item) {
  try { const h = [item, ...getHistorico()].slice(0, 60); localStorage.setItem(LS_HIST, JSON.stringify(h)); return h } catch { return getHistorico() }
}
export function limparHistorico() { try { localStorage.removeItem(LS_HIST) } catch { /* ignore */ } }

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

/** Pega as credenciais SIP (login/senha) do softphone pra sessão atual. Lança Error (401 = sessão expirada). */
export async function obterTokenWebrtc() {
  const sessao = getSessao()
  if (!sessao) throw new Error('SEM_SESSAO')
  const r = await fetch(`${BASE}/ramalWebrtcToken`, {
    method: 'POST', headers: { Authorization: `Bearer ${sessao}` },
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) { limparSessao(); throw new Error(data?.erro || 'Sessão expirada. Pareie de novo.') }
  if (!r.ok) throw new Error(data?.erro || 'Não consegui conectar ao servidor de voz.')
  return data // { login, password, numero, nome, fotoUrl }
}

/** Marca o ramal online/offline (heartbeat + offline ao sair). Best-effort. */
export function enviarPresenca(online) {
  const sessao = getSessao()
  if (!sessao) return
  const body = JSON.stringify({ online, sessao })
  try {
    // Offline: sendBeacon é o jeito confiável de enviar na saída (não é bloqueado por navegação/fechar app).
    if (!online && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(`${BASE}/ramalPresenca`, new Blob([body], { type: 'application/json' }))
      return
    }
    fetch(`${BASE}/ramalPresenca`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao}` }, body, keepalive: true }).catch(() => {})
  } catch { /* ignore */ }
}

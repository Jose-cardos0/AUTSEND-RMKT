import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const call = (name) => httpsCallable(functions, name)

/** URL do app instalável (PWA) do atendente — o cliente manda pros funcionários dele. */
export const PWA_ATENDENTE_URL = 'https://autsend.com.br/atendente'

/** Cria um ramal de call center num número BYO. id = 'byo:{providerId}:{norm}'. */
export async function criarRamal(id, nome) {
  const r = await call('ramalCriar')({ id, nome })
  return r.data // { ok, ramalId, pairKey, numero }
}

/** Lista os ramais do cliente. */
export async function listarRamais() {
  const r = await call('ramalListar')()
  return r.data // { ramais: [{ id, nome, numero, status, pairKey, ultimoAcesso }] }
}

/** Revoga um ramal (apaga na Telnyx + derruba o acesso do atendente). */
export async function revogarRamal(ramalId) {
  const r = await call('ramalRevogar')({ ramalId })
  return r.data
}

/** Define/remove a foto do ramal (só o cliente, pelo web). dataUrl vazio remove. */
export async function setFotoRamal(ramalId, dataUrl) {
  const r = await call('ramalSetFoto')({ ramalId, dataUrl })
  return r.data // { ok, fotoUrl }
}

/** Corrige o recebimento de chamadas do ramal (reaponta o número pra central dele na Telnyx). */
export async function reassociarRamal(ramalId) {
  const r = await call('ramalReassociar')({ ramalId })
  return r.data // { ok, jaEstavaOk, connectionAntes, connectionAgora }
}

/** Link de pareamento (o QR aponta pra cá; abre o PWA já com o código). */
export function linkPareamento(pairKey) {
  return `${PWA_ATENDENTE_URL}?k=${encodeURIComponent(pairKey)}`
}

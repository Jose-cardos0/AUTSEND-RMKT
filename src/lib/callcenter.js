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

/** Link de pareamento (o QR aponta pra cá; abre o PWA já com o código). */
export function linkPareamento(pairKey) {
  return `${PWA_ATENDENTE_URL}?k=${encodeURIComponent(pairKey)}`
}

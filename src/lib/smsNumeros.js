import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const call = (name) => httpsCallable(functions, name)

/** Busca números toll-free (EUA) disponíveis pra compra na Telnyx. */
export async function buscarNumerosSMS() {
  const r = await call('smsBuscarNumeros')()
  return r.data // { numeros: [{ numero, regiao, tipo }] }
}

/** Cria o checkout Stripe (assinatura R$29,90/mês por número) e devolve a URL. Aceita 1 número ou uma lista. */
export async function criarCheckoutNumeroSMS(numeros) {
  const lista = Array.isArray(numeros) ? numeros : [numeros]
  const r = await call('smsCriarCheckoutNumero')({ numeros: lista })
  return r.data // { url }
}

/** Lista os números SMS do cliente. */
export async function listarNumerosSMS() {
  const r = await call('smsListarNumeros')()
  return r.data // { numeros: [{ id, numero, status, principal, erro, valorMensal, criadoEm }] }
}

/** Define qual número é o principal (usado nos envios). */
export async function setPrincipalNumeroSMS(id) {
  const r = await call('smsSetPrincipalNumero')({ id })
  return r.data
}

/** Cancela a assinatura do número e libera na Telnyx. */
export async function cancelarNumeroSMS(id) {
  const r = await call('smsCancelarNumero')({ id })
  return r.data
}

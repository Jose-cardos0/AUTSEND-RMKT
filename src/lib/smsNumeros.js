import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const call = (name) => httpsCallable(functions, name)

/** Busca números toll-free (EUA) disponíveis pra compra na Telnyx. */
export async function buscarNumerosSMS() {
  const r = await call('smsBuscarNumeros')()
  return r.data // { numeros: [{ numero, regiao, tipo }] }
}

/** Cria o checkout Stripe embutido (assinatura R$29,90/mês por número). Aceita 1 número ou uma lista. */
export async function criarCheckoutNumeroSMS(numeros) {
  const lista = Array.isArray(numeros) ? numeros : [numeros]
  const r = await call('smsCriarCheckoutNumero')({ numeros: lista })
  return r.data // { clientSecret }
}

/** Lista os números SMS do cliente. */
export async function listarNumerosSMS() {
  const r = await call('smsListarNumeros')()
  return r.data // { numeros: [{ id, numero, status, principal, erro, valorMensal, criadoEm }] }
}

/** Sincroniza o status dos números com a Telnyx (detecta banido/restrito) e devolve a lista atualizada. */
export async function sincronizarNumerosSMS() {
  const r = await call('smsSincronizarNumeros')()
  return r.data // { numeros }
}

/** Define qual número é o principal (usado nos envios). */
export async function setPrincipalNumeroSMS(id) {
  const r = await call('smsSetPrincipalNumero')({ id })
  return r.data
}

/** Cancela a assinatura do número (Stripe) e libera na Telnyx. */
export async function cancelarNumeroSMS(id) {
  const r = await call('smsCancelarNumero')({ id })
  return r.data
}

/** Exclui só o chip: libera na Telnyx e remove do app, sem mexer na assinatura Stripe. */
export async function excluirNumeroSMS(id) {
  const r = await call('smsExcluirNumero')({ id })
  return r.data
}

// ── Provedores Telnyx próprios (BYO / API's) ──

/** Lista os provedores Telnyx próprios do cliente. */
export async function listarProvidersSMS() {
  const r = await call('smsListProviders')()
  return r.data // { provedores: [{ id, nome, from, principal, apiKeyMasked, ... }] }
}

/** Conecta uma conta Telnyx própria (valida a key e puxa os números dele). */
export async function addProviderSMS({ apiKey, messagingProfileId, nome }) {
  const r = await call('smsAddProvider')({ apiKey, messagingProfileId, nome })
  return r.data
}

/** Define qual número (dos puxados) o provedor usa pra enviar. */
export async function setFromProviderSMS(id, from) {
  const r = await call('smsProviderSetFrom')({ id, from })
  return r.data
}

/** Re-puxa os números da conta Telnyx do provedor. */
export async function syncProviderSMS(id) {
  const r = await call('smsProviderSync')({ id })
  return r.data
}

/** Remove um provedor Telnyx próprio. */
export async function deleteProviderSMS(id) {
  const r = await call('smsDeleteProvider')({ id })
  return r.data
}

/** Define o principal GLOBAL entre número (nossa conta) e provedor (conta do cliente). tipo: 'numero' | 'provider'. */
export async function definirPrincipalSMS(tipo, id) {
  const r = await call('smsDefinirPrincipal')({ tipo, id })
  return r.data
}

// ── SMSDev (SMS Brasil) — contas próprias do cliente (BYO) ──

/** Conecta uma conta SMSDev própria (valida a chave pelo saldo). */
export async function addSmsdevProvider({ apiKey, nome }) {
  const r = await call('smsdevAddProvider')({ apiKey, nome })
  return r.data
}

/** Lista as contas SMSDev próprias (chave mascarada). */
export async function listSmsdevProviders() {
  const r = await call('smsdevListProviders')()
  return r.data // { provedores: [{ id, nome, principal, apiKeyMasked }] }
}

/** Define qual conta SMSDev é a principal nos envios BR. */
export async function setPrincipalSmsdev(id) {
  const r = await call('smsdevSetPrincipal')({ id })
  return r.data
}

/** Remove uma conta SMSDev própria. */
export async function deleteSmsdevProvider(id) {
  const r = await call('smsdevDeleteProvider')({ id })
  return r.data
}

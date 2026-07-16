import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const call = (name) => httpsCallable(functions, name)

/** Stats do perfil: e-mails e SMS usados no mês, limites do plano e saldo de créditos. */
export async function getPerfilStats() {
  const r = await call('getPerfilStats')()
  return r.data // { plano, isAdmin, nome, email, fotoURL, emailsUsados, emailsLimite, smsUsados, smsLimite, smsCreditos }
}

/** Salva a foto de perfil (data URL pequeno). */
export async function salvarFotoPerfil(dataUrl) {
  const r = await call('salvarFotoPerfil')({ dataUrl })
  return r.data // { ok, fotoURL }
}

/** Pacotes de recarga de crédito SMS (só EUA). */
export const PACOTES_CREDITO = [
  { key: '500', quantidade: 500, valor: 'R$ 29,90' },
  { key: '1000', quantidade: 1000, valor: 'R$ 49,90', destaque: true },
  { key: '2500', quantidade: 2500, valor: 'R$ 99,90' },
]

/** Pacotes de recarga de crédito de e-mail. */
export const PACOTES_CREDITO_EMAIL = [
  { key: '5000', quantidade: 5000, valor: 'R$ 49,90' },
  { key: '10000', quantidade: 10000, valor: 'R$ 89,90', destaque: true },
  { key: '25000', quantidade: 25000, valor: 'R$ 199,00' },
]

/** Cria o checkout Stripe (pagamento único) pra recarregar créditos de SMS e devolve a URL. */
export async function criarCheckoutCreditoSMS(pacote) {
  const r = await call('smsCriarCheckoutCredito')({ pacote })
  return r.data // { url }
}

/** Cria o checkout Stripe (pagamento único) pra recarregar créditos de e-mail e devolve a URL. */
export async function criarCheckoutCreditoEmail(pacote) {
  const r = await call('emailCriarCheckoutCredito')({ pacote })
  return r.data // { url }
}

/** Pacotes de minutos de Ligação IA (chave = minutos). */
export const PACOTES_CREDITO_CALL = [
  { key: '30', minutos: 30, valor: 'R$ 44,90' },
  { key: '60', minutos: 60, valor: 'R$ 84,90', destaque: true },
  { key: '120', minutos: 120, valor: 'R$ 159,90' },
]

/** Cria o checkout Stripe (pagamento único) pra comprar minutos de Ligação IA e devolve a URL. */
export async function criarCheckoutCreditoCall(pacote) {
  const r = await call('callCriarCheckoutCredito')({ pacote })
  return r.data // { url }
}

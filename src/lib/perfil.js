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
  { key: '500', quantidade: 500, valor: 'R$ 49,00' },
  { key: '1000', quantidade: 1000, valor: 'R$ 89,00', destaque: true },
  { key: '2500', quantidade: 2500, valor: 'R$ 199,00' },
]

/** Pacotes de recarga de SMS BRASIL (SMSDev). */
export const PACOTES_CREDITO_SMS_BR = [
  { key: '500', quantidade: 500, valor: 'R$ 119,00' },
  { key: '1000', quantidade: 1000, valor: 'R$ 199,00', destaque: true },
  { key: '2500', quantidade: 2500, valor: 'R$ 449,00' },
]

/** Cria o checkout Stripe embutido pra recarregar créditos de SMS Brasil (SMSDev). */
export async function criarCheckoutCreditoSmsBr(pacote) {
  const r = await call('smsBrCriarCheckoutCredito')({ pacote })
  return r.data // { clientSecret }
}

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

export const PRECO_INSTANCIA = 'R$ 29,90/mês'

/** Cria o checkout Stripe embutido (assinatura R$29,90/mês por instância) pra comprar instâncias de WhatsApp. */
export async function criarCheckoutInstancia(quantidade) {
  const r = await call('instanciaCriarCheckout')({ quantidade })
  return r.data // { clientSecret }
}

/** Pacotes de conversa do Vendedor IA (pagamento único). Crédito consumido antes da cota do plano. */
export const PACOTES_CREDITO_CONVERSA = [
  { key: '100', quantidade: 100, valor: 'R$ 79,00' },
  { key: '300', quantidade: 300, valor: 'R$ 199,00', destaque: true },
  { key: '1000', quantidade: 1000, valor: 'R$ 590,00' },
]

/** Cria o checkout Stripe (pagamento único) pra comprar um pacote de conversas do Vendedor IA. */
export async function criarCheckoutCreditoConversa(pacote) {
  const r = await call('conversaCriarCheckoutCredito')({ pacote })
  return r.data // { clientSecret }
}

export const PRECO_VENDEDOR = 'R$ 45,00/mês'

/** Cria o checkout Stripe embutido (assinatura R$45/mês por vendedor) pra comprar Vendedor(es) IA. +1 slot de vendedor cada. */
export async function criarCheckoutVendedor(quantidade) {
  const r = await call('vendedorCriarCheckout')({ quantidade })
  return r.data // { clientSecret }
}

/** Cria o checkout Stripe embutido de PLANO (assinatura). Funciona logado (upgrade) ou deslogado (landing). */
export async function criarCheckoutPlano(plano) {
  const r = await call('planoCriarCheckout')({ plano })
  return r.data // { clientSecret }
}

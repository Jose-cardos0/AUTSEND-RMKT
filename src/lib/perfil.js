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

/** Cria o checkout Stripe (pagamento único) pra recarregar créditos e devolve a URL. */
export async function criarCheckoutCreditoSMS(pacote) {
  const r = await call('smsCriarCheckoutCredito')({ pacote })
  return r.data // { url }
}

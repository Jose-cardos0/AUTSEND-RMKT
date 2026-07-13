import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const call = (name) => httpsCallable(functions, name)

export async function addDomain(name, region) {
  const r = await call('emailAddDomain')({ name, region })
  return r.data
}
export async function listDomains() {
  const r = await call('emailListDomains')()
  return r.data // { dominios, configurado }
}
export async function verifyDomain(id) {
  const r = await call('emailVerifyDomain')({ id })
  return r.data
}
export async function deleteDomain(id) {
  const r = await call('emailDeleteDomain')({ id })
  return r.data
}
export async function saveDomainSenders(id, senders) {
  const r = await call('emailSaveDomainSenders')({ id, senders })
  return r.data
}

/** Rótulo + cor do status do domínio (padrão de UI do app). */
export const DOMAIN_STATUS = {
  verified: { label: 'Verificado', cls: 'bg-emerald-100 text-emerald-700' },
  pending: { label: 'Aguardando DNS', cls: 'bg-amber-100 text-amber-700' },
  not_started: { label: 'Não iniciado', cls: 'bg-stone-100 text-stone-600' },
  temporary_failure: { label: 'Tentando de novo', cls: 'bg-amber-100 text-amber-700' },
  failure: { label: 'Falhou', cls: 'bg-rose-100 text-rose-700' },
  failed: { label: 'Falhou', cls: 'bg-rose-100 text-rose-700' },
}
export const statusDominio = (s) => DOMAIN_STATUS[s] || DOMAIN_STATUS.pending

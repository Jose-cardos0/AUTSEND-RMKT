import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// Único e-mail com acesso ao admin (o dono/dev). A segurança real é no backend.
export const ADMIN_EMAIL = 'josedeveloperjs@gmail.com'
export const isAdmin = (user) => (user?.email || '').toLowerCase() === ADMIN_EMAIL

export async function adminListClientes() {
  const fn = httpsCallable(functions, 'adminListClientes')
  return (await fn()).data
}
export async function adminGetClienteDetalhe(uid) {
  const fn = httpsCallable(functions, 'adminGetClienteDetalhe')
  return (await fn({ uid })).data
}
export async function adminUpdateCliente(uid, patch) {
  const fn = httpsCallable(functions, 'adminUpdateCliente')
  return (await fn({ uid, patch })).data
}
export async function adminSetKillSwitch(pausar) {
  const fn = httpsCallable(functions, 'adminSetKillSwitch')
  return (await fn({ pausar })).data
}

// ── 2FA ──
const call = (name) => httpsCallable(functions, name)
export async function admin2faStatus() { return (await call('admin2faStatus')()).data }
export async function admin2faSetup() { return (await call('admin2faSetup')()).data }
export async function admin2faConfirm(code) { return (await call('admin2faConfirm')({ code })).data }
export async function admin2faVerify(code) { return (await call('admin2faVerify')({ code })).data }
export async function admin2faDisable(code) { return (await call('admin2faDisable')({ code })).data }

export async function adminImpersonar(uid) { return (await call('adminImpersonar')({ uid })).data }
export async function getMeuPlano() { return (await call('getMeuPlano')()).data }

// ── Config Kiwify (onboarding) ──
export async function adminGetKiwifyConfig() { return (await call('adminGetKiwifyConfig')()).data }
export async function adminSetKiwifyConfig(data) { return (await call('adminSetKiwifyConfig')(data)).data }

// Saúde do cliente pelo % de reclamação/bounce (limiares dos provedores).
export function healthDoCliente(c) {
  const comp = Number(c.complaintRate) || 0
  const bounce = Number(c.bounceRate) || 0
  if (comp >= 0.1 || bounce >= 5) return 'red'
  if (comp >= 0.05 || bounce >= 3) return 'yellow'
  return 'green'
}

export const STATUS_INFO = {
  pending: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-700' },
  paused: { label: 'Pausado', cls: 'bg-orange-100 text-orange-700' },
  banned: { label: 'Banido', cls: 'bg-rose-100 text-rose-700' },
}

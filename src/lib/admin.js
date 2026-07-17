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
export async function adminSetInstanciaBloqueada(uid, instanceId, bloqueada) { return (await call('adminSetInstanciaBloqueada')({ uid, instanceId, bloqueada })).data }
export async function getMeuPlano() { return (await call('getMeuPlano')()).data }

// ── Config Kiwify (onboarding) ──
export async function adminGetKiwifyConfig() { return (await call('adminGetKiwifyConfig')()).data }
export async function adminSetKiwifyConfig(data) { return (await call('adminSetKiwifyConfig')(data)).data }
export async function adminStripePlanos() { return (await call('adminStripePlanos')()).data }
export async function adminReembolsarCliente(uid) { return (await call('adminReembolsarCliente')({ uid })).data }
// Setor de risco: 'play' (retoma e assume o risco), 'pausar' (manual), 'auto' (volta ao automático).
export async function adminSetRiscoConta(uid, acao) { return (await call('adminSetRiscoConta')({ uid, acao })).data }
export async function adminGetClienteCredito(uid) { return (await call('adminGetClienteCredito')({ uid })).data }
export async function adminGetClienteGastos(uid) { return (await call('adminGetClienteGastos')({ uid })).data }
export async function adminGetClienteConectados(uid) { return (await call('adminGetClienteConectados')({ uid })).data }
export async function adminResetTermos(uid) { return (await call('adminResetTermos')({ uid })).data }
export async function adminGetSecurityReport() { return (await call('adminGetSecurityReport')()).data }
export async function adminRunSecurityScan() { return (await call('adminRunSecurityScan')()).data }
export async function adminMarkSecuritySeen() { return (await call('adminMarkSecuritySeen')()).data }

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

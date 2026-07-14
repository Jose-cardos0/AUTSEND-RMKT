// Planos do app (mensal, cobrado via Kiwify). Régua de limites + features por plano.
// O admin pode sobrescrever por cliente via "overrides".

export const PLANOS = {
  free: {
    nome: 'Free',
    // Free tem o mínimo pra rodar automações de compra aprovada: 1 template, 1 grupo de produto com 1 produto.
    // Free NÃO usa domínios (só API's/Resend próprio); domínios são capacidade da conta Resend da plataforma.
    limites: { trackers: 1, instancias: 0, emailsMes: 50, smsMes: 0, dominios: 0, templates: 1, gruposProduto: 1, produtosPorGrupo: 1 },
    features: {
      bancoLeads: false, produtos: true, checkouts: false, templates: false,
      waIntegracoes: false, waAutomacoes: false, waRemarketing: false, waGrupos: false, waDisparos: false, waFunil: false, waMetricas: false,
      emailIntegracoes: true, emailConstrutor: true, emailAutomacoes: true, emailAutomacoesSoAprovada: true, emailDisparos: false, emailFunil: false, emailMetricas: false,
      smsDisparos: false,
    },
  },
  inicial: {
    nome: 'Inicial',
    // Tudo do Free + WhatsApp + 500 e-mails/mês. Sem domínios (só API's).
    limites: { trackers: 2, instancias: 1, emailsMes: 500, smsMes: 300, dominios: 0 },
    features: {
      bancoLeads: true, produtos: true, checkouts: true, templates: true,
      waIntegracoes: true, waAutomacoes: true, waRemarketing: true, waGrupos: true, waDisparos: true, waFunil: true, waMetricas: true,
      emailIntegracoes: true, emailConstrutor: true, emailAutomacoes: true, emailAutomacoesSoAprovada: false, emailDisparos: true, emailFunil: true, emailMetricas: true,
      smsDisparos: true,
    },
  },
  padrao: {
    nome: 'Padrão',
    limites: { trackers: 10, instancias: 2, emailsMes: 3000, smsMes: 1000, dominios: 1 },
    features: {
      bancoLeads: true, produtos: true, checkouts: true, templates: true,
      waIntegracoes: true, waAutomacoes: true, waRemarketing: true, waGrupos: true, waDisparos: true, waFunil: true, waMetricas: true,
      emailIntegracoes: true, emailConstrutor: true, emailAutomacoes: true, emailAutomacoesSoAprovada: false, emailDisparos: true, emailFunil: true, emailMetricas: true,
      smsDisparos: true,
    },
  },
  pro: {
    nome: 'Pro',
    limites: { trackers: 20, instancias: 4, emailsMes: 10000, smsMes: 2000, dominios: 2 },
    features: {
      bancoLeads: true, produtos: true, checkouts: true, templates: true,
      waIntegracoes: true, waAutomacoes: true, waRemarketing: true, waGrupos: true, waDisparos: true, waFunil: true, waMetricas: true,
      emailIntegracoes: true, emailConstrutor: true, emailAutomacoes: true, emailAutomacoesSoAprovada: false, emailDisparos: true, emailFunil: true, emailMetricas: true,
      smsDisparos: true,
    },
  },
}

export const PLANO_ORDEM = ['free', 'inicial', 'padrao', 'pro']
export const PLANO_CHECKOUT = {
  inicial: 'https://donate.stripe.com/3cI3cw1FZ2gu8mTfmQ6Zy00',
  padrao: 'https://donate.stripe.com/4gMeVe84naN0fPldeI6Zy01',
  pro: 'https://donate.stripe.com/fZu8wQ98r8ESgTp7Uo6Zy02',
}

// Rótulos das features (pro admin editar)
export const FEATURE_LABELS = {
  bancoLeads: 'Banco de Leads', produtos: 'Produtos', checkouts: 'Checkouts', templates: 'Templates',
  waIntegracoes: 'WA · Integrações', waAutomacoes: 'WA · Automações', waRemarketing: 'WA · Remarketing', waGrupos: 'WA · Grupos', waDisparos: 'WA · Disparos', waFunil: 'WA · Funil', waMetricas: 'WA · Métricas',
  emailIntegracoes: 'E-mail · Integrações', emailConstrutor: 'E-mail · Construtor', emailAutomacoes: 'E-mail · Automações', emailDisparos: 'E-mail · Disparos', emailFunil: 'E-mail · Funil', emailMetricas: 'E-mail · Métricas',
  smsDisparos: 'SMS · Disparos',
}
export const LIMITE_LABELS = { trackers: 'Trackers', instancias: 'Instâncias WhatsApp', emailsMes: 'E-mails/mês', smsMes: 'SMS/mês', dominios: 'Domínios de e-mail' }

// Rota → feature que a libera (usado pra esconder no menu / bloquear página).
export const ROTA_FEATURE = {
  '/banco-leads': 'bancoLeads', '/produtos': 'produtos', '/checkouts': 'checkouts', '/templates': 'templates',
  '/integracoes': 'waIntegracoes', '/automacoes': 'waAutomacoes', '/remarketing': 'waRemarketing', '/remarketing-grupos': 'waGrupos', '/enviar-mensagem': 'waDisparos', '/funil': 'waFunil', '/metricas': 'waMetricas',
  '/email/integracoes': 'emailIntegracoes', '/email/construtor': 'emailConstrutor', '/email/automacoes': 'emailAutomacoes', '/email/disparos': 'emailDisparos', '/email/funil': 'emailFunil', '/email/metricas': 'emailMetricas',
  '/sms/disparos': 'smsDisparos', '/sms/funil': 'smsDisparos', '/sms/automacoes': 'smsDisparos', '/sms/remarketing': 'smsDisparos', '/sms/metricas': 'smsDisparos',
}

/** Limites + features efetivos do tenant (plano + overrides do admin). */
export function planoEfetivo(tenant) {
  const plano = tenant?.plano && PLANOS[tenant.plano] ? tenant.plano : 'free'
  const base = PLANOS[plano]
  const ov = tenant?.overrides || {}
  return {
    plano,
    nome: base.nome,
    limites: { ...base.limites, ...(ov.limites || {}) },
    features: { ...base.features, ...(ov.features || {}) },
  }
}

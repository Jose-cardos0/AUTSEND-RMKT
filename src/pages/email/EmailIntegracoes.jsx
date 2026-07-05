import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getEmailConfig, saveEmailConfig } from '../../lib/firestore'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Mail, Globe, KeyRound, Eye, EyeOff, Save, Send, Loader2, Check, ExternalLink, Webhook, Copy, BarChart3, ChevronDown } from 'lucide-react'

/** Seção recolhível (accordion). */
function Secao({ title, icon: Icon, open, onToggle, children }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3 hover:bg-surface-50 transition">
        <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
          {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
          <span className="truncate">{title}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 sm:px-5 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

export default function EmailIntegracoes() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [conectado, setConectado] = useState(false)

  const [copiedHook, setCopiedHook] = useState(false)
  const [secoes, setSecoes] = useState({ provedor: false, testar: false, rastreamento: false })
  const toggleSecao = (k) => setSecoes((s) => ({ ...s, [k]: !s[k] }))

  const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

  const hookUrl = `https://us-central1-afiliadocdnx.cloudfunctions.net/resendWebhook?userId=${user?.uid || ''}`
  const copiarHook = () => {
    navigator.clipboard.writeText(hookUrl)
    setCopiedHook(true)
    setTimeout(() => setCopiedHook(false), 2000)
  }

  useEffect(() => {
    if (!user?.uid) return
    getEmailConfig(user.uid)
      .then((cfg) => {
        if (cfg) {
          setApiKey(cfg.apiKey || '')
          setFromEmail(cfg.fromEmail || '')
          setFromName(cfg.fromName || '')
          setConectado(!!(cfg.apiKey && cfg.fromEmail))
          if (!testEmail && cfg.fromEmail) setTestEmail(cfg.fromEmail)
        }
      })
      .finally(() => setLoading(false))
  }, [user?.uid])

  const handleSalvar = async () => {
    if (!user?.uid) return
    if (!apiKey.trim() || !fromEmail.trim()) {
      toast.error('Preencha a API key do Resend e o e-mail remetente.')
      return
    }
    if (!emailValido(fromEmail)) {
      toast.error('O remetente precisa ser um e-mail completo, ex.: contato@survival-shield.online (não só o domínio).')
      return
    }
    setSalvando(true)
    try {
      await saveEmailConfig(user.uid, {
        apiKey: apiKey.trim(),
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
      })
      setConectado(true)
      toast.success('Configuração de e-mail salva.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const handleTestar = async () => {
    const to = (testEmail || '').trim()
    if (!emailValido(to)) {
      toast.error('Informe um e-mail de destino válido para o teste.')
      return
    }
    setTestando(true)
    try {
      const sendTest = httpsCallable(functions, 'sendTestEmail')
      await sendTest({ to })
      toast.success(`E-mail de teste enviado para ${to}. Confira a caixa de entrada (e o spam).`)
    } catch (err) {
      toast.error(err.message || 'Falha ao enviar o teste. Verifique a API key e o domínio verificado.')
    } finally {
      setTestando(false)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge="E-mail · Conexões"
      title="Integrações de E-mail"
      subtitle="Conecte o Resend e verifique seu domínio. Totalmente separado das integrações de WhatsApp."
      right={
        conectado ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            <Check className="w-4 h-4" /> Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
            Não configurado
          </span>
        )
      }
    >
      <div className="space-y-3">
        <Secao title="Provedor de envio (Resend)" icon={Mail} open={secoes.provedor} onToggle={() => toggleSecao('provedor')}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                <span className="inline-flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> API Key do Resend</span>
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2.5 pr-11 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-stone-600"
                  aria-label={showKey ? 'Ocultar' : 'Mostrar'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Pegue em resend.com → API Keys. Fica guardada só na sua conta e é usada pelo servidor para enviar.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">E-mail remetente</label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="contato@seudominio.com"
                  className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome remetente</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Sua Empresa"
                  className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
            </div>

            <button onClick={handleSalvar} disabled={salvando} className="btn-primary min-h-[44px] touch-manipulation">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar configuração
            </button>
          </div>
        </Secao>

        <Secao title="Testar envio" icon={Send} open={secoes.testar} onToggle={() => toggleSecao('testar')}>
          <div className="space-y-4">
            <p className="text-sm text-stone-500 leading-relaxed">
              Envie um e-mail de teste para confirmar que a chave e o remetente estão funcionando.
            </p>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Enviar teste para</label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="voce@email.com"
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <button
              onClick={handleTestar}
              disabled={testando || !conectado}
              className="btn-secondary min-h-[44px] touch-manipulation"
              title={!conectado ? 'Salve a configuração primeiro' : 'Enviar e-mail de teste'}
            >
              {testando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar e-mail de teste
            </button>

            <div className="rounded-xl border border-surface-200 bg-surface-50/60 p-3 space-y-2">
              <p className="text-sm font-medium text-stone-700 inline-flex items-center gap-1.5"><Globe className="w-4 h-4" /> Domínio verificado</p>
              <p className="text-xs text-stone-500 leading-relaxed">
                Para não cair em spam, verifique seu domínio no Resend (registros SPF/DKIM) e use um remetente
                <strong> desse domínio</strong>. Enquanto não verificar, só dá para enviar para o seu próprio e-mail de teste.
              </p>
              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline"
              >
                Verificar domínio no Resend <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </Secao>

        <Secao title="Rastreamento — aberturas & cliques" icon={Webhook} open={secoes.rastreamento} onToggle={() => toggleSecao('rastreamento')}>
        <p className="text-sm text-stone-500 leading-relaxed">
          Para saber quem <strong>abriu</strong> e <strong>clicou</strong> nos links, ligue o rastreamento no Resend e cadastre a URL abaixo.
        </p>
        <ol className="text-sm text-stone-600 space-y-1.5 list-decimal pl-5">
          <li>No Resend → <strong>Domains</strong> → seu domínio → ative <strong>Open tracking</strong> e <strong>Click tracking</strong>.</li>
          <li>No Resend → <strong>Webhooks</strong> → <strong>Add Webhook</strong> → cole a URL abaixo e marque os eventos <code className="bg-surface-100 px-1 rounded text-xs">email.opened</code> e <code className="bg-surface-100 px-1 rounded text-xs">email.clicked</code> (pode marcar delivered/bounced também).</li>
        </ol>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <code className="flex-1 min-w-0 text-xs text-stone-600 break-all bg-surface-50 border border-surface-200 rounded-lg px-3 py-2.5">{hookUrl}</code>
          <button onClick={copiarHook} className="btn-secondary text-sm min-h-[44px] px-4 shrink-0">
            {copiedHook ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            {copiedHook ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="text-xs text-stone-400 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" /> Depois disso, as aberturas e cliques aparecem no histórico em <strong>Disparos</strong>.
        </p>
        </Secao>
      </div>
    </PageShell>
  )
}

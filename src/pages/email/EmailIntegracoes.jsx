import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getEmailConfig, getEmailProviders, saveEmailProvider, deleteEmailProvider } from '../../lib/firestore'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Mail, Globe, KeyRound, Eye, EyeOff, Save, Send, Loader2, Check, ExternalLink, Webhook, Copy, BarChart3, ChevronDown, Plus, Trash2, UserPlus, X, Server } from 'lucide-react'

const FN_BASE = 'https://us-central1-afiliadocdnx.cloudfunctions.net'
const genId = () => 'rem_' + Math.random().toString(36).slice(2, 10)
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

/** Cabeçalho de seção recolhível, com botão de ação opcional (ex.: +) ao lado da setinha. */
function Secao({ title, icon: Icon, open, onToggle, action, children }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <div className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0 flex-1 text-left hover:opacity-80">
          {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {action}
          <button type="button" onClick={onToggle} className="p-1 text-stone-400 hover:text-stone-600" aria-label={open ? 'Recolher' : 'Expandir'}>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <div className="px-4 sm:px-5 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

export default function EmailIntegracoes() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState([])
  const [openProv, setOpenProv] = useState({})
  const [showKeyId, setShowKeyId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [delProv, setDelProv] = useState(null)

  const [testando, setTestando] = useState(false)
  const [testEmail, setTestEmail] = useState('')

  const [secoes, setSecoes] = useState({ provedores: true, testar: false, rastreamento: false })
  const toggleSecao = (k) => setSecoes((s) => ({ ...s, [k]: !s[k] }))

  const [hookPopup, setHookPopup] = useState(false)
  const [hookProvId, setHookProvId] = useState(null)
  const [copiedHook, setCopiedHook] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    ;(async () => {
      try {
        let provs = await getEmailProviders(user.uid)
        // Migração: se não há provedores mas existe a config antiga, cria "Provedor 1" a partir dela.
        if (provs.length === 0) {
          const legacy = await getEmailConfig(user.uid)
          if (legacy?.apiKey || legacy?.fromEmail) {
            const rem = legacy.fromEmail ? [{ id: genId(), email: legacy.fromEmail, nome: legacy.fromName || '' }] : []
            const id = await saveEmailProvider(user.uid, null, { nome: 'Provedor 1', apiKey: legacy.apiKey || '', remetentes: rem })
            provs = [{ id, nome: 'Provedor 1', apiKey: legacy.apiKey || '', remetentes: rem }]
          }
        }
        setProviders(provs)
        if (provs[0]) setOpenProv({ [provs[0].id]: true })
        const firstEmail = provs.flatMap((p) => p.remetentes || []).find((r) => r.email)?.email
        if (firstEmail) setTestEmail(firstEmail)
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.uid])

  const conectado = providers.some((p) => p.apiKey && (p.remetentes || []).some((r) => r.email))

  const updateProv = (id, patch) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const updateRem = (id, remId, patch) =>
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, remetentes: (p.remetentes || []).map((r) => (r.id === remId ? { ...r, ...patch } : r)) } : p)))
  const addRem = (id) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, remetentes: [...(p.remetentes || []), { id: genId(), email: '', nome: '' }] } : p)))
  const removeRem = (id, remId) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, remetentes: (p.remetentes || []).filter((r) => r.id !== remId) } : p)))

  const addProvider = async () => {
    if (!user?.uid) return
    const nome = `Provedor ${providers.length + 1}`
    try {
      const id = await saveEmailProvider(user.uid, null, { nome, apiKey: '', remetentes: [] })
      setProviders((ps) => [...ps, { id, nome, apiKey: '', remetentes: [] }])
      setOpenProv((o) => ({ ...o, [id]: true }))
      toast.success(`${nome} adicionado.`)
    } catch (err) {
      toast.error(err.message || 'Erro ao adicionar provedor')
    }
  }

  const salvarProvider = async (p) => {
    if (!user?.uid) return
    const rems = (p.remetentes || []).filter((r) => (r.email || '').trim() || (r.nome || '').trim())
    for (const r of rems) {
      if (!emailValido(r.email)) {
        toast.error(`Remetente inválido: "${r.email || '(vazio)'}". Use um e-mail completo, ex.: contato@seudominio.com`)
        return
      }
    }
    setSavingId(p.id)
    try {
      await saveEmailProvider(user.uid, p.id, { nome: (p.nome || '').trim() || 'Provedor', apiKey: (p.apiKey || '').trim(), remetentes: rems })
      updateProv(p.id, { remetentes: rems })
      toast.success(`${p.nome || 'Provedor'} salvo.`)
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
    } finally {
      setSavingId(null)
    }
  }

  const excluirProvider = async () => {
    if (!user?.uid || !delProv) return
    try {
      await deleteEmailProvider(user.uid, delProv.id)
      setProviders((ps) => ps.filter((p) => p.id !== delProv.id))
      toast.success('Provedor removido.')
    } catch (err) {
      toast.error(err.message || 'Erro ao remover')
    } finally {
      setDelProv(null)
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

  const hookProv = providers.find((p) => p.id === hookProvId) || null
  const hookUrl = hookProv ? `${FN_BASE}/resendWebhook?userId=${user?.uid || ''}&providerId=${hookProv.id}` : ''
  const copiarHook = () => {
    if (!hookUrl) return
    navigator.clipboard.writeText(hookUrl)
    setCopiedHook(true)
    setTimeout(() => setCopiedHook(false), 2000)
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge="E-mail · Conexões"
      title="Integrações de E-mail"
      subtitle="Conecte um ou mais provedores Resend, com quantos remetentes quiser. Totalmente separado do WhatsApp."
      right={
        conectado ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            <Check className="w-4 h-4" /> Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Não configurado</span>
        )
      }
    >
      <div className="space-y-3">
        {/* ───── Provedores de envio ───── */}
        <Secao
          title="Provedores de envio (Resend)"
          icon={Mail}
          open={secoes.provedores}
          onToggle={() => toggleSecao('provedores')}
          action={
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); addProvider() }}
              className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 flex items-center justify-center transition"
              title="Adicionar provedor"
            >
              <Plus className="w-4 h-4" />
            </button>
          }
        >
          {providers.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-stone-500 mb-3">Nenhum provedor ainda. Adicione o primeiro para começar a enviar.</p>
              <button onClick={addProvider} className="btn-primary min-h-[44px] mx-auto"><Plus className="w-4 h-4" /> Adicionar provedor</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {providers.map((p) => {
                const aberto = !!openProv[p.id]
                const nRem = (p.remetentes || []).filter((r) => r.email).length
                return (
                  <div key={p.id} className="rounded-xl border border-surface-200 bg-surface-50/40 overflow-hidden">
                    {/* Cabeçalho do provedor */}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button onClick={() => setOpenProv((o) => ({ ...o, [p.id]: !o[p.id] }))} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><Server className="w-4 h-4" /></span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-stone-800 truncate">{p.nome || 'Provedor'}</span>
                          <span className="block text-[11px] text-stone-400">{nRem} remetente(s){p.apiKey ? '' : ' · sem API key'}</span>
                        </span>
                      </button>
                      <button onClick={() => setDelProv(p)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Remover provedor"><Trash2 className="w-4 h-4" /></button>
                      <button onClick={() => setOpenProv((o) => ({ ...o, [p.id]: !o[p.id] }))} className="p-1 text-stone-400 shrink-0"><ChevronDown className={`w-4 h-4 transition-transform ${aberto ? 'rotate-180' : ''}`} /></button>
                    </div>

                    {aberto && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-surface-200">
                        {/* Nome do provedor */}
                        <div>
                          <label className="block text-xs font-medium text-stone-600 mb-1">Nome do provedor (só pra você identificar)</label>
                          <input value={p.nome || ''} onChange={(e) => updateProv(p.id, { nome: e.target.value })} placeholder="Ex.: Conta Principal, Domínio Saúde…" className="w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 bg-white text-sm" />
                        </div>

                        {/* API key */}
                        <div>
                          <label className="block text-xs font-medium text-stone-600 mb-1"><span className="inline-flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> API Key do Resend</span></label>
                          <div className="relative">
                            <input
                              type={showKeyId === p.id ? 'text' : 'password'}
                              value={p.apiKey || ''}
                              onChange={(e) => updateProv(p.id, { apiKey: e.target.value })}
                              placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                              className="w-full px-3 py-2.5 pr-11 min-h-[42px] rounded-xl border border-surface-200 bg-white text-sm font-mono"
                            />
                            <button type="button" onClick={() => setShowKeyId((id) => (id === p.id ? null : p.id))} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-stone-600">
                              {showKeyId === p.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Remetentes */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-stone-600">Remetentes</label>
                            <button onClick={() => addRem(p.id)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg px-2 py-1"><UserPlus className="w-3.5 h-3.5" /> Adicionar remetente</button>
                          </div>
                          {(p.remetentes || []).length === 0 ? (
                            <p className="text-xs text-stone-400 py-2">Nenhum remetente. Clique em "Adicionar remetente".</p>
                          ) : (
                            <div className="space-y-2">
                              {(p.remetentes || []).map((r) => (
                                <div key={r.id} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center rounded-xl border border-surface-200 bg-white p-2">
                                  <input value={r.email || ''} onChange={(e) => updateRem(p.id, r.id, { email: e.target.value })} placeholder="noreply@seudominio.com" className="w-full sm:flex-1 px-2.5 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm" />
                                  <input value={r.nome || ''} onChange={(e) => updateRem(p.id, r.id, { nome: e.target.value })} placeholder="Nome remetente" className="w-full sm:flex-1 px-2.5 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm" />
                                  <button onClick={() => removeRem(p.id, r.id)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0 self-end sm:self-auto" title="Remover remetente"><X className="w-4 h-4" /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <button onClick={() => salvarProvider(p)} disabled={savingId === p.id} className="btn-primary min-h-[42px] text-sm">
                          {savingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar provedor
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-stone-400">A API key fica guardada só na sua conta e é usada pelo servidor pra enviar. Pegue em resend.com → API Keys.</p>
        </Secao>

        {/* ───── Testar envio ───── */}
        <Secao title="Testar envio" icon={Send} open={secoes.testar} onToggle={() => toggleSecao('testar')}>
          <p className="text-sm text-stone-500 leading-relaxed">Envia um e-mail de teste com o remetente padrão (primeiro provedor) pra confirmar que a chave funciona.</p>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Enviar teste para</label>
            <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="voce@email.com" className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-surface-50/50 text-sm" />
          </div>
          <button onClick={handleTestar} disabled={testando || !conectado} className="btn-secondary min-h-[44px]" title={!conectado ? 'Configure um provedor primeiro' : 'Enviar e-mail de teste'}>
            {testando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar e-mail de teste
          </button>
          <div className="rounded-xl border border-surface-200 bg-surface-50/60 p-3 space-y-2">
            <p className="text-sm font-medium text-stone-700 inline-flex items-center gap-1.5"><Globe className="w-4 h-4" /> Domínio verificado</p>
            <p className="text-xs text-stone-500 leading-relaxed">Pra não cair em spam, verifique cada domínio no Resend (SPF/DKIM) e use remetentes <strong>desse domínio</strong>.</p>
            <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline">Verificar domínio no Resend <ExternalLink className="w-3.5 h-3.5" /></a>
          </div>
        </Secao>

        {/* ───── Rastreamento ───── */}
        <Secao
          title="Rastreamento — aberturas & cliques"
          icon={Webhook}
          open={secoes.rastreamento}
          onToggle={() => toggleSecao('rastreamento')}
          action={
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setHookProvId(providers[0]?.id || null); setHookPopup(true) }}
              className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 flex items-center justify-center transition"
              title="Gerar webhook de um provedor"
            >
              <Plus className="w-4 h-4" />
            </button>
          }
        >
          <p className="text-sm text-stone-500 leading-relaxed">Cada provedor/domínio precisa do <strong>seu próprio webhook</strong> — assim as aberturas e cliques não se misturam nem duplicam. Clique no <strong>+</strong> acima para gerar o webhook de um provedor.</p>
          <ol className="text-sm text-stone-600 space-y-1.5 list-decimal pl-5">
            <li>No Resend → <strong>Domains</strong> → seu domínio → ative <strong>Open tracking</strong> e <strong>Click tracking</strong>.</li>
            <li>No Resend (da conta desse provedor) → <strong>Webhooks</strong> → <strong>Add Webhook</strong> → cole a URL gerada e marque <code className="bg-surface-100 px-1 rounded text-xs">email.opened</code> e <code className="bg-surface-100 px-1 rounded text-xs">email.clicked</code>.</li>
          </ol>
          {providers.length > 0 && (
            <div className="space-y-2">
              {providers.map((p) => (
                <button key={p.id} onClick={() => { setHookProvId(p.id); setHookPopup(true) }} className="w-full flex items-center gap-2 rounded-xl border border-surface-200 bg-white hover:bg-surface-50 px-3 py-2.5 text-left transition">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><Webhook className="w-4 h-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-stone-800 truncate">{p.nome || 'Provedor'}</span><span className="block text-[11px] text-stone-400">Ver URL do webhook</span></span>
                  <ExternalLink className="w-4 h-4 text-stone-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-stone-400 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Depois disso, aberturas e cliques aparecem em <strong>Métricas</strong>.</p>
        </Secao>
      </div>

      {/* ───── Popup: webhook de um provedor ───── */}
      {hookPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setHookPopup(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Webhook className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Webhook de rastreamento</h3>
                <p className="text-xs text-stone-500">Escolha o provedor. Cada um tem uma URL própria.</p>
              </div>
              <button onClick={() => setHookPopup(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {providers.length === 0 ? (
              <p className="text-sm text-stone-500 text-center py-4">Adicione um provedor primeiro.</p>
            ) : (
              <>
                {/* Tiles de provedores (nada de select) */}
                <div className="grid grid-cols-2 gap-2">
                  {providers.map((p) => {
                    const sel = hookProvId === p.id
                    return (
                      <button
                        key={p.id}
                        onClick={() => setHookProvId(p.id)}
                        className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 bg-white hover:border-primary-200'}`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${sel ? 'bg-primary-500 text-white' : 'bg-surface-100 text-stone-500'}`}><Server className="w-4 h-4" /></span>
                        <span className="min-w-0"><span className="block text-sm font-medium text-stone-800 truncate">{p.nome || 'Provedor'}</span><span className="block text-[11px] text-stone-400">{(p.remetentes || []).filter((r) => r.email).length} remetente(s)</span></span>
                        {sel && <Check className="w-4 h-4 text-primary-600 ml-auto shrink-0" />}
                      </button>
                    )
                  })}
                </div>

                {hookProv && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-stone-600">URL do webhook para <strong>{hookProv.nome}</strong></label>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <code className="flex-1 min-w-0 text-xs text-stone-600 break-all bg-surface-50 border border-surface-200 rounded-lg px-3 py-2.5">{hookUrl}</code>
                      <button onClick={copiarHook} className="btn-primary text-sm min-h-[44px] px-4 shrink-0">
                        {copiedHook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copiedHook ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-400">Cole essa URL nos Webhooks da conta Resend <strong>desse provedor</strong> (a conta cuja API key você colou nele).</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ───── Popup: confirmar exclusão de provedor ───── */}
      {delProv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDelProv(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 shrink-0"><Trash2 className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Remover provedor</h3>
                <p className="text-xs text-stone-500">Remover <strong>{delProv.nome}</strong> e seus remetentes?</p>
              </div>
            </div>
            <p className="text-xs text-stone-500">Automações/disparos/funis que usavam um remetente deste provedor voltam a usar o remetente padrão. Isso não pode ser desfeito.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelProv(null)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={excluirProvider} className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Remover</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

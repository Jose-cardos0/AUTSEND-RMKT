import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import { getEmailConfig, getEmailProviders, saveEmailProvider, deleteEmailProvider } from '../../lib/firestore'
import { addDomain, listDomains, verifyDomain, deleteDomain, saveDomainSenders, statusDominio } from '../../lib/emailDomains'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { useConfirm } from '../../components/ConfirmDialog'
import { usePlano } from '../../lib/PlanoContext'
import EmojiPicker from '../../components/EmojiPicker'
import resendLogo from '../../assets/resendlogo.png'
import ChavesPicker from '../../components/ChavesPicker'
import { Mail, Globe, KeyRound, Eye, EyeOff, Save, Send, Loader2, Check, ExternalLink, Webhook, Copy, BarChart3, ChevronDown, Plus, Trash2, UserPlus, X, Server, BadgeCheck } from 'lucide-react'

const FN_BASE = 'https://us-central1-afiliadocdnx.cloudfunctions.net'
const genId = () => 'rem_' + Math.random().toString(36).slice(2, 10)
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

/** Cabeçalho de seção recolhível, com botão de ação opcional (ex.: +) ao lado da setinha. */
function Secao({ title, icon: Icon, iconImg, open, onToggle, action, children }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden">
      <div className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0 flex-1 text-left hover:opacity-80">
          {iconImg ? <img src={iconImg} alt="" className="h-5 w-auto object-contain shrink-0" /> : Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
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
  const confirm = useConfirm()
  const { limiteDe } = usePlano()
  const maxDominios = limiteDe('dominios')
  const podeDominios = maxDominios > 0 // Free = 0 → só usa API's
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState([])
  // Domínios (Fase A · conta compartilhada)
  const [dominios, setDominios] = useState([])
  const [carregandoDom, setCarregandoDom] = useState(true)
  const [domConfigurado, setDomConfigurado] = useState(true)
  const [novoDom, setNovoDom] = useState('')
  const [criandoDom, setCriandoDom] = useState(false)
  const [verificandoId, setVerificandoId] = useState(null)
  const [openDom, setOpenDom] = useState({})
  const [copiado, setCopiado] = useState('')
  const [dnsOpen, setDnsOpen] = useState({})
  const [salvandoSenders, setSalvandoSenders] = useState('')
  // Abas + fluxo de adicionar
  const [tab, setTab] = useState('dominios') // 'dominios' | 'apis'
  const [addPopup, setAddPopup] = useState(false)
  const [showAddDom, setShowAddDom] = useState(false)
  const [showAddProv, setShowAddProv] = useState(false)
  const [novoProvNome, setNovoProvNome] = useState('')
  const [novoProvKey, setNovoProvKey] = useState('')
  const [criandoProv, setCriandoProv] = useState(false)
  const [openProv, setOpenProv] = useState({})
  const [showKeyId, setShowKeyId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [delProv, setDelProv] = useState(null)

  const [testando, setTestando] = useState(false)
  const [testEmail, setTestEmail] = useState('')

  const [secoes, setSecoes] = useState({ dominios: false, provedores: false, testar: false, rastreamento: false })
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
        const firstEmail = provs.flatMap((p) => p.remetentes || []).find((r) => r.email)?.email
        if (firstEmail) setTestEmail(firstEmail)
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.uid])

  // ───── Domínios ─────
  const carregarDominios = async () => {
    setCarregandoDom(true)
    try { const r = await listDomains(); setDominios(r.dominios || []); setDomConfigurado(!!r.configurado) } catch (_) { /* ignore */ } finally { setCarregandoDom(false) }
  }
  useEffect(() => { if (user?.uid) carregarDominios() }, [user?.uid])
  // Free não usa domínios: força a aba API's e esconde a de Domínios.
  useEffect(() => { if (!podeDominios) setTab('apis') }, [podeDominios])

  const updateDom = (id, patch) => setDominios((ds) => ds.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const criarDominio = async () => {
    if (dominios.length >= maxDominios) { toast.error(`Seu plano permite ${maxDominios} domínio(s) conectado(s).`); return }
    const nome = novoDom.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!nome) { toast.error('Informe um domínio (ex.: mail.sualoja.com).'); return }
    setCriandoDom(true)
    try {
      const d = await addDomain(nome)
      setNovoDom('')
      setShowAddDom(false)
      await carregarDominios()
      setOpenDom((o) => ({ ...o, [d.id]: true }))
      toast.success('Domínio adicionado. Configure os registros DNS abaixo e clique em Verificar.')
    } catch (err) { toast.error(err.message || 'Erro ao adicionar domínio') } finally { setCriandoDom(false) }
  }

  const verificar = async (dom) => {
    setVerificandoId(dom.id)
    try {
      const r = await verifyDomain(dom.id)
      updateDom(dom.id, { status: r.status, records: r.records })
      if (r.status === 'verified') toast.success('Domínio verificado! 🎉 Já pode criar remetentes.')
      else toast('Ainda não verificado. O DNS pode levar de minutos a algumas horas para propagar. Vamos rechecar sozinhos a cada 5 min.')
    } catch (err) { toast.error(err.message || 'Erro ao verificar') } finally { setVerificandoId(null) }
  }

  // Recheque automático a cada 5 min enquanto houver domínio pendente (sem o user precisar clicar).
  useEffect(() => {
    const pendentes = dominios.filter((d) => d.status !== 'verified')
    if (pendentes.length === 0) return
    const iv = setInterval(async () => {
      for (const d of pendentes) {
        try {
          const r = await verifyDomain(d.id)
          updateDom(d.id, { status: r.status, records: r.records })
          if (r.status === 'verified') toast.success(`Domínio ${d.name} verificado! 🎉`)
        } catch (_) { /* silencioso */ }
      }
    }, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [dominios])

  const excluirDominio = async (dom) => {
    if (!(await confirm({ title: `Remover ${dom.name}?`, message: 'O domínio será desconectado. Você precisará adicioná-lo de novo para voltar a enviar por ele.', confirmLabel: 'Remover' }))) return
    try { await deleteDomain(dom.id); setDominios((ds) => ds.filter((x) => x.id !== dom.id)); toast.success('Domínio removido.') } catch (err) { toast.error(err.message || 'Erro ao remover') }
  }

  const addSender = (dom) => updateDom(dom.id, { senders: [...(dom.senders || []), { id: genId(), email: '', nome: '' }] })
  const removeSender = (dom, sid) => updateDom(dom.id, { senders: (dom.senders || []).filter((s) => s.id !== sid) })
  const updateSender = (dom, sid, patch) => updateDom(dom.id, { senders: (dom.senders || []).map((s) => (s.id === sid ? { ...s, ...patch } : s)) })
  const appendNome = (dom, s, txt) => updateSender(dom, s.id, { nome: (s.nome || '') + txt })
  // DNS visível: pendente = aberto por padrão; verificado = minimizado.
  const dnsVisivel = (dom) => dnsOpen[dom.id] ?? (dom.status !== 'verified')
  const salvarSenders = async (dom) => {
    const bad = (dom.senders || []).find((s) => (s.email || '').trim() && !s.email.trim().toLowerCase().endsWith(`@${dom.name}`))
    if (bad) { toast.error(`Os remetentes precisam terminar em @${dom.name}`); return }
    setSalvandoSenders(dom.id)
    try {
      const r = await saveDomainSenders(dom.id, (dom.senders || []).filter((s) => (s.email || '').trim()))
      updateDom(dom.id, { senders: r.senders })
      toast.success('Remetentes salvos.')
    } catch (err) { toast.error(err.message || 'Erro ao salvar remetentes') } finally { setSalvandoSenders('') }
  }
  const copiar = (txt, key) => { navigator.clipboard.writeText(txt); setCopiado(key); setTimeout(() => setCopiado(''), 1500) }

  const conectado = providers.some((p) => p.apiKey && (p.remetentes || []).some((r) => r.email)) || dominios.some((d) => d.status === 'verified' && (d.senders || []).length)

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

  // Cria um provedor a partir do modal (nome + API key). Os remetentes são adicionados depois.
  const criarProviderModal = async () => {
    if (!user?.uid) return
    const nome = novoProvNome.trim() || `Provedor ${providers.length + 1}`
    setCriandoProv(true)
    try {
      const key = novoProvKey.trim()
      const id = await saveEmailProvider(user.uid, null, { nome, apiKey: key, remetentes: [] })
      setProviders((ps) => [...ps, { id, nome, apiKey: key, remetentes: [] }])
      setOpenProv((o) => ({ ...o, [id]: true }))
      setShowAddProv(false); setNovoProvNome(''); setNovoProvKey('')
      toast.success(`${nome} adicionado. Agora adicione os remetentes.`)
    } catch (err) {
      toast.error(err.message || 'Erro ao adicionar provedor')
    } finally {
      setCriandoProv(false)
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
      right={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {conectado && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">
              <Check className="w-3.5 h-3.5" /> Conectado
            </span>
          )}
          {podeDominios && (
            <div className="inline-flex rounded-xl bg-surface-100 p-0.5">
              <button onClick={() => setTab('dominios')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'dominios' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                <span className="inline-flex items-center gap-1.5"><Globe className="w-4 h-4" /> Domínios {dominios.length > 0 && <span className="text-[11px] text-stone-400">({dominios.length})</span>}</span>
              </button>
              <button onClick={() => setTab('apis')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'apis' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                <span className="inline-flex items-center gap-1.5"><Server className="w-4 h-4" /> API's {providers.length > 0 && <span className="text-[11px] text-stone-400">({providers.length})</span>}</span>
              </button>
            </div>
          )}
          <button onClick={() => (podeDominios ? setAddPopup(true) : setShowAddProv(true))} className="btn-primary text-sm min-h-[40px]">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* ───── Aba: Domínios ───── */}
        {tab === 'dominios' && (
          <div className="app-panel rounded-2xl p-4 sm:p-5 relative overflow-hidden">
          <Globe className="pointer-events-none absolute right-0 top-0 -mr-6 -mt-8 w-36 h-36 text-primary-500 opacity-[0.06] z-0" />
          <div className="relative space-y-3">
          {!domConfigurado && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2.5">
              O envio por domínio ainda não foi ativado pela plataforma. Fale com o suporte para liberar.
            </div>
          )}

          {carregandoDom ? (
            <div className="flex flex-col items-center justify-center py-10 text-stone-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
              <p className="text-sm">Carregando seus domínios…</p>
            </div>
          ) : dominios.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-stone-500 mb-3">Nenhum domínio conectado ainda.</p>
              <button onClick={() => { setNovoDom(''); setShowAddDom(true) }} disabled={!domConfigurado} className="btn-primary min-h-[44px] mx-auto disabled:opacity-50"><Plus className="w-4 h-4" /> Adicionar domínio</button>
            </div>
          ) : (
            <div className="space-y-2">
              {dominios.map((dom) => {
                const st = statusDominio(dom.status)
                const aberto = !!openDom[dom.id]
                return (
                  <div key={dom.id} className="rounded-xl border border-surface-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-50/50">
                      <Globe className="w-4 h-4 text-primary-600 shrink-0" />
                      <span className="text-sm font-medium text-stone-800 truncate flex-1">{dom.name}</span>
                      {dom.status === 'verified' ? (
                        <BadgeCheck className="w-5 h-5 text-emerald-500 shrink-0" title="Verificado" aria-label="Verificado" />
                      ) : (
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      )}
                      <button onClick={() => setOpenDom((o) => ({ ...o, [dom.id]: !o[dom.id] }))} className="p-1 text-stone-400 hover:text-stone-600" aria-label={aberto ? 'Recolher' : 'Expandir'}>
                        <ChevronDown className={`w-4 h-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {aberto && (
                      <div className="p-3 space-y-3">
                        <div>
                          <button type="button" onClick={() => setDnsOpen((o) => ({ ...o, [dom.id]: !dnsVisivel(dom) }))} className="w-full flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
                            <span>Registros DNS</span>
                            {dom.status === 'verified' && <BadgeCheck className="w-4 h-4 text-emerald-500" title="Verificado" />}
                            <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${dnsVisivel(dom) ? 'rotate-180' : ''}`} />
                          </button>
                          {dnsVisivel(dom) && (
                          <div className="overflow-x-auto rounded-lg border border-surface-100">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-stone-400 text-left bg-surface-50/60">
                                  <th className="py-1.5 px-2 font-medium">Tipo</th>
                                  <th className="py-1.5 px-2 font-medium">Nome / Host</th>
                                  <th className="py-1.5 px-2 font-medium">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(dom.records || []).map((r, i) => (
                                  <tr key={i} className="border-t border-surface-100 align-top">
                                    <td className="py-1.5 px-2 font-mono text-stone-700 whitespace-nowrap">{r.tipo}{r.prioridade != null ? ` (${r.prioridade})` : ''}</td>
                                    <td className="py-1.5 px-2 font-mono text-stone-600 break-all">
                                      <button onClick={() => copiar(r.nome || '@', `${dom.id}-n-${i}`)} className="inline-flex items-center gap-1 hover:text-primary-600 text-left">
                                        <span className="break-all">{r.nome || '@'}</span>
                                        {copiado === `${dom.id}-n-${i}` ? <Check className="w-3 h-3 text-emerald-500 shrink-0" /> : <Copy className="w-3 h-3 opacity-40 shrink-0" />}
                                      </button>
                                    </td>
                                    <td className="py-1.5 px-2 font-mono text-stone-600 break-all">
                                      <button onClick={() => copiar(r.valor, `${dom.id}-v-${i}`)} className="inline-flex items-center gap-1 hover:text-primary-600 text-left">
                                        <span className="break-all">{r.valor}</span>
                                        {copiado === `${dom.id}-v-${i}` ? <Check className="w-3 h-3 text-emerald-500 shrink-0" /> : <Copy className="w-3 h-3 opacity-40 shrink-0" />}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          )}
                        </div>

                        {dom.status === 'verified' && (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-xs font-semibold text-stone-600">Remetentes deste domínio</p>
                              <button onClick={() => addSender(dom)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg px-2 py-1"><UserPlus className="w-3.5 h-3.5" /> Adicionar</button>
                            </div>
                            {(dom.senders || []).length === 0 ? (
                              <p className="text-xs text-stone-400 py-1">Nenhum remetente ainda. Ex.: contato@{dom.name}</p>
                            ) : (
                              <div className="space-y-1.5">
                                {(dom.senders || []).map((s) => (
                                  <div key={s.id} className="flex flex-col gap-1.5 rounded-xl border border-surface-100 bg-surface-50/40 p-2">
                                    <div className="flex items-center gap-0.5 w-full rounded-lg border border-surface-200 bg-white pr-1 focus-within:border-primary-300">
                                      <input value={s.nome || ''} onChange={(e) => updateSender(dom, s.id, { nome: e.target.value })} placeholder="Nome do remetente" className="flex-1 min-w-0 px-2.5 py-2 min-h-[38px] bg-transparent text-sm outline-none" />
                                      <EmojiPicker onPick={(em) => appendNome(dom, s, em)} buttonClassName="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 shrink-0" />
                                      <ChavesPicker onPick={(k) => appendNome(dom, s, k)} buttonClassName="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 shrink-0" />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <input value={s.email || ''} onChange={(e) => updateSender(dom, s.id, { email: e.target.value })} placeholder={`contato@${dom.name}`} className="flex-1 min-w-0 px-2.5 py-2 min-h-[38px] rounded-lg border border-surface-200 bg-white text-sm" />
                                      <button onClick={() => removeSender(dom, s.id)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Remover remetente"><X className="w-4 h-4" /></button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          {dom.status !== 'verified' && (
                            <button onClick={() => verificar(dom)} disabled={verificandoId === dom.id} className="btn-primary text-xs min-h-[38px]">
                              {verificandoId === dom.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Verificar
                            </button>
                          )}
                          {dom.status === 'verified' && (
                            <button onClick={() => salvarSenders(dom)} disabled={salvandoSenders === dom.id} className="btn-secondary text-xs min-h-[38px] disabled:opacity-60">{salvandoSenders === dom.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar remetentes</button>
                          )}
                          <button onClick={() => excluirDominio(dom)} className="btn-secondary text-xs min-h-[38px] !text-red-600"><Trash2 className="w-3.5 h-3.5" /> Remover</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </div>
          </div>
        )}

        {/* ───── Aba: API's (provedores BYO) ───── */}
        {tab === 'apis' && (
        <div className="space-y-3">
        {/* ───── Provedores de envio ───── */}
        <Secao
          title="Provedores de envio"
          iconImg={resendLogo}
          open={secoes.provedores}
          onToggle={() => toggleSecao('provedores')}
          action={
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowAddProv(true) }}
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
              <button onClick={() => setShowAddProv(true)} className="btn-primary min-h-[44px] mx-auto"><Plus className="w-4 h-4" /> Adicionar provedor</button>
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
          title="Rastreamento"
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
        )}
      </div>

      {/* ───── Popup: escolher o que adicionar ───── */}
      {addPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAddPopup(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Plus className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">O que você quer adicionar?</h3>
                <p className="text-xs text-stone-500">Conecte um domínio próprio ou uma API de provedor.</p>
              </div>
              <button onClick={() => setAddPopup(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <button
              onClick={() => { setAddPopup(false); setTab('dominios'); setNovoDom(''); setShowAddDom(true) }}
              className="w-full flex items-center gap-3 rounded-xl border-2 border-surface-200 hover:border-primary-300 hover:bg-primary-50/40 px-4 py-3 text-left transition"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Globe className="w-5 h-5" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-stone-800">Adicionar domínio</span><span className="block text-xs text-stone-500">Envie com seu próprio domínio (melhor entregabilidade).</span></span>
            </button>
            <button
              onClick={() => { setAddPopup(false); setTab('apis'); setNovoProvNome(''); setNovoProvKey(''); setShowAddProv(true) }}
              className="w-full flex items-center gap-3 rounded-xl border-2 border-surface-200 hover:border-primary-300 hover:bg-primary-50/40 px-4 py-3 text-left transition"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Server className="w-5 h-5" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-stone-800">Adicionar API</span><span className="block text-xs text-stone-500">Conecte a API key da sua conta Resend (BYO).</span></span>
            </button>
          </div>
        </div>
      )}

      {/* ───── Modal: adicionar domínio ───── */}
      {showAddDom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowAddDom(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Globe className="w-5 h-5" /></span>
              <h3 className="text-lg font-semibold text-stone-800">Adicionar domínio</h3>
              <button onClick={() => setShowAddDom(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            {!domConfigurado && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2.5">O envio por domínio ainda não foi ativado pela plataforma. Fale com o suporte.</div>
            )}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Domínio (ou subdomínio)</label>
              <input
                autoFocus
                value={novoDom}
                onChange={(e) => setNovoDom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') criarDominio() }}
                placeholder="mail.sualoja.com"
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm focus:border-primary-400 focus:outline-none"
              />
              <p className="text-[11px] text-stone-400 mt-1">Recomendado usar um subdomínio, ex.: <strong>mail.sualoja.com</strong>.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddDom(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={criarDominio} disabled={criandoDom || !domConfigurado} className="btn-primary min-h-[44px] disabled:opacity-50">
                {criandoDom ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Modal: adicionar provedor (API) ───── */}
      {showAddProv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowAddProv(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Server className="w-5 h-5" /></span>
              <h3 className="text-lg font-semibold text-stone-800">Adicionar API (provedor)</h3>
              <button onClick={() => setShowAddProv(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Nome (só pra você identificar)</label>
              <input autoFocus value={novoProvNome} onChange={(e) => setNovoProvNome(e.target.value)} placeholder={`Provedor ${providers.length + 1}`} className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm focus:border-primary-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1"><span className="inline-flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> API Key do Resend</span></label>
              <input value={novoProvKey} onChange={(e) => setNovoProvKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') criarProviderModal() }} placeholder="re_xxxxxxxxxxxxxxxxxxxx" className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm font-mono focus:border-primary-400 focus:outline-none" />
              <p className="text-[11px] text-stone-400 mt-1">Pega em resend.com → API Keys. Você adiciona os remetentes depois.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddProv(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={criarProviderModal} disabled={criandoProv} className="btn-primary min-h-[44px]">
                {criandoProv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

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

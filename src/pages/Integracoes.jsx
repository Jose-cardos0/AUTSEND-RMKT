import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import {
  getEvolutionConfig,
  getInstances,
  updateInstance,
  setSelectedInstance,
  deleteInstance,
  createWebhook,
  getKiwifyWebhooks,
  updateWebhook,
  deleteWebhook,
} from '../lib/firestore'
import { criarInstancia, podeCriarInstancia, verificarStatus, buscarGrupos, obterQr, reconectarInstancia } from '../lib/evolutionApi'
import { criarCheckoutInstancia } from '../lib/perfil'
import ComprarInstanciaModal from '../components/ComprarInstanciaModal'
import CheckoutModal from '../components/CheckoutModal'
import instanciaWhats from '../assets/whtatsicons/instancia-whats.png'
import {
  QrCode,
  Plus,
  Users,
  Webhook,
  Copy,
  Check,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  Trash2,
  Star,
  ChevronDown,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import WhatsAppIcon from '../components/WhatsAppIcon'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import { useConfirm } from '../components/ConfirmDialog'
import MelhorarPlano from '../components/MelhorarPlano'
import { usePlano } from '../lib/PlanoContext'

/** Seção recolhível (dropdown), começa minimizada. */
function Secao({ title, icon: Icon, open, onToggle, children, bgIcon: BgIcon, action }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden relative">
      {BgIcon && <BgIcon className="pointer-events-none absolute right-0 top-0 -mr-6 -mt-8 w-36 h-36 text-[#25D366] opacity-[0.07] z-0" />}
      <div className="relative z-10 flex items-center gap-2 px-4 sm:px-5 py-3.5">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2 text-sm sm:text-base font-semibold text-stone-800 min-w-0">
            {Icon && <Icon className="w-5 h-5 text-primary-600 shrink-0" />}
            <span className="truncate">{title}</span>
          </span>
        </button>
        {action}
        <button type="button" onClick={onToggle} className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors" aria-label={open ? 'Recolher' : 'Expandir'}>
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && <div className="relative z-10 px-4 sm:px-5 pb-4 pt-1">{children}</div>}
    </div>
  )
}

export default function Integracoes() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const { limiteDe } = usePlano()
  const [instModalOpen, setInstModalOpen] = useState(false) // modal de comprar instância
  const [comprandoInst, setComprandoInst] = useState(false)
  const [checkoutSecret, setCheckoutSecret] = useState(null)
  const [checandoLimite, setChecandoLimite] = useState(false) // loading do "Nova instância"
  const [limiteEstourado, setLimiteEstourado] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [instances, setInstances] = useState([])
  const [selectedInstanceId, setSelectedInstanceId] = useState(null)
  const [evolution, setEvolution] = useState(null)
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [nomeInstancia, setNomeInstancia] = useState('')
  const [numeroWhatsapp, setNumeroWhatsapp] = useState('')
  const [qrBase64, setQrBase64] = useState(null)
  const [showQrModal, setShowQrModal] = useState(false)
  const [showNovaInst, setShowNovaInst] = useState(false)
  const [secoes, setSecoes] = useState({ whatsapp: false, kiwify: false })
  const toggleSecao = (k) => setSecoes((s) => ({ ...s, [k]: !s[k] }))
  const [instanceEmConexao, setInstanceEmConexao] = useState(null)
  const [verificando, setVerificando] = useState(false)
  const [gerandoQr, setGerandoQr] = useState(false)
  const [buscandoGruposId, setBuscandoGruposId] = useState(null)
  const [copiado, setCopiado] = useState(null)
  const [gerenciarInst, setGerenciarInst] = useState(null) // instância aberta no popup de gerenciar
  const [criandoWebhook, setCriandoWebhook] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [paginaInstancias, setPaginaInstancias] = useState(1)
  const pollingRef = useRef(null)
  const INSTANCIAS_POR_PAGINA = 9

  useEffect(() => {
    if (!user?.uid) return
    getInstances(user.uid)
      .then((instList) => {
        setInstances(instList)
        return getEvolutionConfig(user.uid)
      })
      .then((evo) => {
        setEvolution(evo)
        setSelectedInstanceId(evo?.id ?? null)
        return getKiwifyWebhooks(user.uid)
      })
      .then(setWebhooks)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user?.uid])

  // Polling: quando o QR está no modal, verifica status a cada 3s; ao detectar conexão, atualiza a instância e fecha o modal
  useEffect(() => {
    if (!showQrModal || !qrBase64 || !user?.uid || !instanceEmConexao?.id) return
    const { nomeInstancia: nome, numeroWhatsapp: numeroParaVerificar } = instanceEmConexao
    if (!nome?.trim()) return

    const check = async () => {
      try {
        const res = await verificarStatus(nome, false, numeroParaVerificar)
        const state = res?.state ?? res?.data?.state ?? res?.status ?? res?.data?.status
        const conectado =
          res?.conectado === true ||
          res?.connected === true ||
          res?.status === 'connected' ||
          res?.state === 'open' ||
          res?.data?.conectado === true ||
          res?.data?.connected === true ||
          res?.data?.state === 'open' ||
          res?.data?.status === 'connected' ||
          state === 'open' ||
          state === 'connected'
        if (conectado) {
          if (pollingRef.current) clearInterval(pollingRef.current)
          pollingRef.current = null
          const numeroDaResposta =
            res?.numero ?? res?.number ?? res?.phone ?? res?.telefone ?? res?.connectedNumber ??
            res?.data?.numero ?? res?.data?.number ??
            (res?.wid ? String(res.wid).replace(/@.*$/, '').replace(/\D/g, '') : null) ??
            (res?.user ? String(res.user).replace(/\D/g, '') : null)
          const numeroFinal = (numeroDaResposta ? String(numeroDaResposta).replace(/\D/g, '') : null) || numeroParaVerificar?.replace(/\D/g, '')
          await updateInstance(user.uid, instanceEmConexao.id, {
            conectado: true,
            qrCodeBase64: null,
            ...(numeroFinal && { numeroWhatsapp: numeroFinal }),
          })
          setQrBase64(null)
          setShowQrModal(false)
          setInstanceEmConexao(null)
          const list = await getInstances(user.uid)
          setInstances(list)
          if (evolution?.id === instanceEmConexao.id) setEvolution((e) => ({ ...e, conectado: true, ...(numeroFinal && { numeroWhatsapp: numeroFinal }) }))
          toast.success(numeroFinal ? `WhatsApp conectado: ${numeroFinal}` : 'WhatsApp conectado com sucesso!')
        }
      } catch (_) {}
    }

    check()
    pollingRef.current = setInterval(check, 3000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [showQrModal, qrBase64, user?.uid, instanceEmConexao])

  useEffect(() => {
    const totalPaginas = Math.max(1, Math.ceil(instances.length / INSTANCIAS_POR_PAGINA))
    if (paginaInstancias > totalPaginas) setPaginaInstancias(totalPaginas)
  }, [instances.length, paginaInstancias])

  const handleCriarInstancia = async () => {
    if (!user?.uid) return
    // O limite é checado no servidor (abrirNovaInstancia + trava do waCriarInstancia), sem depender de cache.
    const nome = nomeInstancia.trim() || `instancia_${Date.now()}`
    const num = (numeroWhatsapp || '').replace(/\D/g, '')
    setCriando(true)
    setMsg({ type: '', text: '' })
    setQrBase64(null)
    setShowQrModal(false)
    setInstanceEmConexao(null)
    try {
      // A trava de plano roda no servidor, que TAMBÉM grava o doc (a coleção é bloqueada nas rules).
      // Se estourar o limite, isto lança e nada é criado.
      const res = await criarInstancia(nome, numeroWhatsapp)
      const base64 = res.base64 ?? res.qrCodeBase64 ?? res.qrcode
      // WAHA normaliza o nome (sem espaço/acento) e vira o ID da sessão — usa o que a CF devolveu.
      const nomeFinal = res.nomeInstancia ?? nome
      const newId = res.id
      setQrBase64(base64 || null)
      setInstanceEmConexao({ id: newId, nomeInstancia: nomeFinal, numeroWhatsapp: num })
      setShowNovaInst(false)
      if (base64) setShowQrModal(true)
      const list = await getInstances(user.uid)
      setInstances(list)
      if (instances.length === 0) {
        await setSelectedInstance(user.uid, newId)
        setSelectedInstanceId(newId)
        setEvolution({ id: newId, nomeInstancia: nomeFinal, hash: null, instanceId: null, numeroWhatsapp: num, conectado: false, grupos: [] })
      }
      toast.success('Instância criada. Escaneie o QR Code no popup.')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar instância')
    } finally {
      setCriando(false)
    }
  }

  // Clica em "Nova instância": abre o popup, checa no servidor se ainda cabe. Se lotou, mostra o card de compra.
  const abrirNovaInstancia = async () => {
    setNomeInstancia('')
    setNumeroWhatsapp('')
    setLimiteEstourado(false)
    setShowNovaInst(true)
    setChecandoLimite(true)
    try {
      const r = await podeCriarInstancia()
      setLimiteEstourado(!r?.pode)
    } catch (err) {
      toast.error(err?.message || 'Não consegui verificar seu limite. Tente de novo.')
      setShowNovaInst(false)
    } finally {
      setChecandoLimite(false)
    }
  }

  const comprarInstancia = async (quantidade) => {
    setComprandoInst(true)
    try {
      const r = await criarCheckoutInstancia(quantidade)
      if (r?.clientSecret) setCheckoutSecret(r.clientSecret)
      else toast.error('Não consegui abrir o checkout. Tente de novo.')
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a compra.')
    } finally {
      setComprandoInst(false)
    }
  }

  const handleVerificarStatus = async (inst) => {
    const instancia = inst ?? evolution
    const nomeInstanciaParaVerificar = instancia?.nomeInstancia || nomeInstancia
    if (!nomeInstanciaParaVerificar || !user?.uid) return
    setVerificando(true)
    try {
      const numeroParaVerificar = instancia?.numeroWhatsapp || numeroWhatsapp
      const res = await verificarStatus(nomeInstanciaParaVerificar, false, numeroParaVerificar)
      const state = res?.state ?? res?.data?.state ?? res?.status ?? res?.data?.status
      const conectado =
        res?.conectado === true ||
        res?.connected === true ||
        res?.status === 'connected' ||
        res?.state === 'open' ||
        res?.data?.conectado === true ||
        res?.data?.connected === true ||
        res?.data?.state === 'open' ||
        res?.data?.status === 'connected' ||
        state === 'open' ||
        state === 'connected'
      if (conectado && instancia?.id) {
        const numeroDaResposta =
          res?.numero ?? res?.number ?? res?.phone ?? res?.telefone ?? res?.connectedNumber ??
          res?.data?.numero ?? res?.data?.number ??
          (res?.wid ? String(res.wid).replace(/@.*$/, '').replace(/\D/g, '') : null) ??
          (res?.user ? String(res.user).replace(/\D/g, '') : null)
        const numeroFinal = (numeroDaResposta ? String(numeroDaResposta).replace(/\D/g, '') : null) || numeroParaVerificar?.replace(/\D/g, '')
        await updateInstance(user.uid, instancia.id, { conectado: true, qrCodeBase64: null, ...(numeroFinal && { numeroWhatsapp: numeroFinal }) })
        const list = await getInstances(user.uid)
        setInstances(list)
        if (evolution?.id === instancia.id) setEvolution((e) => ({ ...e, conectado: true, ...(numeroFinal && { numeroWhatsapp: numeroFinal }) }))
        toast.success(numeroFinal ? `WhatsApp conectado: ${numeroFinal}` : 'WhatsApp conectado com sucesso!')
      } else if (conectado && !instancia?.id) {
        toast.success('WhatsApp conectado (instância legada).')
      } else {
        // Não conectada → gera QR novo pra reconectar (caiu/deslogou).
        toast('Instância desconectada — gerando QR pra reconectar…', { icon: '🔄' })
        await tentarReconectar(instancia, String(res?.status || res?.data?.status || '').toUpperCase())
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao verificar')
    } finally {
      setVerificando(false)
    }
  }

  /** Reconecta uma sessão caída: restart (se preciso) + QR novo no modal (o polling detecta ao reescanear). */
  const tentarReconectar = async (instancia, statusAtual) => {
    const nome = instancia?.nomeInstancia
    if (!nome || !instancia?.id) { toast.error('Instância inválida pra reconectar.'); return }
    setGerandoQr(true)
    try {
      const pegarQr = async () => {
        const qr = await obterQr(nome)
        return { qr, base64: qr?.qrcodeBase64 ?? qr?.base64 ?? qr?.qrCodeBase64 ?? null }
      }
      // SCAN_QR_CODE já tem QR pendente; senão dá restart e espera o WAHA gerar (~2-3s).
      if (statusAtual !== 'SCAN_QR_CODE') {
        await reconectarInstancia(nome).catch(() => {})
        await new Promise((r) => setTimeout(r, 3000))
      }
      let { qr, base64 } = await pegarQr()
      if (!base64) { await new Promise((r) => setTimeout(r, 2500)); ({ qr, base64 } = await pegarQr()) }
      if (base64) {
        setGerenciarInst(null)
        setInstanceEmConexao({ id: instancia.id, nomeInstancia: nome, numeroWhatsapp: instancia?.numeroWhatsapp })
        setQrBase64(base64)
        setShowQrModal(true)
        toast.success('Escaneie o novo QR pra reconectar.')
      } else {
        toast.error(qr?.erro || 'Não consegui gerar o QR agora. Tente de novo em alguns segundos.')
      }
    } catch (e) {
      toast.error(e.message || 'Falha ao reconectar.')
    } finally {
      setGerandoQr(false)
    }
  }

  const handleBuscarGrupos = async (inst) => {
    const instancia = inst ?? evolution
    const nomeInstanciaVal = instancia?.nomeInstancia || nomeInstancia
    const hashVal = instancia?.hash
    const instanciaIdVal = instancia?.instanceId ?? instancia?.hash
    if (!nomeInstanciaVal || !hashVal) {
      toast.error('Instância precisa de nome e hash (conecte primeiro).')
      return
    }
    const id = instancia?.id
    setBuscandoGruposId(id ?? true)
    try {
      const res = await buscarGrupos({
        nomeInstancia: nomeInstanciaVal,
        hash: hashVal,
        instanciaId: instanciaIdVal,
      })
      let raw = res
      if (Array.isArray(res) && res.length > 0) {
        raw = res[0]?.grupos ?? res[0]?.groups ?? res[0]
      } else {
        raw = res?.grupos ?? res?.groups ?? res?.data?.grupos ?? res?.data?.groups ?? res?.body?.grupos ?? res?.body?.groups ?? res?.result
      }
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw) } catch { raw = null }
      }
      if (!Array.isArray(raw) && raw && typeof raw === 'object') raw = raw.grupos ?? raw.groups ?? null
      const lista = Array.isArray(raw) ? raw : []
      if (lista.length > 0 && user?.uid && id) {
        await updateInstance(user.uid, id, { grupos: lista })
        const list = await getInstances(user.uid)
        setInstances(list)
        if (evolution?.id === id) setEvolution((e) => ({ ...e, grupos: lista }))
      }
      if (lista.length === 0) console.log('Resposta buscar_grupo (debug):', JSON.stringify(res, null, 2) || '(vazio)')
      toast.success(lista.length ? `${lista.length} grupo(s) encontrado(s).` : '0 grupo(s). Verifique o webhook no n8n.')
    } catch (err) {
      toast.error(err.message || 'Erro ao buscar grupos')
    } finally {
      setBuscandoGruposId(null)
    }
  }

  const handleCriarWebhookKiwify = async () => {
    if (!user?.uid) return
    setCriandoWebhook(true)
    try {
      await createWebhook(user.uid, {
        tipo: 'kiwify_abandoned_checkout',
        nome: `Kiwify ${new Date().toLocaleDateString('pt-BR')}`,
      })
      const lista = await getKiwifyWebhooks(user.uid)
      setWebhooks(lista)
      toast.success('Novo webhook criado! Use a URL na Kiwify. Você pode ter vários webhooks.')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar webhook')
    } finally {
      setCriandoWebhook(false)
    }
  }

  const handleExcluirInstancia = async (inst) => {
    if (!user?.uid) return
    const docId = inst?.id
    if (!docId) {
      toast.error('ID da instância inválido. Recarregue a página e tente de novo.')
      return
    }
    const nome = inst.nomeInstancia || 'esta instância'
    if (!(await confirm({ title: `Excluir "${nome}"?`, message: 'Esta ação desconecta e remove a instância.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteInstance(user.uid, docId)
      const updated = await getInstances(user.uid)
      setInstances(updated)

      if (selectedInstanceId === docId) {
        const nextPrincipal = updated[0]?.id ?? null
        await setSelectedInstance(user.uid, nextPrincipal)
        setSelectedInstanceId(nextPrincipal)
      }

      const evo = await getEvolutionConfig(user.uid)
      setEvolution(evo)
      toast.success('Instância excluída com sucesso.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir instância')
    }
  }

  const copyUrl = (url, id) => {
    navigator.clipboard.writeText(url)
    setCopiado(id)
    setTimeout(() => setCopiado(null), 2000)
  }

  const handleSalvarNomeWebhook = async (webhookId, nome) => {
    if (!user?.uid) return
    const valor = (nome || '').trim() || 'Webhook Kiwify'
    try {
      await updateWebhook(user.uid, webhookId, { nome: valor })
      const lista = await getKiwifyWebhooks(user.uid)
      setWebhooks(lista)
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar nome')
    }
  }

  const handleExcluirWebhook = async (webhookId) => {
    if (!user?.uid) return
    if (!(await confirm({ title: 'Excluir este webhook?', message: 'A URL deixará de funcionar na Kiwify.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteWebhook(user.uid, webhookId)
      const lista = await getKiwifyWebhooks(user.uid)
      setWebhooks(lista)
      toast.success('Webhook excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  if (loading) {
    return <PageLoader className="flex-1 min-h-0 py-10" />
  }

  const totalPaginasInstancias = Math.max(1, Math.ceil(instances.length / INSTANCIAS_POR_PAGINA))
  const paginaInstanciasAtual = Math.min(paginaInstancias, totalPaginasInstancias)
  const instanciasPagina = instances.slice(
    (paginaInstanciasAtual - 1) * INSTANCIAS_POR_PAGINA,
    paginaInstanciasAtual * INSTANCIAS_POR_PAGINA
  )

  return (
    <PageShell
      badge="WhatsApp · Conexões"
      title="Integrações"
    >
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      {instModalOpen && (
        <ComprarInstanciaModal
          comprando={comprandoInst}
          onConfirm={comprarInstancia}
          onClose={() => setInstModalOpen(false)}
        />
      )}
      {checkoutSecret && (
        <CheckoutModal
          clientSecret={checkoutSecret}
          onClose={() => setCheckoutSecret(null)}
          onComplete={() => {
            setCheckoutSecret(null)
            setInstModalOpen(false)
            toast.success('Pagamento concluído! Atualizando seu limite de instâncias…')
            // recarrega pra o novo limite (instanciasExtras) refletir no botão/trava
            setTimeout(() => window.location.reload(), 3000)
          }}
        />
      )}

      {/* Popup: gerenciar instância (principal / verificar / grupos / excluir) */}
      {gerenciarInst && (() => {
        const inst = gerenciarInst
        const isPrincipal = selectedInstanceId === inst.id
        const gruposPuxados = inst.grupos?.length > 0
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setGerenciarInst(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-100 text-stone-600 shrink-0"><Settings className="w-5 h-5" /></span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-stone-800 truncate">Gerenciar instância</h3>
                  <p className="text-sm text-stone-500 truncate">{inst.nomeInstancia || 'Sem nome'}</p>
                </div>
                <button onClick={() => setGerenciarInst(null)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-2.5">
                {!isPrincipal && (
                  <button
                    type="button"
                    onClick={async () => {
                      await setSelectedInstance(user.uid, inst.id)
                      setSelectedInstanceId(inst.id)
                      const evo = await getEvolutionConfig(user.uid)
                      setEvolution(evo)
                      setGerenciarInst(null)
                      toast.success(`"${inst.nomeInstancia}" é agora a instância principal para automações.`)
                    }}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50/50 text-left transition"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><Star className="w-4 h-4" /></span>
                    <span className="text-sm font-semibold text-stone-800">Definir como principal</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { handleVerificarStatus(inst) }}
                  disabled={verificando || !inst.nomeInstancia}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-stone-600 shrink-0">{verificando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}</span>
                  <span className="text-sm font-semibold text-stone-800">{gerandoQr ? 'Gerando QR…' : verificando ? 'Verificando…' : 'Verificar conexão'}</span>
                </button>
                {/* Disparo para grupos removido (não portado pro WAHA) — botão "Puxar grupos" escondido. */}
                <button
                  type="button"
                  onClick={() => { setGerenciarInst(null); handleExcluirInstancia(inst) }}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-surface-200 hover:border-red-300 hover:bg-red-50/50 text-left transition"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></span>
                  <span className="text-sm font-semibold text-stone-800">Excluir instância</span>
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Popup: Nova instância (nome + número) */}
      {showNovaInst && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowNovaInst(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><WhatsAppIcon className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">{limiteEstourado ? 'Limite de instâncias atingido' : 'Nova instância'}</h3>
              <button onClick={() => setShowNovaInst(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {checandoLimite ? (
              <div className="py-10 flex flex-col items-center justify-center gap-2 text-stone-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">Verificando seu limite…</p>
              </div>
            ) : limiteEstourado ? (
              <div className="text-center">
                <img src={instanciaWhats} alt="" className="h-24 w-auto mx-auto object-contain drop-shadow-sm" />
                <p className="text-sm text-stone-600 mt-2">Você já usou todas as instâncias do seu plano. Compre uma instância avulsa pra conectar mais um número.</p>
                <p className="text-lg font-bold text-emerald-600 mt-2">R$ 29,90<span className="text-sm font-medium text-stone-500">/mês cada</span></p>
                <button
                  onClick={() => { setShowNovaInst(false); setInstModalOpen(true) }}
                  className="w-full mt-4 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm shadow-emerald-500/25 transition"
                >
                  <ShoppingCart className="w-4 h-4" /> Comprar instância
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nome da instância</label>
                  <input
                    type="text"
                    value={nomeInstancia}
                    onChange={(e) => setNomeInstancia(e.target.value)}
                    placeholder="minha_instancia"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-surface-50/50 text-sm min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Número do WhatsApp</label>
                  <input
                    type="text"
                    value={numeroWhatsapp}
                    onChange={(e) => setNumeroWhatsapp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !criando) handleCriarInstancia() }}
                    placeholder="5511999999999"
                    className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-surface-50/50 text-sm min-h-[44px]"
                  />
                </div>
                <button
                  onClick={handleCriarInstancia}
                  disabled={criando}
                  className="btn-primary w-full min-h-[44px] touch-manipulation"
                >
                  {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                  {criando ? 'Criando...' : 'Criar instância'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal QR Code — overlay preto/50 */}
      {showQrModal && qrBase64 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" onClick={() => setShowQrModal(false)}>
          <div
            className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl shadow-primary-900/10 border border-surface-200/80 max-w-[95vw] sm:max-w-sm w-full p-4 sm:p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-stone-500"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-semibold text-stone-800 pr-10">Conectar WhatsApp</h3>
            <p className="text-sm text-stone-500 mt-1 mb-4">Escaneie o QR Code com o WhatsApp (Dispositivos conectados).</p>
            <div className="flex justify-center p-3 sm:p-4 bg-gray-50 rounded-xl">
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code WhatsApp"
                className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
              />
            </div>
            <p className="text-center text-sm text-amber-600 mt-4 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              Aguardando leitura do QR Code… A conexão será detectada automaticamente.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
      <Secao
        title="WhatsApp"
        icon={WhatsAppIcon}
        bgIcon={WhatsAppIcon}
        open={secoes.whatsapp}
        onToggle={() => toggleSecao('whatsapp')}
        action={
          <button
            type="button"
            onClick={abrirNovaInstancia}
            className="btn-primary text-xs sm:text-sm min-h-[38px] px-3 shrink-0"
          >
            <Plus className="w-4 h-4" /> Nova instância
          </button>
        }
      >
          <div className="space-y-4">
          {instances.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-stone-700">Suas instâncias — selecione qual usar para automações e mensagens</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {instanciasPagina.map((inst) => {
                  const isPrincipal = selectedInstanceId === inst.id
                  return (
                    <div
                      key={inst.id}
                      className={`relative p-4 sm:p-5 rounded-xl border-2 transition ${isPrincipal ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50'}`}
                    >
                      {isPrincipal && (
                        <span className="absolute -top-2 right-3 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200 shadow-sm">
                          <Star className="w-2.5 h-2.5" /> Principal
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-stone-800 break-all">{inst.nomeInstancia || 'Sem nome'}</p>
                          {inst.numeroWhatsapp && (
                            <p className="text-sm text-stone-500 mt-0.5">{inst.numeroWhatsapp}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {inst.conectado === true ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Conectado</span>
                            ) : inst.qrCodeBase64 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600">Aguardando QR</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-stone-500">Não conectado</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setGerenciarInst(inst)}
                            className="p-2.5 rounded-lg text-stone-500 hover:bg-surface-100 hover:text-stone-700 transition-colors touch-manipulation"
                            title="Gerenciar instância"
                            aria-label="Gerenciar instância"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {instances.length > INSTANCIAS_POR_PAGINA && (
                <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <p className="text-sm text-stone-600">
                    Página {paginaInstanciasAtual} de {totalPaginasInstancias} · {instances.length} instância(s)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPaginaInstancias((p) => Math.max(1, p - 1))}
                      disabled={paginaInstanciasAtual <= 1}
                      className="p-2 rounded-lg border border-surface-200 bg-white text-stone-700 hover:bg-surface-50 disabled:opacity-50"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaginaInstancias((p) => Math.min(totalPaginasInstancias, p + 1))}
                      disabled={paginaInstanciasAtual >= totalPaginasInstancias}
                      className="p-2 rounded-lg border border-surface-200 bg-white text-stone-700 hover:bg-surface-50 disabled:opacity-50"
                      aria-label="Próxima página"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {instances.length === 0 && !evolution?.nomeInstancia && (
            <p className="text-sm text-stone-500">Nenhuma instância ainda. Clique em <strong>Nova instância</strong> ali em cima e escaneie o QR Code.</p>
          )}
          </div>
      </Secao>

      {/* Webhook Kiwify escondido — migrado para MundPay + webhook custom no Tracker */}
      {false && (
      <Secao title="Webhook Kiwify" icon={Webhook} open={secoes.kiwify} onToggle={() => toggleSecao('kiwify')}>
          <div className="space-y-4">
          <p className="text-sm text-stone-500 leading-relaxed">
            Cada clique em &quot;Criar webhook Kiwify&quot; gera um <strong>novo</strong> webhook (não substitui os anteriores). Use a URL na Kiwify; os webhooks antigos continuam válidos.
          </p>
          <button
            onClick={handleCriarWebhookKiwify}
            disabled={criandoWebhook}
            className="btn-primary w-full sm:w-auto min-h-[44px] touch-manipulation"
          >
            {criandoWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
            {criandoWebhook ? 'Criando...' : 'Criar webhook Kiwify'}
          </button>

          {webhooks.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-stone-700">Seus webhooks</p>
              {webhooks.map((w) => {
                const url = w.webhookUrl ?? `https://us-central1-afiliadocdnx.cloudfunctions.net/kiwifyAbandonedCheckout?webhookId=${w.id}&userId=${user?.uid}`
                return (
                  <div
                    key={w.id}
                    className="p-3 sm:p-4 rounded-xl bg-surface-50 border border-surface-200 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <input
                        type="text"
                        defaultValue={w.nome || ''}
                        onBlur={(e) => handleSalvarNomeWebhook(w.id, e.target.value)}
                        placeholder="Ex: Webhook produto Kiwify"
                        className="flex-1 min-w-0 text-sm font-medium text-stone-800 bg-white border border-surface-200 rounded-lg px-3 py-2.5 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                      <button
                        onClick={() => handleExcluirWebhook(w.id)}
                        className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-red-50 text-stone-500 hover:text-red-600 touch-manipulation shrink-0"
                        title="Excluir webhook"
                        type="button"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <code className="flex-1 min-w-0 text-xs text-stone-600 truncate break-all">{url}</code>
                      <button
                        onClick={() => copyUrl(url, w.id)}
                        className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-surface-200 text-stone-600 shrink-0 touch-manipulation"
                        title="Copiar URL"
                      >
                        {copiado === w.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          </div>
      </Secao>
      )}
      </div>
    </PageShell>
  )
}

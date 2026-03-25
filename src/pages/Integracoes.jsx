import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import {
  getEvolutionConfig,
  getInstances,
  addInstance,
  updateInstance,
  setSelectedInstance,
  deleteInstance,
  createWebhook,
  getWebhooks,
  updateWebhook,
  deleteWebhook,
} from '../lib/firestore'
import { criarInstancia, verificarStatus, buscarGrupos } from '../lib/evolutionApi'
import {
  QrCode,
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
} from 'lucide-react'
import WhatsAppIcon from '../components/WhatsAppIcon'

export default function Integracoes() {
  const [user] = useAuthState(auth)
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
  const [instanceEmConexao, setInstanceEmConexao] = useState(null)
  const [verificando, setVerificando] = useState(false)
  const [buscandoGruposId, setBuscandoGruposId] = useState(null)
  const [copiado, setCopiado] = useState(null)
  const [criandoWebhook, setCriandoWebhook] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [paginaInstancias, setPaginaInstancias] = useState(1)
  const pollingRef = useRef(null)
  const INSTANCIAS_POR_PAGINA = 3

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
        return getWebhooks(user.uid)
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
    const nome = nomeInstancia.trim() || `instancia_${Date.now()}`
    const num = (numeroWhatsapp || '').replace(/\D/g, '')
    setCriando(true)
    setMsg({ type: '', text: '' })
    setQrBase64(null)
    setShowQrModal(false)
    setInstanceEmConexao(null)
    try {
      const newId = await addInstance(user.uid, { nomeInstancia: nome, numeroWhatsapp: num })
      const res = await criarInstancia(nome, numeroWhatsapp)
      const base64 = res.base64 ?? res.qrCodeBase64 ?? res.qrcode
      const codeHash = res.hash ?? res.instanceId ?? res.code
      const instanceId = res.instanciaId ?? res.instanceId ?? codeHash
      await updateInstance(user.uid, newId, {
        hash: codeHash,
        qrCodeBase64: base64,
        instanceId,
        conectado: false,
        grupos: [],
      })
      setQrBase64(base64 || null)
      setInstanceEmConexao({ id: newId, nomeInstancia: nome, numeroWhatsapp: num })
      if (base64) setShowQrModal(true)
      const list = await getInstances(user.uid)
      setInstances(list)
      if (instances.length === 0) {
        await setSelectedInstance(user.uid, newId)
        setSelectedInstanceId(newId)
        setEvolution({ id: newId, nomeInstancia: nome, hash: codeHash, instanceId, numeroWhatsapp: num, conectado: false, grupos: [] })
      }
      toast.success('Instância criada. Escaneie o QR Code no popup.')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar instância')
    } finally {
      setCriando(false)
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
        console.warn('verificar_status: resposta não indica conexão.', res)
        toast.error('O servidor não confirmou a conexão. No n8n, o webhook "verificar_status" deve responder com { conectado: true } ou { state: "open" }.')
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao verificar')
    } finally {
      setVerificando(false)
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
      const lista = await getWebhooks(user.uid)
      setWebhooks(lista)
      toast.success('Novo webhook criado! Use a URL na Kiwify. Você pode ter vários webhooks.')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar webhook')
    } finally {
      setCriandoWebhook(false)
    }
  }

  const handleExcluirInstancia = async (inst) => {
    if (!user?.uid || !inst?.id) return
    const nome = inst.nomeInstancia || 'esta instância'
    const ok = window.confirm(`Excluir "${nome}"? Esta ação desconecta e remove a instância.`)
    if (!ok) return
    try {
      await deleteInstance(user.uid, inst.id)
      const updated = await getInstances(user.uid)
      setInstances(updated)

      if (selectedInstanceId === inst.id) {
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
      const lista = await getWebhooks(user.uid)
      setWebhooks(lista)
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar nome')
    }
  }

  const handleExcluirWebhook = async (webhookId) => {
    if (!user?.uid) return
    if (!window.confirm('Excluir este webhook? A URL deixará de funcionar na Kiwify.')) return
    try {
      await deleteWebhook(user.uid, webhookId)
      const lista = await getWebhooks(user.uid)
      setWebhooks(lista)
      toast.success('Webhook excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  const totalPaginasInstancias = Math.max(1, Math.ceil(instances.length / INSTANCIAS_POR_PAGINA))
  const paginaInstanciasAtual = Math.min(paginaInstancias, totalPaginasInstancias)
  const instanciasPagina = instances.slice(
    (paginaInstanciasAtual - 1) * INSTANCIAS_POR_PAGINA,
    paginaInstanciasAtual * INSTANCIAS_POR_PAGINA
  )

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Integrações</h1>
        <p className="text-stone-500 mt-1 text-sm sm:text-base">Evolution API, grupos e webhook Kiwify.</p>
      </div>

      {/* Modal QR Code — overlay preto/50 */}
      {showQrModal && qrBase64 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" onClick={() => setShowQrModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl max-w-[95vw] sm:max-w-sm w-full p-4 sm:p-6 relative"
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

      {/* Evolution API */}
      <section className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-surface-200 bg-surface-50/80">
          <div className="flex items-center gap-2 text-stone-800">
            <WhatsAppIcon className="w-5 h-5 shrink-0" />
            <h2 className="text-base sm:text-lg font-semibold">Integração</h2>
          </div>
        </div>
        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          <p className="text-sm font-medium text-stone-700">Adicionar nova instância</p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end">
            <div className="w-full sm:w-56 min-w-0">
              <label className="block text-sm font-medium text-stone-700 mb-1">Nome da instância</label>
              <input
                type="text"
                value={nomeInstancia}
                onChange={(e) => setNomeInstancia(e.target.value)}
                placeholder="minha_instancia"
                className="w-full sm:w-56 px-3 py-2.5 rounded-xl border border-surface-200 bg-surface-50/50 text-sm transition-all min-h-[44px]"
              />
            </div>
            <div className="w-full sm:w-44 min-w-0">
              <label className="block text-sm font-medium text-stone-700 mb-1">Número do WhatsApp</label>
              <input
                type="text"
                value={numeroWhatsapp}
                onChange={(e) => setNumeroWhatsapp(e.target.value)}
                placeholder="5511999999999"
                className="w-full sm:w-44 px-3 py-2.5 rounded-xl border border-surface-200 bg-surface-50/50 text-sm transition-all min-h-[44px]"
              />
            </div>
            <button
              onClick={handleCriarInstancia}
              disabled={criando}
              className="btn-primary w-full sm:w-auto min-h-[44px] touch-manipulation"
            >
              {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {criando ? 'Criando...' : 'Criar instância'}
            </button>
          </div>

          {instances.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-stone-700">Suas instâncias — selecione qual usar para automações e mensagens</p>
              <div className="space-y-3">
                {instanciasPagina.map((inst) => {
                  const isPrincipal = selectedInstanceId === inst.id
                  return (
                    <div
                      key={inst.id}
                      className={`p-4 sm:p-5 rounded-xl border-2 transition ${isPrincipal ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-stone-800 break-all">{inst.nomeInstancia || 'Sem nome'}</p>
                          {inst.numeroWhatsapp && (
                            <p className="text-sm text-stone-500 mt-0.5">{inst.numeroWhatsapp}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {isPrincipal && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                                <Star className="w-3 h-3" /> Principal
                              </span>
                            )}
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
                          {!isPrincipal && (
                            <button
                              type="button"
                              onClick={async () => {
                                await setSelectedInstance(user.uid, inst.id)
                                setSelectedInstanceId(inst.id)
                                const evo = await getEvolutionConfig(user.uid)
                                setEvolution(evo)
                                toast.success(`"${inst.nomeInstancia}" é agora a instância principal para automações.`)
                              }}
                              className="p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors touch-manipulation"
                              title="Definir como principal"
                              aria-label="Definir como principal"
                            >
                              <Star className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleVerificarStatus(inst)}
                            disabled={verificando || !inst.hash}
                            className="p-2.5 rounded-lg border border-surface-200 bg-white text-stone-700 hover:bg-surface-100 transition-colors touch-manipulation disabled:opacity-60"
                            title="Verificar conexão"
                            aria-label="Verificar conexão"
                          >
                            {verificando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBuscarGrupos(inst)}
                            disabled={buscandoGruposId !== null || !inst.hash || !inst.conectado || Array.isArray(inst.grupos)}
                            className="p-2.5 rounded-lg border border-surface-200 bg-white text-stone-700 hover:bg-surface-100 transition-colors touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed"
                            title={Array.isArray(inst.grupos) ? 'Grupos já puxados' : 'Puxar grupos'}
                            aria-label={Array.isArray(inst.grupos) ? 'Grupos já puxados' : 'Puxar grupos'}
                          >
                            {buscandoGruposId === inst.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : Array.isArray(inst.grupos) ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Users className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExcluirInstancia(inst)}
                            className="p-2.5 rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-600 transition-colors touch-manipulation"
                            title="Excluir instância"
                            aria-label="Excluir instância"
                          >
                            <Trash2 className="w-4 h-4" />
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
            <p className="text-sm text-stone-500">Nenhuma instância ainda. Crie uma acima e escaneie o QR Code no popup.</p>
          )}
        </div>
      </section>

      {/* Webhook Kiwify */}
      <section className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-surface-200 bg-surface-50/80">
          <div className="flex items-center gap-2 text-stone-800">
            <Webhook className="w-5 h-5 text-primary-500 shrink-0" />
            <h2 className="text-base sm:text-lg font-semibold">Webhook</h2>
          </div>
          <p className="text-xs sm:text-sm text-stone-500 mt-1">
            Cada clique em &quot;Criar webhook Kiwify&quot; gera um <strong>novo</strong> webhook (não substitui os anteriores).
            Use a URL na Kiwify; os webhooks antigos continuam válidos.
          </p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
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
      </section>
    </div>
  )
}

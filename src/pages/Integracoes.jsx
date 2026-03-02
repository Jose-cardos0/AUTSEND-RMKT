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
  createWebhook,
  getWebhooks,
  updateWebhook,
  deleteWebhook,
} from '../lib/firestore'
import { criarInstancia, verificarStatus, buscarGrupos } from '../lib/evolutionApi'
import {
  Smartphone,
  QrCode,
  Users,
  Webhook,
  Copy,
  Check,
  Loader2,
  X,
  Trash2,
  Star,
} from 'lucide-react'

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
  const pollingRef = useRef(null)

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Integrações</h1>
        <p className="text-gray-500 mt-1">Evolution API, grupos e webhook Kiwify.</p>
      </div>

      {/* Modal QR Code — overlay preto/50 */}
      {showQrModal && qrBase64 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowQrModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-gray-500"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-800 pr-10">Conectar WhatsApp</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">Escaneie o QR Code com o WhatsApp (Dispositivos conectados).</p>
            <div className="flex justify-center p-4 bg-gray-50 rounded-xl">
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code WhatsApp"
                className="w-56 h-56 object-contain"
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
      <section className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-surface-200 bg-surface-50/50">
          <div className="flex items-center gap-2 text-gray-800">
            <Smartphone className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-semibold">Evolution API (WhatsApp)</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Crie uma instância e conecte seu WhatsApp para enviar mensagens.
          </p>
          <details className="mt-3 text-xs text-gray-600 bg-white/80 rounded-lg p-3 border border-surface-200">
            <summary className="cursor-pointer font-medium">O que o n8n precisa fazer (webhook Evolution)</summary>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li><strong>criar_instancia:</strong> chamar Evolution API para criar; responder com base64 do QR e hash/instanciaId.</li>
              <li><strong>verificar_status:</strong> chamar Evolution API para checar conexão; responder com <code className="bg-surface-200 px-0.5 rounded">{'{ conectado: true }'}</code> ou <code className="bg-surface-200 px-0.5 rounded">{'{ state: "open" }'}</code> quando conectado.</li>
              <li><strong>buscar_grupo:</strong> chamar Evolution API para listar grupos; responder com <code className="bg-surface-200 px-0.5 rounded">{'{ grupos: [...] }'}</code> ou <code className="bg-surface-200 px-0.5 rounded">{'{ groups: [...] }'}</code>.</li>
            </ul>
          </details>
        </div>
        <div className="p-6 space-y-6">
          <p className="text-sm font-medium text-gray-700">Adicionar nova instância</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome da instância</label>
              <input
                type="text"
                value={nomeInstancia}
                onChange={(e) => setNomeInstancia(e.target.value)}
                placeholder="minha_instancia"
                className="w-56 px-3 py-2 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número do WhatsApp</label>
              <input
                type="text"
                value={numeroWhatsapp}
                onChange={(e) => setNumeroWhatsapp(e.target.value)}
                placeholder="5511999999999"
                className="w-44 px-3 py-2 rounded-lg border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
             
            </div>
            <button
              onClick={handleCriarInstancia}
              disabled={criando}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
            >
              {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {criando ? 'Criando...' : 'Criar instância'}
            </button>
          </div>

          {instances.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Suas instâncias — selecione qual usar para automações e mensagens</p>
              <div className="space-y-3">
                {instances.map((inst) => {
                  const isPrincipal = selectedInstanceId === inst.id
                  const gruposInst = Array.isArray(inst.grupos) ? inst.grupos : (inst.grupos?.grupos ?? inst.grupos?.groups ?? [])
                  return (
                    <div
                      key={inst.id}
                      className={`p-4 rounded-xl border-2 transition ${isPrincipal ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-medium text-gray-800">{inst.nomeInstancia || 'Sem nome'}</span>
                        {inst.numeroWhatsapp && <span className="text-sm text-gray-500">{inst.numeroWhatsapp}</span>}
                        {isPrincipal && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                            <Star className="w-3 h-3" /> Principal (automações)
                          </span>
                        )}
                        {inst.conectado === true ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Conectado</span>
                        ) : inst.qrCodeBase64 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">Aguardando QR</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">Não conectado</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600"
                          >
                            <Star className="w-3.5 h-3.5" /> Usar para automações
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleVerificarStatus(inst)}
                          disabled={verificando || !inst.hash}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-50"
                        >
                          {verificando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Verificar conexão
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBuscarGrupos(inst)}
                          disabled={buscandoGruposId !== null || !inst.hash || !inst.conectado}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-sm hover:bg-surface-50 disabled:opacity-50"
                        >
                          {buscandoGruposId === inst.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                          Puxar grupos
                        </button>
                      </div>
                      {gruposInst.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-surface-200">
                          <p className="text-xs font-medium text-gray-600 mb-2">Grupos desta instância ({gruposInst.length})</p>
                          <div className="flex flex-wrap gap-2 max-h-24 overflow-auto">
                            {gruposInst.slice(0, 8).map((g, i) => (
                              <span key={g.id ?? i} className="px-2 py-1 rounded-lg bg-white border border-surface-200 text-xs truncate max-w-[140px]" title={g.nome ?? g.name ?? g.subject}>
                                {g.nome ?? g.name ?? g.subject ?? 'Sem nome'}
                              </span>
                            ))}
                            {gruposInst.length > 8 && <span className="text-xs text-gray-500">+{gruposInst.length - 8}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {instances.length === 0 && !evolution?.nomeInstancia && (
            <p className="text-sm text-gray-500">Nenhuma instância ainda. Crie uma acima e escaneie o QR Code no popup.</p>
          )}
        </div>
      </section>

      {/* Webhook Kiwify */}
      <section className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-surface-200 bg-surface-50/50">
          <div className="flex items-center gap-2 text-gray-800">
            <Webhook className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-semibold">Webhook Kiwify (Carrinho abandonado)</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Cada clique em &quot;Criar webhook Kiwify&quot; gera um <strong>novo</strong> webhook (não substitui os anteriores).
            Use a URL na Kiwify; os webhooks antigos continuam válidos.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <button
            onClick={handleCriarWebhookKiwify}
            disabled={criandoWebhook}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
          >
            {criandoWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
            {criandoWebhook ? 'Criando...' : 'Criar webhook Kiwify'}
          </button>

          {webhooks.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Seus webhooks</p>
              {webhooks.map((w) => {
                const url = w.webhookUrl ?? `https://us-central1-afiliadocdnx.cloudfunctions.net/kiwifyAbandonedCheckout?webhookId=${w.id}&userId=${user?.uid}`
                return (
                  <div
                    key={w.id}
                    className="p-3 rounded-lg bg-surface-50 border border-surface-200 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        defaultValue={w.nome || ''}
                        onBlur={(e) => handleSalvarNomeWebhook(w.id, e.target.value)}
                        placeholder="Ex: Webhook produto Kiwify"
                        className="flex-1 text-sm font-medium text-gray-800 bg-white border border-surface-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                      <button
                        onClick={() => handleExcluirWebhook(w.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600"
                        title="Excluir webhook"
                        type="button"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs text-gray-600 truncate">{url}</code>
                      <button
                        onClick={() => copyUrl(url, w.id)}
                        className="p-2 rounded-lg hover:bg-surface-200 text-gray-600 shrink-0"
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

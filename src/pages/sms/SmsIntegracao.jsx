import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { usePlano } from '../../lib/PlanoContext'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import MelhorarPlano from '../../components/MelhorarPlano'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  buscarNumerosSMS,
  criarCheckoutNumeroSMS,
  listarNumerosSMS,
  sincronizarNumerosSMS,
  cancelarNumeroSMS,
  excluirNumeroSMS,
  listarProvidersSMS,
  addProviderSMS,
  deleteProviderSMS,
  definirPrincipalSMS,
} from '../../lib/smsNumeros'
import {
  Phone, Star, Trash2, Loader2, X, Plus, Check, ShoppingCart,
  RefreshCw, AlertCircle, Lock, ChevronDown, Settings, CreditCard, Ban, KeyRound, Globe,
} from 'lucide-react'
import euaflag from '../../assets/euaflag.png'
import chipastron from '../../assets/chip/chipastron.png'
import usFlagBg from '../../assets/flags/us-flag.png'

const PRECO_MES = 'R$ 29,90/mês'

/** Formata +18005551234 → +1 (800) 555-1234 (visual). */
function formatarNumero(n) {
  const d = String(n || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return n
}

/** Seção recolhível — mesmo padrão do WhatsApp Integrações (marca faded no canto direito). */
function Secao({ title, icon: Icon, open, onToggle, children, bgImg, action }) {
  return (
    <div className="app-panel rounded-2xl overflow-hidden relative">
      {bgImg && (
        <img
          src={bgImg}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute right-0 top-0 -mr-6 -mt-6 w-32 h-32 object-contain opacity-50 z-0"
        />
      )}
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

export default function SmsIntegracao() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const { temFeature } = usePlano()
  const liberado = temFeature('smsDisparos')

  const [numeros, setNumeros] = useState([])
  const [provedores, setProvedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [secaoAberta, setSecaoAberta] = useState(true)
  const [secaoApi, setSecaoApi] = useState(false)
  const [novoApi, setNovoApi] = useState(false)
  const [formApi, setFormApi] = useState({ apiKey: '', from: '', messagingProfileId: '', nome: '' })
  const [salvandoApi, setSalvandoApi] = useState(false)

  const [popupOpen, setPopupOpen] = useState(false)
  const [disponiveis, setDisponiveis] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [selecionados, setSelecionados] = useState([]) // números marcados pra comprar
  const [comprando, setComprando] = useState(false) // criando o checkout
  const [acaoId, setAcaoId] = useState(null) // id em ação (principal/cancelar)
  const [gerenciar, setGerenciar] = useState(null) // número aberto no popup de gerenciar
  const [gerenciando, setGerenciando] = useState(null) // 'cancelar' | 'excluir' em andamento

  const carregar = async () => {
    try {
      const [rn, rp] = await Promise.all([listarNumerosSMS(), listarProvidersSMS().catch(() => ({ provedores: [] }))])
      setNumeros(rn?.numeros || [])
      setProvedores(rp?.provedores || [])
    } catch (_) {
      setNumeros([]); setProvedores([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user?.uid) return
    carregar()
    // Em background: sincroniza status (banido/restrito) com a Telnyx e atualiza os cards.
    sincronizarNumerosSMS()
      .then((r) => { if (r?.numeros) setNumeros(r.numeros) })
      .catch(() => {})
  }, [user?.uid])

  // Volta do checkout do Stripe (?compra=ok|cancelado)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const compra = params.get('compra')
    if (!compra) return
    if (compra === 'ok') {
      toast.success('Pagamento confirmado! Seu número está sendo ativado — aparece aqui em instantes.')
      setTimeout(carregar, 2500)
    } else if (compra === 'cancelado') {
      toast('Compra cancelada.', { icon: '↩️' })
    }
    // limpa a query da URL
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const abrirPopup = async () => {
    if (!liberado) { setUpgradeOpen(true); return }
    setSelecionados([])
    setPopupOpen(true)
    await buscar()
  }

  const buscar = async () => {
    setBuscando(true)
    try {
      const r = await buscarNumerosSMS()
      setDisponiveis(r?.numeros || [])
    } catch (err) {
      toast.error(err?.message || 'Falha ao buscar números disponíveis.')
      setDisponiveis([])
    } finally {
      setBuscando(false)
    }
  }

  const toggleSelecao = (numero) => {
    setSelecionados((prev) => prev.includes(numero) ? prev.filter((n) => n !== numero) : [...prev, numero])
  }

  const comprar = async () => {
    if (!selecionados.length) return
    setComprando(true)
    try {
      const r = await criarCheckoutNumeroSMS(selecionados)
      if (r?.url) {
        window.location.href = r.url // vai pro checkout do Stripe
      } else {
        toast.error('Não consegui abrir o checkout. Tente de novo.')
      }
    } catch (err) {
      toast.error(err?.message || 'Falha ao iniciar a compra.')
    } finally {
      setComprando(false)
    }
  }

  const definirPrincipal = async (tipo, id) => {
    setAcaoId(id)
    try {
      await definirPrincipalSMS(tipo, id)
      await carregar()
      toast.success('Remetente principal atualizado.')
    } catch (err) {
      toast.error(err?.message || 'Erro ao definir principal.')
    } finally {
      setAcaoId(null)
    }
  }

  const salvarApi = async () => {
    if (!formApi.apiKey.trim() || !formApi.from.trim()) { toast.error('Informe a API key e o número de envio.'); return }
    setSalvandoApi(true)
    try {
      await addProviderSMS(formApi)
      setFormApi({ apiKey: '', from: '', messagingProfileId: '', nome: '' })
      setNovoApi(false)
      await carregar()
      toast.success('Conta Telnyx conectada!')
    } catch (err) {
      toast.error(err?.message || 'Falha ao conectar a conta Telnyx.')
    } finally {
      setSalvandoApi(false)
    }
  }

  const excluirApi = async (p) => {
    if (!(await confirm({ title: `Remover "${p.nome}"?`, message: 'A conexão com essa conta Telnyx será removida do app (a conta na Telnyx não é afetada).', confirmLabel: 'Remover' }))) return
    setAcaoId(p.id)
    try {
      await deleteProviderSMS(p.id)
      await carregar()
      toast.success('Conta Telnyx removida.')
    } catch (err) {
      toast.error(err?.message || 'Erro ao remover.')
    } finally {
      setAcaoId(null)
    }
  }

  const cancelarAssinatura = async (n) => {
    setGerenciando('cancelar')
    try {
      await cancelarNumeroSMS(n.id)
      await carregar()
      setGerenciar(null)
      toast.success('Assinatura cancelada e número liberado.')
    } catch (err) {
      toast.error(err?.message || 'Erro ao cancelar a assinatura.')
    } finally {
      setGerenciando(null)
    }
  }

  const excluirChip = async (n) => {
    setGerenciando('excluir')
    try {
      await excluirNumeroSMS(n.id)
      await carregar()
      setGerenciar(null)
      toast.success('Chip excluído e número liberado na Telnyx.')
    } catch (err) {
      toast.error(err?.message || 'Erro ao excluir o chip.')
    } finally {
      setGerenciando(null)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell badge="SMS · Integração">
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      {/* Popup: gerenciar número (cancelar assinatura / excluir chip) */}
      {gerenciar && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => !gerenciando && setGerenciar(null)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-100 text-stone-600 shrink-0"><Settings className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-stone-800">Gerenciar número</h3>
                <p className="text-sm text-stone-500 tabular-nums truncate">{formatarNumero(gerenciar.numero)}</p>
              </div>
              <button onClick={() => !gerenciando && setGerenciar(null)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-2.5">
              {/* Cancelar assinatura */}
              <button
                type="button"
                onClick={() => cancelarAssinatura(gerenciar)}
                disabled={!!gerenciando}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-surface-200 hover:border-red-300 hover:bg-red-50/50 text-left transition disabled:opacity-60"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 shrink-0">
                  {gerenciando === 'cancelar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                </span>
                <span className="text-sm font-semibold text-stone-800">Cancelar assinatura</span>
              </button>

              {/* Excluir o chip */}
              <button
                type="button"
                onClick={() => excluirChip(gerenciar)}
                disabled={!!gerenciando}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-surface-200 hover:border-stone-300 hover:bg-surface-50 text-left transition disabled:opacity-60"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-stone-600 shrink-0">
                  {gerenciando === 'excluir' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </span>
                <span className="text-sm font-semibold text-stone-800">Excluir o chip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: mockup estilo tela de MacBook (80% largura × 90% altura) */}
      {popupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
          onClick={() => setPopupOpen(false)}
        >
          {/* Janela estilo Safari — 80% da tela */}
          <div
            className="relative w-[80vw] h-[80vh] max-w-[1200px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col ring-1 ring-black/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Área da tela (acima do rodapé) — a bandeira fica ancorada no fundo, atrás de tudo */}
            <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Bandeira decorativa — mastro colado no topo do rodapé, ATRÁS dos cards */}
              <img
                src={usFlagBg}
                alt=""
                aria-hidden="true"
                className="pointer-events-none select-none absolute left-0 bottom-0 w-72 sm:w-[26rem] opacity-50"
                style={{ zIndex: 0 }}
              />
              {/* Barra do navegador */}
              <div className="relative z-10 flex items-center gap-2 px-4 py-2.5 border-b border-surface-200 bg-surface-50 shrink-0">
                <span className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#28c840]" />
                </span>
                <div className="flex-1 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-surface-200 text-xs text-stone-500 max-w-[70%] truncate">
                    <Lock className="w-3 h-3" /> autsend.com.br · comprar número SMS
                  </span>
                </div>
                <button
                  onClick={() => setPopupOpen(false)}
                  className="p-1 text-stone-400 hover:text-stone-600"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Conteúdo */}
              <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 sm:px-10 py-8">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                  <img src={chipastron} alt="" className="w-14 h-14 object-contain shrink-0 drop-shadow-sm" />
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-stone-800">Comprar número de SMS</h2>
                    <p className="text-sm text-stone-500 flex items-center gap-1.5">
                      <img src={euaflag} alt="EUA" className="w-4 h-4 rounded-sm object-cover" />
                      EUA · <strong className="text-primary-600">{PRECO_MES}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-stone-700">
                    Números disponíveis <span className="font-normal text-stone-400">— toque pra selecionar</span>
                  </p>
                  <button
                    onClick={buscar}
                    disabled={buscando}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${buscando ? 'animate-spin' : ''}`} /> Atualizar
                  </button>
                </div>

                {buscando ? (
                  <div className="py-16 flex flex-col items-center justify-center text-stone-400 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <p className="text-sm">Buscando números disponíveis…</p>
                  </div>
                ) : disponiveis.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-stone-400 gap-2">
                    <AlertCircle className="w-6 h-6" />
                    <p className="text-sm">Nenhum número disponível agora. Tente atualizar.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {disponiveis.map((d) => {
                      const sel = selecionados.includes(d.numero)
                      return (
                        <button
                          key={d.numero}
                          type="button"
                          onClick={() => toggleSelecao(d.numero)}
                          className={`flex items-center gap-3 p-4 rounded-xl border text-left backdrop-blur-md shadow-sm transition ${
                            sel ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50/50' : 'border-white/60 bg-white/45 hover:border-primary-300 hover:bg-white/60'
                          }`}
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50/80 text-primary-600 shrink-0">
                            <Phone className="w-4 h-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-stone-800 tabular-nums whitespace-nowrap truncate">{formatarNumero(d.numero)}</p>
                          </div>
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 shrink-0 transition ${
                            sel ? 'bg-primary-600 border-primary-600 text-white' : 'border-surface-300 text-transparent'
                          }`}>
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* Rodapé — comprar os selecionados de uma vez */}
            <div className="relative z-10 shrink-0 border-t border-surface-200 bg-white px-5 sm:px-10 py-4 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-400 hidden sm:block">
                {selecionados.length > 0
                  ? `${selecionados.length} número(s) · ${PRECO_MES} cada. Checkout seguro do Stripe.`
                  : 'Selecione um ou mais números. Ativação automática após o pagamento.'}
              </p>
              <button
                onClick={comprar}
                disabled={!selecionados.length || comprando}
                className="btn-primary min-h-[44px] px-6 shrink-0 disabled:opacity-50"
              >
                {comprando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                {comprando ? 'Abrindo checkout…' : `Comprar${selecionados.length ? ` (${selecionados.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Secao
          title="SMS"
          icon={Phone}
          bgImg={chipastron}
          open={secaoAberta}
          onToggle={() => setSecaoAberta((v) => !v)}
          action={
            <button
              type="button"
              onClick={abrirPopup}
              className="btn-primary text-xs sm:text-sm min-h-[38px] px-3 shrink-0"
            >
              <Plus className="w-4 h-4" /> Comprar Número
            </button>
          }
        >
          {numeros.length === 0 ? (
            <div className="py-8 text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100 text-stone-400 mb-3">
                <Phone className="w-6 h-6" />
              </span>
              <p className="text-sm text-stone-600 font-medium">Você ainda não tem um número de SMS.</p>
              <button onClick={abrirPopup} className="btn-primary mt-4 min-h-[42px] px-5">
                <ShoppingCart className="w-4 h-4" /> Comprar meu primeiro número
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-stone-700">
                Selecione qual número usar como <strong>principal</strong> nos envios.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {numeros.map((n) => {
                  const isPrincipal = n.principal
                  const comErro = n.status === 'erro'
                  const banido = n.status === 'banido'
                  const restrito = n.status === 'restrito'
                  const bloqueado = restrito || banido
                  return (
                    <div
                      key={n.id}
                      className={`relative p-4 sm:p-5 rounded-xl border-2 transition ${
                        bloqueado ? 'border-red-300 bg-red-50'
                          : isPrincipal ? 'border-primary-500 bg-primary-50/50'
                          : 'border-surface-200 bg-surface-50'
                      }`}
                    >
                      {bloqueado ? (
                        <span className="absolute -top-2 right-3 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200 shadow-sm">
                          <Ban className="w-2.5 h-2.5" /> {banido ? 'Banido' : 'Restringido'}
                        </span>
                      ) : isPrincipal && (
                        <span className="absolute -top-2 right-3 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200 shadow-sm">
                          <Star className="w-2.5 h-2.5" /> Principal
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-stone-800 break-all tabular-nums flex items-center gap-1.5">
                            <img src={euaflag} alt="EUA" className="w-4 h-4 rounded-sm object-cover shrink-0" />
                            {formatarNumero(n.numero)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {bloqueado ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600"><Ban className="w-3 h-3" /> {banido ? 'Banido' : 'Restringido'}</span>
                            ) : comErro ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3 h-3" /> Falha na ativação</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Ativo</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!isPrincipal && !comErro && !bloqueado && (
                            <button
                              type="button"
                              onClick={() => definirPrincipal('numero', n.id)}
                              disabled={acaoId === n.id}
                              className="p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors touch-manipulation disabled:opacity-60"
                              title="Definir como principal"
                              aria-label="Definir como principal"
                            >
                              {acaoId === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setGerenciar(n)}
                            disabled={acaoId === n.id}
                            className="p-2.5 rounded-lg text-stone-500 hover:bg-surface-100 hover:text-stone-700 transition-colors touch-manipulation disabled:opacity-60"
                            title="Gerenciar número"
                            aria-label="Gerenciar número"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Secao>

        {/* Provedores (API's) — conta Telnyx PRÓPRIA do cliente (BYO) */}
        <Secao
          title="Provedores (API's)"
          icon={KeyRound}
          open={secaoApi}
          onToggle={() => setSecaoApi((v) => !v)}
          action={
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!liberado) { setUpgradeOpen(true); return } setSecaoApi(true); setNovoApi(true) }}
              className="btn-primary text-xs sm:text-sm min-h-[38px] px-3 shrink-0"
            >
              <Plus className="w-4 h-4" /> Conectar Telnyx
            </button>
          }
        >
          <p className="text-sm text-stone-500 mb-3">
            Use a <strong>sua própria conta Telnyx</strong> (API key + número). Os envios saem pela conta <strong>dela</strong> — com os números e limites <strong>dela</strong>, e sem consumir a cota do seu plano. Ideal pra volume alto ou números de outros países (BR, Alemanha…).
          </p>

          {novoApi && (
            <div className="mb-4 p-4 rounded-xl border border-surface-200 bg-surface-50/60 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Apelido</label>
                  <input value={formApi.nome} onChange={(e) => setFormApi((f) => ({ ...f, nome: e.target.value }))} placeholder="Minha conta Telnyx" className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-white text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Número de envio (E.164)</label>
                  <input value={formApi.from} onChange={(e) => setFormApi((f) => ({ ...f, from: e.target.value }))} placeholder="+5511999999999" className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-white text-sm min-h-[42px] tabular-nums" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">API Key da Telnyx</label>
                <input value={formApi.apiKey} onChange={(e) => setFormApi((f) => ({ ...f, apiKey: e.target.value }))} placeholder="KEY..." type="password" className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-white text-sm min-h-[42px]" />
                <p className="text-[11px] text-stone-400 mt-1">Fica guardada só na sua conta e é usada pelo servidor pra enviar. Pegue em Telnyx → API Keys.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Messaging Profile ID <span className="text-stone-400">(opcional)</span></label>
                <input value={formApi.messagingProfileId} onChange={(e) => setFormApi((f) => ({ ...f, messagingProfileId: e.target.value }))} placeholder="opcional" className="w-full px-3 py-2.5 rounded-xl border border-surface-200 bg-white text-sm min-h-[42px]" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={salvarApi} disabled={salvandoApi} className="btn-primary min-h-[42px] px-5 disabled:opacity-60">
                  {salvandoApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {salvandoApi ? 'Validando…' : 'Conectar'}
                </button>
                <button onClick={() => { setNovoApi(false); setFormApi({ apiKey: '', from: '', messagingProfileId: '', nome: '' }) }} className="min-h-[42px] px-4 rounded-xl border border-surface-200 text-sm text-stone-600 hover:bg-surface-100">Cancelar</button>
              </div>
            </div>
          )}

          {provedores.length === 0 && !novoApi ? (
            <div className="py-6 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-100 text-stone-400 mb-2"><KeyRound className="w-5 h-5" /></span>
              <p className="text-sm text-stone-500">Nenhuma conta Telnyx conectada. Clique em <strong>Conectar Telnyx</strong> pra usar a sua.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {provedores.map((p) => {
                const isPrincipal = p.principal
                return (
                  <div key={p.id} className={`relative p-4 sm:p-5 rounded-xl border-2 transition ${isPrincipal ? 'border-primary-500 bg-primary-50/50' : 'border-surface-200 bg-surface-50'}`}>
                    {isPrincipal && (
                      <span className="absolute -top-2 right-3 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200 shadow-sm">
                        <Star className="w-2.5 h-2.5" /> Principal
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-800 truncate flex items-center gap-1.5"><Globe className="w-4 h-4 text-primary-600 shrink-0" /> {p.nome}</p>
                        <p className="text-sm text-stone-500 mt-0.5 tabular-nums break-all">{p.from}</p>
                        <p className="text-[11px] text-stone-400 mt-1">key {p.apiKeyMasked}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isPrincipal && (
                          <button type="button" onClick={() => definirPrincipal('provider', p.id)} disabled={acaoId === p.id} className="p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors touch-manipulation disabled:opacity-60" title="Definir como principal" aria-label="Definir como principal">
                            {acaoId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                          </button>
                        )}
                        <button type="button" onClick={() => excluirApi(p)} disabled={acaoId === p.id} className="p-2.5 rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-600 transition-colors touch-manipulation disabled:opacity-60" title="Remover" aria-label="Remover">
                          {acaoId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Secao>
      </div>
    </PageShell>
  )
}

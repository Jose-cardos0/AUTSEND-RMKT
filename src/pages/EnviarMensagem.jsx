import { useState, useEffect, useCallback } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import { getEvolutionConfig, getInstances, getDisparos, setDisparo, updateDisparo, deleteDisparo } from '../lib/firestore'
import { enviarMensagemWhatsApp, normalizeNomeContato } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import TemplatePicker from '../components/TemplatePicker'
import { Send, Loader2, AlertCircle, Users, Download, Upload, Clock, History, Trash2, ChevronLeft, ChevronRight, ChevronDown, Check, MessageSquare, X } from 'lucide-react'
import PageShell from '../components/PageShell'
import WhatsAppIcon from '../components/WhatsAppIcon'
import excelImg from '../assets/excel.png'

const MINUTOS_POR_MENSAGEM = 5
const ITEMS_POR_PAGINA_TIMELINE = 5
const STORAGE_KEY = (uid) => `enviarMensagem_historico_${uid}`

function loadHistoricoLocal(uid) {
  if (!uid) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY(uid))
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export default function EnviarMensagem() {
  const [user] = useAuthState(auth)
  const [evolution, setEvolution] = useState(null)
  const [instances, setInstances] = useState([])
  const [instanciaId, setInstanciaId] = useState('')
  const [instOpen, setInstOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [lista, setLista] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [enviadosCount, setEnviadosCount] = useState(0)
  const [showNomeDisparoModal, setShowNomeDisparoModal] = useState(false)
  const [nomeDisparoInput, setNomeDisparoInput] = useState('')
  const [disparoAtual, setDisparoAtual] = useState(null)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [historico, setHistorico] = useState([])
  const [paginaTimeline, setPaginaTimeline] = useState(1)
  const [tick, setTick] = useState(0)
  const [confirmExcluir, setConfirmExcluir] = useState(null)

  useEffect(() => {
    if (!user?.uid) return
    getEvolutionConfig(user.uid).then(setEvolution)
    getInstances(user.uid).then(setInstances).catch(() => {})
  }, [user?.uid])

  // Instância padrão do disparo = a selecionada nas Integrações (ou a primeira)
  useEffect(() => {
    if (instanciaId || instances.length === 0) return
    const sel = evolution?.id && instances.find((i) => i.id === evolution.id)
    const byName = instances.find((i) => i.nomeInstancia === evolution?.nomeInstancia)
    setInstanciaId((sel || byName || instances[0]).id)
  }, [instances, evolution, instanciaId])

  const instanciaSelecionada = instances.find((i) => i.id === instanciaId) || evolution

  useEffect(() => {
    if (!user?.uid) return
    let cancelled = false
    getDisparos(user.uid).then((list) => {
      if (cancelled) return
      if (list.length > 0) {
        setHistorico(list)
        return
      }
      const local = loadHistoricoLocal(user.uid)
      if (local.length > 0) {
        setHistorico(local)
        local.forEach((item) => {
          const { disparoId, nomeDisparo, total, enviadosCount, status, endTime, createdAt } = item
          setDisparo(user.uid, disparoId, {
            nomeDisparo,
            total,
            enviadosCount: enviadosCount ?? 0,
            status: status ?? 'enviando',
            endTime: endTime ?? 0,
            createdAt: createdAt ?? Date.now(),
          }).catch(() => {})
        })
      }
    })
    return () => { cancelled = true }
  }, [user?.uid])

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // Quando o countdown chega a 0, marca o disparo como finalizado (local + Firebase)
  useEffect(() => {
    const now = Date.now()
    if (!user?.uid) return
    setHistorico((prev) => {
      const next = prev.map((item) =>
        item.status === 'enviando' && item.endTime <= now
          ? { ...item, status: 'finalizado' }
          : item
      )
      const changed = next.filter((item, i) => item !== prev[i])
      changed.forEach((item) => updateDisparo(user.uid, item.disparoId, { status: 'finalizado' }).catch(() => {}))
      return next.some((item, i) => item !== prev[i]) ? next : prev
    })
  }, [tick, user?.uid])

  const parseLista = (text) => {
    const lines = text
      .trim()
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.map((line) => {
      const normalized = line
        .replace(/\uFF0C/g, ',')
        .replace(/\uFF1B/g, ';')
        .replace(/\u3000/g, ' ')
      const parts = normalized.split(/[\t,;]/).map((p) => p.trim())
      const telefone = (parts[0] || '').replace(/\D/g, '') || parts[0]
      // Tudo após o primeiro separador vira nome (permite vírgula no nome: 55...,Silva, João)
      const nome = normalizeNomeContato(parts.slice(1).join(', '))
      return { telefone, nome }
    })
  }

  /** Primeira linha é cabeçalho se a coluna A não parece telefone (ex.: "Número", vazio). */
  const primeiraLinhaEhCabecalhoPlanilha = (row) => {
    if (!row || row.length === 0) return false
    const raw = row[0]
    const digits = String(raw ?? '').replace(/\D/g, '')
    return digits.length < 10
  }

  const handleBaixarExemplo = () => {
    const wsData = [
      ['Número', 'Nome'],
      ['5511999999999', 'Exemplo um'],
      ['5521988888888', 'João'],
      ['5531977777777', 'Maria'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos')
    XLSX.writeFile(wb, 'planilha_contatos_exemplo.xlsx')
    toast.success('Planilha exemplo: coluna A = número, coluna B = nome.')
  }

  const handleUploadExcel = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const firstSheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' })
        const lines = []
        let start = 0
        if (rows.length > 0 && primeiraLinhaEhCabecalhoPlanilha(rows[0])) start = 1
        for (let i = start; i < rows.length; i++) {
          const row = rows[i]
          const numRaw = row[0] != null ? String(row[0]).trim() : ''
          const nome = normalizeNomeContato(row[1] != null ? String(row[1]) : '')
          const telNorm = numRaw.replace(/\D/g, '')
          if (telNorm.length >= 8) {
            lines.push(`${telNorm},${nome}`)
          }
        }
        setLista(lines.join('\n'))
        toast.success(`${lines.length} contato(s) importado(s) (colunas A = número, B = nome — igual à lista manual).`)
      } catch (err) {
        toast.error('Erro ao ler planilha. Verifique se é um Excel válido.')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const iniciarEnvio = () => {
    const contatos = parseLista(lista)
    if (contatos.length === 0 || !mensagem.trim()) {
      setMsg({ type: 'error', text: 'Adicione pelo menos um número e escreva a mensagem.' })
      return
    }
    setShowNomeDisparoModal(true)
    setNomeDisparoInput('')
  }

  const atualizarItemHistorico = useCallback(
    (disparoId, patch) => {
      setHistorico((prev) => prev.map((item) => (item.disparoId === disparoId ? { ...item, ...patch } : item)))
      if (user?.uid) updateDisparo(user.uid, disparoId, patch).catch(() => {})
    },
    [user?.uid]
  )

  const confirmarEnvio = async () => {
    const nome = (nomeDisparoInput || '').trim() || `Disparo ${new Date().toLocaleString('pt-BR')}`
    setShowNomeDisparoModal(false)
    const contatos = parseLista(lista)
    const evolutionAtual = instances.find((i) => i.id === instanciaId) || (await getEvolutionConfig(user.uid))
    if (!evolutionAtual?.nomeInstancia || !evolutionAtual?.hash) {
      setMsg({ type: 'error', text: 'Nenhuma instância conectada. Conecte e selecione uma instância em Integrações.' })
      toast.error('Selecione uma instância em Integrações.')
      return
    }
    const disparoId = `disparo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const total = contatos.length
    const tempoMin = total * MINUTOS_POR_MENSAGEM
    const endTime = Date.now() + tempoMin * 60 * 1000
    const createdAt = Date.now()
    const novoItem = {
      disparoId,
      nomeDisparo: nome,
      total,
      enviadosCount: 0,
      status: 'enviando',
      endTime,
      createdAt,
    }
    setHistorico((prev) => [novoItem, ...prev])
    setDisparo(user.uid, disparoId, {
      nomeDisparo: nome,
      total,
      enviadosCount: 0,
      status: 'enviando',
      endTime,
      createdAt,
    }).catch(() => {})
    setDisparoAtual({ id: disparoId, nome, total })
    setEnviadosCount(0)
    setMsg({ type: '', text: '' })
    setMensagem('')
    let enviados = 0
    const TIMEOUT_MS = 90000
    const timeoutId = setTimeout(() => {
      setDisparoAtual(null)
      toast('O envio pode continuar em segundo plano. Acompanhe na linha do tempo.', { icon: 'ℹ️' })
    }, TIMEOUT_MS)
    try {
      const msgBase = mensagem.trim()
      // Um único POST: array completo no n8n (pausa de 5 min entre envios fica no fluxo n8n)
      await enviarMensagemWhatsApp(contatos, msgBase, evolutionAtual, {
        disparoId,
        nomeDisparo: nome,
        intervaloMinutos: MINUTOS_POR_MENSAGEM,
      })
      enviados = total
      setEnviadosCount(total)
      clearTimeout(timeoutId)
      atualizarItemHistorico(disparoId, { enviadosCount: total })
      setMsg({ type: 'success', text: `Enviado. Demorará ${tempoMin} min.` })
      toast.success(`Disparo "${nome}": ${total} contato(s). Tempo estimado: ${tempoMin} min.`)
    } catch (err) {
      clearTimeout(timeoutId)
      atualizarItemHistorico(disparoId, { status: 'erro', enviadosCount: enviados })
      setMsg({ type: 'error', text: err.message || 'Erro ao enviar mensagem' })
      toast.error(err.message || 'Erro ao enviar.')
    } finally {
      clearTimeout(timeoutId)
      setDisparoAtual(null)
    }
  }

  const contatos = parseLista(lista)
  const now = Date.now()
  const getRemainingMin = (endTime) => Math.max(0, Math.ceil((endTime - now) / 60000))
  // Mensagens que o n8n ainda não “enviou” (simulado: a cada 5 min diminui 1)
  const getRestantes = (item) => {
    if (item.status === 'cancelado' || item.status === 'finalizado') return item.total
    const start = item.createdAt || item.endTime - item.total * MINUTOS_POR_MENSAGEM * 60 * 1000
    const elapsedMin = (now - start) / (60 * 1000)
    const jaEnviadasPeloN8n = Math.min(item.total, Math.floor(elapsedMin / MINUTOS_POR_MENSAGEM))
    return Math.max(0, item.total - jaEnviadasPeloN8n)
  }
  const totalContatos = contatos.length
  const tempoEstimadoMin = totalContatos * MINUTOS_POR_MENSAGEM

  const totalPaginasTimeline = Math.max(1, Math.ceil(historico.length / ITEMS_POR_PAGINA_TIMELINE))
  const paginaAtual = Math.min(paginaTimeline, totalPaginasTimeline)
  const historicoPagina = historico.slice(
    (paginaAtual - 1) * ITEMS_POR_PAGINA_TIMELINE,
    paginaAtual * ITEMS_POR_PAGINA_TIMELINE
  )

  const handleExcluirDisparo = (disparoId, nomeDisparo) => {
    setConfirmExcluir({ disparoId, nomeDisparo })
  }

  const confirmarExcluirDisparo = async () => {
    if (!confirmExcluir) return
    const { disparoId, nomeDisparo } = confirmExcluir
    setConfirmExcluir(null)
    try {
      await deleteDisparo(user.uid, disparoId)
      setHistorico((prev) => prev.filter((item) => item.disparoId !== disparoId))
      setPaginaTimeline(1)
      toast.success('Disparo removido da linha do tempo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir.')
    }
  }

  return (
    <PageShell
      compact
      badge="WhatsApp"
      title="Disparos em massa"
      right={
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[280px] sm:max-w-none">
          <div className="rounded-2xl border border-surface-200/90 bg-white/90 backdrop-blur-sm px-3 py-2.5 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Contatos</p>
            <p className="text-lg font-bold text-stone-800 tabular-nums">{totalContatos}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5 text-center shadow-sm shadow-emerald-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">~min</p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums">{tempoEstimadoMin}</p>
          </div>
          <div className="rounded-2xl border border-primary-200/90 bg-gradient-to-br from-primary-50 to-white px-3 py-2.5 text-center shadow-sm shadow-primary-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Envios</p>
            <p className="text-lg font-bold text-primary-700 tabular-nums">{historico.length}</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col gap-2 -mt-2 sm:-mt-4">
      {instanciaSelecionada?.nomeInstancia && (
        instances.length > 1 ? (
          <button type="button" onClick={() => setInstOpen(true)} className="inline-flex items-center gap-2 self-start rounded-xl px-2.5 py-1.5 text-sm hover:bg-surface-100 transition">
            <WhatsAppIcon className="w-4 h-4 text-green-500 shrink-0" />
            <strong className="text-stone-800">{instanciaSelecionada.nomeInstancia}</strong>
            <ChevronDown className="w-4 h-4 text-stone-400" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 self-start px-2.5 py-1.5 text-sm">
            <WhatsAppIcon className="w-4 h-4 text-green-500 shrink-0" />
            <strong className="text-stone-800">{instanciaSelecionada.nomeInstancia}</strong>
          </span>
        )
      )}

      {instOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setInstOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100 text-green-600 shrink-0"><WhatsAppIcon className="w-4 h-4" /></span>
              <h3 className="text-base font-semibold text-stone-800">Instância do disparo</h3>
              <button onClick={() => setInstOpen(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-stone-500">Escolha qual instância vai enviar este disparo:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {instances.map((inst) => {
                const sel = inst.id === instanciaId
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => { setInstanciaId(inst.id); setInstOpen(false) }}
                    className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition bg-white ${sel ? 'border-primary-500' : 'border-surface-200 hover:border-primary-300'}`}
                  >
                    <WhatsAppIcon className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-stone-800 truncate">{inst.nomeInstancia}</span>
                      {inst.numeroWhatsapp && <span className="block text-[11px] text-stone-400 truncate">{inst.numeroWhatsapp}</span>}
                    </span>
                    {sel && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {msg.text && (
        <div
          className={`
            flex items-center gap-2 p-3 rounded-xl border text-sm
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="line-clamp-2">{msg.text}</span>
        </div>
      )}

      {(!instanciaSelecionada?.nomeInstancia || !instanciaSelecionada?.hash) && (
        <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/50 border border-amber-200/90 text-amber-900 text-xs sm:text-sm shadow-sm">
          Conecte uma instância em <strong>Integrações</strong> para enviar.
        </div>
      )}
      </div>

      {/* Popup: confirmar exclusão da linha do tempo */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" onClick={() => setConfirmExcluir(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-[95vw] sm:max-w-sm w-full p-4 sm:p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-stone-800 font-medium text-sm sm:text-base">Excluir &quot;{confirmExcluir.nomeDisparo}&quot; da linha do tempo?</p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
              <button type="button" onClick={() => setConfirmExcluir(null)} className="px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 hover:bg-surface-50 text-sm font-medium touch-manipulation">
                Cancelar
              </button>
              <button type="button" onClick={confirmarExcluirDisparo} className="px-4 py-2.5 min-h-[44px] rounded-xl bg-red-500 text-white hover:bg-red-600 text-sm font-medium touch-manipulation">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: nome do disparo */}
      {showNomeDisparoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" onClick={() => setShowNomeDisparoModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-[95vw] sm:max-w-md w-full p-4 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base sm:text-lg font-semibold text-stone-800">Nome do disparo</h3>
            <p className="text-xs sm:text-sm text-stone-500">Dê um nome para identificar este envio (ex: Campanha Black Friday).</p>
            <input
              type="text"
              value={nomeDisparoInput}
              onChange={(e) => setNomeDisparoInput(e.target.value)}
              placeholder="Ex: Campanha Black Friday"
              className="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-base"
              autoFocus
            />
            <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
              <button type="button" onClick={() => setShowNomeDisparoModal(false)} className="btn-secondary min-h-[44px] touch-manipulation">
                Voltar
              </button>
              <button type="button" onClick={confirmarEnvio} className="btn-primary min-h-[44px] touch-manipulation">
                Iniciar envio
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-stretch">
          <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg">
            <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-stone-800 shrink-0 mb-2 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 shrink-0 text-primary-600" />
                Mensagem
                <TemplatePicker onPick={setMensagem} label="Template" className="ml-auto text-xs min-h-[34px] py-1.5 px-2.5" />
              </h3>
              <MessageEditor
                value={mensagem}
                onChange={setMensagem}
                placeholder="Use {nome} — lista: número,nome"
                showNomeButton
                showCheckout
                fillHeight
                className="flex-1 min-h-[200px]"
              />
              {totalContatos > 0 && (
                <p className="mt-3 text-sm text-stone-600 shrink-0">
                  ~<strong>{tempoEstimadoMin} min</strong> · {totalContatos} contato(s)
                </p>
              )}
              <button
                onClick={iniciarEnvio}
                disabled={!lista.trim() || !mensagem.trim() || !instanciaSelecionada?.nomeInstancia}
                className="btn-primary mt-3 w-full py-2.5 min-h-[44px] touch-manipulation shrink-0 text-sm"
              >
                <Send className="w-4 h-4" />
                Enviar mensagem
              </button>
            </div>
          </aside>

          <div className="app-panel rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col flex-1 min-w-0">
            <div className="p-3 sm:p-4 border-b border-surface-200 shrink-0 flex items-center gap-2 text-stone-700">
              <Users className="w-4 h-4" />
              <p className="text-sm font-semibold">Lista de contatos</p>
            </div>
            <div className="p-3 sm:p-4 flex flex-col flex-1 min-w-0">
            <div className="relative flex flex-1 min-h-[200px]">
              <img src={excelImg} alt="" className="pointer-events-none absolute bottom-3 right-3 h-24 w-24 object-contain opacity-50 z-0 animate-float-soft" />
              <textarea
                value={lista}
                onChange={(e) => setLista(e.target.value)}
                placeholder={'5511999999999\n5521988888888,João\n5531977777777;Maria'}
                className="relative z-10 w-full flex-1 p-4 rounded-xl border border-surface-200 bg-transparent focus:border-surface-300 focus:ring-0 outline-none resize-y text-sm font-mono min-h-[200px]"
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={handleBaixarExemplo} className="btn-secondary text-sm py-2.5 min-h-[44px] px-4 touch-manipulation">
                <Download className="w-4 h-4" /> Exemplo Excel
              </button>
              <label className="btn-secondary text-sm py-2.5 min-h-[44px] px-4 cursor-pointer touch-manipulation flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" /> Subir Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
            </div>
          </div>
      </div>

      {historico.length > 0 && (
        <div className="app-panel rounded-2xl sm:rounded-3xl overflow-hidden w-full shadow-sm">
          <button type="button" onClick={() => setTimelineOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 px-5 py-4 sm:px-6 transition">
            <span className="text-base font-semibold text-stone-800 flex items-center gap-2">
              <History className="w-5 h-5 shrink-0 text-primary-600" />
              Linha do tempo
              <span className="text-xs font-normal text-stone-400">({historico.length})</span>
            </span>
            <ChevronDown className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${timelineOpen ? 'rotate-180' : ''}`} />
          </button>
          {timelineOpen && (
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <ul className="space-y-4">
            {historicoPagina.map((item) => {
              const remaining = getRemainingMin(item.endTime)
              const isAtual = disparoAtual?.id === item.disparoId
              const emEnvio = item.status === 'enviando' && remaining > 0
              const finalizado = item.status === 'finalizado' || (item.status === 'enviando' && remaining <= 0)
              const restantes = getRestantes(item)
              return (
                <li
                  key={item.disparoId}
                  className={`p-4 sm:p-4 rounded-xl border text-sm ${emEnvio ? 'bg-primary-50/50 border-primary-200' : item.status === 'cancelado' || item.status === 'erro' ? 'bg-red-50/50 border-red-200' : 'bg-surface-50 border-surface-200'} ${isAtual ? 'ring-2 ring-primary-300/60' : ''}`}
                >
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                    <div>
                      <span className="font-medium text-stone-800">{item.nomeDisparo}</span>
                      <span className="text-sm text-stone-500 ml-2">
                        {emEnvio ? (
                          <>{restantes}/{item.total} restantes · 1 a cada {MINUTOS_POR_MENSAGEM} min</>
                        ) : (
                          <>{item.enviadosCount}/{item.total} enviados</>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {emEnvio && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                          Enviando
                        </span>
                      )}
                      {finalizado && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Finalizado
                        </span>
                      )}
                      {item.status === 'cancelado' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Cancelado
                        </span>
                      )}
                      {item.status === 'erro' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Erro
                        </span>
                      )}
                      {item.status !== 'cancelado' && item.status !== 'erro' && (
                        <span className="inline-flex items-center gap-1 text-sm text-stone-600">
                          <Clock className="w-4 h-4" />
                          {remaining > 0 ? `Tempo restante: ${remaining} min` : 'Concluído'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExcluirDisparo(item.disparoId, item.nomeDisparo)}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors touch-manipulation"
                        title="Excluir da linha do tempo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {emEnvio && (
                    <div className="mt-3 flex gap-0.5">
                      {Array.from({ length: item.total }).map((_, i) => {
                        const enviadosNaBarra = item.total - restantes
                        return (
                          <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-sm min-w-[4px] ${i < enviadosNaBarra ? 'bg-green-500' : 'bg-surface-200'}`}
                          />
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {totalPaginasTimeline > 1 && (
            <div className="mt-6 pt-4 border-t border-surface-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
              <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">
                Página {paginaAtual} de {totalPaginasTimeline} · {historico.length} envio(s)
              </p>
              <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPaginaTimeline((p) => Math.max(1, p - 1))}
                  disabled={paginaAtual <= 1}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPaginaTimeline((p) => Math.min(totalPaginasTimeline, p + 1))}
                  disabled={paginaAtual >= totalPaginasTimeline}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          </div>
          )}
        </div>
      )}
      </div>
    </PageShell>
  )
}

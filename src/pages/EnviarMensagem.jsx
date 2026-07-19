import { useState, useEffect, useCallback } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import { getEvolutionConfig, getInstances, getDisparos, setDisparo, updateDisparo, deleteDisparo } from '../lib/firestore'
import { enviarMensagemWhatsApp, normalizeNomeContato } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import TemplatePicker from '../components/TemplatePicker'
import NichoPicker from '../components/NichoPicker'
import { Send, Loader2, AlertCircle, Users, Download, Upload, History, Trash2, ChevronLeft, ChevronRight, ChevronDown, Check, MessageSquare, X } from 'lucide-react'
import PageShell, { Panel } from '../components/PageShell'
import WhatsAppIcon from '../components/WhatsAppIcon'
import excelImg from '../assets/excel.png'

const MINUTOS_POR_MENSAGEM = 5
const ITEMS_POR_PAGINA_TIMELINE = 5
const STORAGE_KEY = (uid) => `enviarMensagem_historico_${uid}`

const WA_STATUS = {
  enviando: 'bg-blue-100 text-blue-700',
  finalizado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
  erro: 'bg-red-100 text-red-700',
}
const WA_STATUS_LABEL = { enviando: 'Enviando', finalizado: 'Finalizado', cancelado: 'Cancelado', erro: 'Erro' }
const formatDate = (ts) => {
  if (!ts) return '-'
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

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
  const [expandedWa, setExpandedWa] = useState(null)
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
      mensagem,
      total,
      enviadosCount: 0,
      status: 'enviando',
      endTime,
      createdAt,
    }
    setHistorico((prev) => [novoItem, ...prev])
    setDisparo(user.uid, disparoId, {
      nomeDisparo: nome,
      mensagem,
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
      setMsg({ type: 'success', text: 'Disparo iniciado.' })
      toast.success(`Disparo "${nome}" iniciado: ${total} contato(s).`)
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
      badge="WhatsApp · Disparos"
      title="Disparos em massa"
      right={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full max-w-[200px] sm:max-w-none">
          <div className="rounded-2xl border border-surface-200/90 bg-white/90 backdrop-blur-sm px-3 py-2.5 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Contatos</p>
            <p className="text-lg font-bold text-stone-800 tabular-nums">{totalContatos}</p>
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
              <NichoPicker tipo="whatsapp" className="min-h-[44px]" onPick={(linhas) => setLista((prev) => [prev.trim(), linhas.join('\n')].filter(Boolean).join('\n'))} />
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
        <Panel title="Histórico de disparos" icon={History} noPadding collapsible open={timelineOpen} onToggle={() => setTimelineOpen((v) => !v)}>
          <div className="divide-y divide-surface-100">
            {historicoPagina.map((item) => {
              const aberto = expandedWa === item.disparoId
              const remaining = getRemainingMin(item.endTime)
              const restantes = getRestantes(item)
              const emEnvio = item.status === 'enviando' && remaining > 0
              const statusView = item.status === 'enviando' && remaining <= 0 ? 'finalizado' : item.status
              const enviadosMostrar = emEnvio ? (item.total - restantes) : item.enviadosCount
              return (
                <div key={item.disparoId}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-4">
                    <button onClick={() => setExpandedWa(aberto ? null : item.disparoId)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">{item.nomeDisparo}</p>
                        <p className="text-xs text-stone-500">{formatDate(item.createdAt)}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-stone-600">{enviadosMostrar}/{item.total} enviados</span>
                      {item.entregues > 0 && <span className="text-xs text-emerald-600 font-medium">{item.entregues} entregue{item.entregues > 1 ? 's' : ''}</span>}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${WA_STATUS[statusView] || 'bg-stone-100 text-stone-600'}`}>
                        {WA_STATUS_LABEL[statusView] || statusView}
                      </span>
                      <button onClick={() => handleExcluirDisparo(item.disparoId, item.nomeDisparo)} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="px-4 pb-4">
                      <div className="text-xs text-stone-500 p-3 bg-surface-50 rounded-xl space-y-1">
                        <p className="text-stone-700 font-medium">Mensagem enviada:</p>
                        <p className="whitespace-pre-wrap break-words">{item.mensagem || '—'}</p>
                        {emEnvio && <p className="text-primary-600">Enviando 1 a cada {MINUTOS_POR_MENSAGEM} min · ~{remaining} min restantes</p>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {totalPaginasTimeline > 1 && (
            <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-600">Página {paginaAtual} de {totalPaginasTimeline} · {historico.length} campanha(s)</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPaginaTimeline((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPaginaTimeline((p) => Math.min(totalPaginasTimeline, p + 1))} disabled={paginaAtual >= totalPaginasTimeline} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Panel>
      )}
      </div>
    </PageShell>
  )
}

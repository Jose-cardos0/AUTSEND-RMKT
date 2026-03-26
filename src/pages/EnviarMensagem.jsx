import { useState, useEffect, useCallback } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import { getEvolutionConfig, getDisparos, setDisparo, updateDisparo, deleteDisparo } from '../lib/firestore'
import { enviarMensagemWhatsApp, normalizeNomeContato } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import { Send, Loader2, AlertCircle, UserPlus, Download, Upload, Clock, History, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import PageShell from '../components/PageShell'
import WhatsAppIcon from '../components/WhatsAppIcon'

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
  }, [user?.uid])

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
    const evolutionAtual = await getEvolutionConfig(user.uid)
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
      fill
      badge="WhatsApp"
      title="Disparos em massa"
      subtitle="Lista, Excel ou colagem — envio único ao n8n com intervalo entre mensagens."
    >
      {evolution?.nomeInstancia && (
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-primary-50 to-violet-50/60 border border-primary-200/80 text-primary-900 text-xs shadow-sm">
          <WhatsAppIcon className="w-4 h-4 shrink-0" />
          <span><strong>Instância selecionada (Integrações):</strong> {evolution.nomeInstancia}</span>
          {evolution.numeroWhatsapp && <span className="text-primary-600"> — {evolution.numeroWhatsapp}</span>}
        </div>
      )}

      {msg.text && (
        <div
          className={`
            shrink-0 flex items-center gap-2 p-2.5 rounded-xl border text-sm
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="line-clamp-2">{msg.text}</span>
        </div>
      )}

      {(!evolution?.nomeInstancia || !evolution?.hash) && (
        <div className="shrink-0 p-2.5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/50 border border-amber-200/90 text-amber-900 text-xs sm:text-sm shadow-sm">
          Conecte uma instância em <strong>Integrações</strong> para enviar.
        </div>
      )}

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

      <div
        className={`flex flex-1 min-h-0 gap-2 overflow-hidden min-w-0 ${historico.length > 0 ? 'flex-col lg:flex-row' : 'flex-col'}`}
      >
        <div className="flex flex-col flex-1 min-h-0 gap-2 min-w-0 lg:min-w-[48%] overflow-hidden">
          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
            <h3 className="text-sm font-semibold text-stone-800 shrink-0 mb-2">Mensagem</h3>
            <MessageEditor
              fillHeight
              className="flex-1 min-h-0"
              value={mensagem}
              onChange={setMensagem}
              placeholder="Use {nome} — lista: número,nome"
              showNomeButton
              rows={3}
            />
            {totalContatos > 0 && (
              <p className="mt-2 text-xs text-stone-600 shrink-0">
                ~<strong>{tempoEstimadoMin} min</strong> · {totalContatos} contato(s)
              </p>
            )}
            <button
              onClick={iniciarEnvio}
              disabled={!lista.trim() || !mensagem.trim() || !evolution?.nomeInstancia}
              className="btn-primary mt-2 w-full py-2.5 min-h-[44px] touch-manipulation shrink-0 text-sm"
            >
              <Send className="w-4 h-4" />
              Enviar mensagem
            </button>
          </div>

          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
            <h3 className="text-sm font-semibold text-stone-800 shrink-0 mb-1 flex items-center gap-2">
              <UserPlus className="w-4 h-4 shrink-0" />
              Lista de contatos
            </h3>
            <p className="text-[11px] text-stone-500 mb-2 shrink-0 line-clamp-3">
              Uma linha por contato: <strong className="text-stone-600">número</strong> ou <strong className="text-stone-600">número,nome</strong>. Excel: col. A número, B nome. Vários contatos no n8n:{' '}
              <code className="bg-surface-100 px-1 rounded">contatos[].mensagem</code> ou <code className="bg-surface-100 px-1 rounded">mensagens</code>.
            </p>
            <div className="flex flex-wrap gap-2 mb-2 shrink-0">
              <button type="button" onClick={handleBaixarExemplo} className="btn-secondary text-xs py-2 min-h-[40px] px-3 touch-manipulation">
                <Download className="w-3.5 h-3.5" /> Exemplo Excel
              </button>
              <label className="btn-secondary text-xs py-2 min-h-[40px] px-3 cursor-pointer touch-manipulation flex items-center justify-center gap-1">
                <Upload className="w-3.5 h-3.5" /> Subir Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
            <textarea
              value={lista}
              onChange={(e) => setLista(e.target.value)}
              placeholder={'5511999999999\n5521988888888,João\n5531977777777;Maria'}
              className="flex-1 min-h-0 w-full p-3 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-xs sm:text-sm font-mono overflow-y-auto scroll-y-soft min-h-[100px]"
            />
          </div>
        </div>

      {historico.length > 0 && (
        <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden lg:max-w-[min(520px,50%)]">
          <h3 className="text-sm font-semibold text-stone-800 shrink-0 mb-2 flex items-center gap-2">
            <History className="w-4 h-4 shrink-0" />
            Linha do tempo
          </h3>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft pr-0.5">
          <ul className="space-y-2">
            {historicoPagina.map((item) => {
              const remaining = getRemainingMin(item.endTime)
              const isAtual = disparoAtual?.id === item.disparoId
              const emEnvio = item.status === 'enviando' && remaining > 0
              const finalizado = item.status === 'finalizado' || (item.status === 'enviando' && remaining <= 0)
              const restantes = getRestantes(item)
              return (
                <li
                  key={item.disparoId}
                  className={`p-2.5 sm:p-3 rounded-xl border text-sm ${emEnvio ? 'bg-primary-50/50 border-primary-200' : item.status === 'cancelado' || item.status === 'erro' ? 'bg-red-50/50 border-red-200' : 'bg-surface-50 border-surface-200'} ${isAtual ? 'ring-2 ring-primary-300/60' : ''}`}
                >
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2 sm:gap-3">
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
          </div>
          {totalPaginasTimeline > 1 && (
            <div className="shrink-0 mt-2 pt-2 border-t border-surface-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2">
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
    </PageShell>
  )
}

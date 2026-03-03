import { useState, useEffect, useCallback } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import { getEvolutionConfig, getDisparos, setDisparo, updateDisparo, deleteDisparo } from '../lib/firestore'
import { enviarUmaMensagemLead } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import { Send, Loader2, AlertCircle, UserPlus, Smartphone, Download, Upload, Clock, History, Trash2 } from 'lucide-react'

const MINUTOS_POR_MENSAGEM = 5
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
      const parts = line.split(/[\t,;]/).map((p) => p.trim())
      const telefone = (parts[0] || '').replace(/\D/g, '') || parts[0]
      const nome = parts[1] || ''
      return { telefone, nome }
    })
  }

  const handleBaixarExemplo = () => {
    const wsData = [
      ['Cart Id', 'Type', 'Product name', 'Customer Name', 'Customer Email', 'Customer Document Number', 'Customer Phone', 'Creation Date', 'Checkout Link'],
      ['@hx20dzpx18131ndjw', 'producer', 'Jose', 'Allison J S Souza', 'erik15branca@gmail.com', '07499980595', '+5579998490493', '01/03/2020, 21:35', 'https://pay.kiwify.com.br/...'],
      ['@abc123', 'producer', 'Jose', 'teste real jos', 'kekocelular1599@gmail.com', '03830892128', '+5579999062401', '01/03/2026, 13:58', 'https://pay.kiwify.com.br/...'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, 'planilha_leads_exemplo.xlsx')
    toast.success('Planilha exemplo baixada. Use as colunas C (nome) e G (telefone).')
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
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          const colC = row[2] != null ? String(row[2]).trim() : ''
          const colG = row[6] != null ? String(row[6]).trim().replace(/\D/g, '') : ''
          if (colG) lines.push(`${colG},${colC}`)
        }
        setLista(lines.join('\n'))
        toast.success(`${lines.length} contato(s) importado(s) da planilha (coluna C = nome, G = telefone).`)
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
      for (let i = 0; i < contatos.length; i++) {
        await enviarUmaMensagemLead(contatos[i], mensagem.trim(), evolutionAtual, disparoId, nome)
        enviados++
        setEnviadosCount(enviados)
        atualizarItemHistorico(disparoId, { enviadosCount: enviados })
      }
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
      toast.success('Disparo removido da linha do tempo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Enviar mensagem</h1>
        <p className="text-gray-500 mt-1">
          Envie mensagens para uma lista de leads (números separados por linha ou importe planilha). Conecta ao webhook WhatsApp.
        </p>
      </div>

      {evolution?.nomeInstancia && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-primary-50 border border-primary-200 text-primary-800 text-sm">
          <Smartphone className="w-4 h-4 shrink-0" />
          <span><strong>Instância selecionada (Integrações):</strong> {evolution.nomeInstancia}</span>
          {evolution.numeroWhatsapp && <span className="text-primary-600"> — {evolution.numeroWhatsapp}</span>}
        </div>
      )}

      {msg.text && (
        <div
          className={`
            flex items-center gap-2 p-4 rounded-xl border
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{msg.text}</span>
        </div>
      )}

      {(!evolution?.nomeInstancia || !evolution?.hash) && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Conecte e selecione uma instância do WhatsApp em <strong>Integrações</strong> para enviar mensagens.
        </div>
      )}

      {/* Popup: confirmar exclusão da linha do tempo */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setConfirmExcluir(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-gray-800 font-medium">Excluir &quot;{confirmExcluir.nomeDisparo}&quot; da linha do tempo?</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirmExcluir(null)} className="px-4 py-2 rounded-lg border border-surface-200 hover:bg-surface-50 text-sm font-medium">
                Cancelar
              </button>
              <button type="button" onClick={confirmarExcluirDisparo} className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 text-sm font-medium">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: nome do disparo */}
      {showNomeDisparoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowNomeDisparoModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-800">Nome do disparo</h3>
            <p className="text-sm text-gray-500">Dê um nome para identificar este envio (ex: Campanha Black Friday).</p>
            <input
              type="text"
              value={nomeDisparoInput}
              onChange={(e) => setNomeDisparoInput(e.target.value)}
              placeholder="Ex: Campanha Black Friday"
              className="w-full px-4 py-2 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowNomeDisparoModal(false)} className="px-4 py-2 rounded-lg border border-surface-200 hover:bg-surface-50">
                Voltar
              </button>
              <button type="button" onClick={confirmarEnvio} className="px-4 py-2 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600">
                Iniciar envio
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Lista de contatos
          </h3>
          <p className="text-sm text-gray-500 mb-3">
            Um contato por linha. Formato: número ou número,nome. Ou importe planilha Excel (coluna C = nome, coluna G = telefone).
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button type="button" onClick={handleBaixarExemplo} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm font-medium hover:bg-surface-50">
              <Download className="w-4 h-4" /> Baixar planilha exemplo
            </button>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm font-medium hover:bg-surface-50 cursor-pointer">
              <Upload className="w-4 h-4" /> Subir planilha Excel
              <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
            </label>
          </div>
          <textarea
            value={lista}
            onChange={(e) => setLista(e.target.value)}
            placeholder={'5511999999999\n5521988888888,João\n5531977777777;Maria'}
            rows={12}
            className="w-full p-4 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-sm font-mono"
          />
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-3">Mensagem</h3>
            <MessageEditor
              value={mensagem}
              onChange={setMensagem}
              placeholder="Digite a mensagem que será enviada para todos os contatos..."
            />
            {totalContatos > 0 && (
              <p className="mt-3 text-sm text-gray-600">
                Tempo estimado total: <strong>{tempoEstimadoMin} min</strong> ({totalContatos} contato(s)).
              </p>
            )}
            <button
              onClick={iniciarEnvio}
              disabled={!lista.trim() || !mensagem.trim() || !evolution?.nomeInstancia}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Enviar mensagem
            </button>
          </div>
        </div>
      </div>

      {/* Histórico de envios — salvo em localStorage, countdown decrescente */}
      {historico.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <History className="w-4 h-4" />
            Linha do tempo de envios
          </h3>
          <ul className="space-y-3">
            {historico.map((item) => {
              const remaining = getRemainingMin(item.endTime)
              const isAtual = disparoAtual?.id === item.disparoId
              const emEnvio = item.status === 'enviando' && remaining > 0
              const finalizado = item.status === 'finalizado' || (item.status === 'enviando' && remaining <= 0)
              const restantes = getRestantes(item)
              return (
                <li
                  key={item.disparoId}
                  className={`p-4 rounded-xl border ${emEnvio ? 'bg-primary-50/50 border-primary-200' : item.status === 'cancelado' || item.status === 'erro' ? 'bg-red-50/50 border-red-200' : 'bg-surface-50 border-surface-200'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-gray-800">{item.nomeDisparo}</span>
                      <span className="text-sm text-gray-500 ml-2">
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
                        <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                          <Clock className="w-4 h-4" />
                          {remaining > 0 ? `Tempo restante: ${remaining} min` : 'Concluído'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExcluirDisparo(item.disparoId, item.nomeDisparo)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
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
      )}
    </div>
  )
}

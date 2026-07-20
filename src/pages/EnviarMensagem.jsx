import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth } from '../lib/firebase'
import { getEvolutionConfig, getInstances, getDisparos, setDisparo, updateDisparo, deleteDisparo, uploadCallAudio, saveAudioTemplate, iniciarDisparoWA } from '../lib/firestore'
import { enviarMensagemWhatsApp, normalizeNomeContato } from '../lib/mensagemApi'
import { uploadEmailAsset } from '../lib/storageAssets'
import MessageEditor from '../components/MessageEditor'
import TemplatePicker from '../components/TemplatePicker'
import NichoPicker from '../components/NichoPicker'
import ImageLibraryPicker from '../components/ImageLibraryPicker'
import AudioTemplatePicker from '../components/AudioTemplatePicker'
import AudioPlayer from '../components/AudioPlayer'
import { TEMPLATE_VARIABLES } from '../lib/constants'
import { Send, Loader2, AlertCircle, Users, Download, Upload, History, Trash2, ChevronLeft, ChevronRight, ChevronDown, Check, MessageSquare, X, Image as ImageLucide, AudioLines, Clock, CheckCircle2, XCircle } from 'lucide-react'
import StatCard from '../components/StatCard'
import PageShell, { Panel } from '../components/PageShell'
import WhatsAppIcon from '../components/WhatsAppIcon'
import excelImg from '../assets/excel.png'

const MINUTOS_POR_MENSAGEM = 5
const ITEMS_POR_PAGINA_TIMELINE = 5
const STORAGE_KEY = (uid) => `enviarMensagem_historico_${uid}`

const WA_STATUS = {
  enviando: 'bg-blue-100 text-blue-700',
  concluido: 'bg-green-100 text-green-700',
  finalizado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
  erro: 'bg-red-100 text-red-700',
}
const WA_STATUS_LABEL = { enviando: 'Enviando', concluido: 'Concluído', finalizado: 'Finalizado', cancelado: 'Cancelado', erro: 'Erro' }
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
  const [lightboxImg, setLightboxImg] = useState(null)
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
  // Anexos do disparo (imagem + áudio) — viram blocos no envio (WF4)
  const [imgAnexo, setImgAnexo] = useState(null)     // { src, name }
  const [audioAnexo, setAudioAnexo] = useState(null) // { url, nome, ext }
  const [imgOrigemOpen, setImgOrigemOpen] = useState(false)
  const [imgPickerOpen, setImgPickerOpen] = useState(false)
  const [enviandoImg, setEnviandoImg] = useState(false)
  const imgUpInputRef = useRef(null)
  const [audioOrigemOpen, setAudioOrigemOpen] = useState(false)
  const [audioPickerOpen, setAudioPickerOpen] = useState(false)
  const [enviandoAudio, setEnviandoAudio] = useState(false)
  const audioUpInputRef = useRef(null)
  const [iniciando, setIniciando] = useState(false) // enquanto o disparo é iniciado (callable)

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

  // Atualiza o progresso (enviados/falhas/status) enquanto houver disparo em andamento.
  const temDisparoAtivo = historico.some((h) => h.status === 'enviando')
  useEffect(() => {
    if (!user?.uid || !temDisparoAtivo) return
    const id = setInterval(() => { getDisparos(user.uid).then(setHistorico).catch(() => {}) }, 20000)
    return () => clearInterval(id)
  }, [user?.uid, temDisparoAtivo])

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

  // Imagem do computador: comprime (<1 MB) + salva na biblioteca e anexa.
  const subirImagemPc = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setEnviandoImg(true)
    try { const img = await uploadEmailAsset(user.uid, f); setImgAnexo(img); toast.success('Imagem anexada.') }
    catch (err) { toast.error(err.message || 'Erro ao enviar imagem') }
    finally { setEnviandoImg(false) }
  }

  // Áudio do computador: sobe pro Storage + salva na biblioteca de áudios (Templates → Áudio) e anexa.
  const subirAudioPc = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!/audio\/(mpeg|mp3|wav|x-wav)/.test(f.type) && !/\.(mp3|wav)$/i.test(f.name)) { toast.error('Escolha um MP3 ou WAV.'); return }
    if (f.size > 10 * 1024 * 1024) { toast.error('Áudio muito grande (máx. 10 MB).'); return }
    setEnviandoAudio(true)
    try {
      const ext = /\.wav$/i.test(f.name) ? 'wav' : 'mp3'
      const ct = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      const { url, path } = await uploadCallAudio(user.uid, f, ext, ct)
      const nome = f.name.replace(/\.[^.]+$/, '')
      await saveAudioTemplate(user.uid, null, { nome, audioUrl: url, storagePath: path, tipo: 'upload', ext })
      setAudioAnexo({ url, nome, ext })
      toast.success('Áudio anexado.')
    } catch (err) { toast.error(err.message || 'Erro ao enviar áudio') }
    finally { setEnviandoAudio(false) }
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
    if (!evolutionAtual?.nomeInstancia || !evolutionAtual?.conectado) {
      setMsg({ type: 'error', text: 'Nenhuma instância conectada. Conecte e selecione uma instância em Integrações.' })
      toast.error('Selecione uma instância em Integrações.')
      return
    }
    setMsg({ type: '', text: '' })
    setIniciando(true)
    try {
      const r = await iniciarDisparoWA({
        sessao: evolutionAtual.nomeInstancia,
        nomeDisparo: nome,
        mensagem: mensagem.trim(),
        imagemUrl: imgAnexo?.src || null,
        audioUrl: audioAnexo?.url || null,
        contatos: contatos.map((c) => ({ telefone: c.telefone, nome: c.nome })),
      })
      setMensagem(''); setImgAnexo(null); setAudioAnexo(null); setLista('')
      setHistorico(await getDisparos(user.uid))
      setTimelineOpen(true)
      setMsg({ type: 'success', text: `Disparo iniciado: ${r.total} contato(s).` })
      toast.success(`Disparo "${nome}" iniciado: ${r.total} contato(s).`)
    } catch (err) {
      const ocupada = (err?.message || '').includes('instancia_ocupada')
      const txt = ocupada
        ? 'Essa instância já tem um disparo em andamento. Espere ele terminar pra iniciar outro.'
        : (err?.message || 'Erro ao iniciar o disparo.')
      setMsg({ type: 'error', text: txt })
      toast.error(txt)
    } finally {
      setIniciando(false)
    }
  }

  const contatos = parseLista(lista)
  const totalContatos = contatos.length
  const totalEnviados = historico.reduce((s, h) => s + (h.enviados ?? h.enviadosCount ?? 0), 0)
  const totalErros = historico.reduce((s, h) => s + (h.falhas ?? 0), 0)

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 w-full max-w-[220px] lg:max-w-[540px]">
          <StatCard label="Contatos" value={totalContatos} icon={Users} color="blue" />
          <StatCard label="Enviados" value={totalEnviados} icon={CheckCircle2} color="green" />
          <StatCard label="Erros" value={totalErros} icon={XCircle} color="red" />
          <StatCard label="Campanhas" value={historico.length} icon={Send} color="purple" />
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

      {(!instanciaSelecionada?.nomeInstancia || !instanciaSelecionada?.conectado) && (
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
          <aside className="relative flex flex-col flex-1 min-w-0">
            <MessageEditor
              value={mensagem}
              onChange={setMensagem}
              placeholder="Use {nome_cliente} — lista: número,nome"
              showChaves
              chavesVars={TEMPLATE_VARIABLES.filter((v) => v.key === '{nome_cliente}' || v.key === '{numero_cliente}')}
              showCheckout
              fillHeight
              className="flex-1 min-h-[260px]"
              textareaClassName="pb-16"
              toolbarBeforeEmoji={<TemplatePicker onPick={setMensagem} iconOnly label="Template" />}
              toolbarExtra={
                <>
                  <button type="button" onClick={() => setImgOrigemOpen(true)} title="Anexar imagem" className={`p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors ${imgAnexo ? 'text-primary-600 bg-primary-50' : 'text-stone-500 hover:text-stone-700 hover:bg-surface-200'}`}>
                    <ImageLucide className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setAudioOrigemOpen(true)} title="Anexar áudio" className={`p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors ${audioAnexo ? 'text-primary-600 bg-primary-50' : 'text-stone-500 hover:text-stone-700 hover:bg-surface-200'}`}>
                    <AudioLines className="w-4 h-4" />
                  </button>
                </>
              }
            />

            {/* Prévia dos anexos: flutuante no canto inferior esquerdo */}
            {(imgAnexo || audioAnexo) && (
              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2">
                {imgAnexo && (
                  <div className="relative">
                    <img src={imgAnexo.src} alt="" className="h-12 w-12 rounded-lg object-cover border border-surface-200 shadow-sm" />
                    <button onClick={() => setImgAnexo(null)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-700 text-white hover:bg-red-600 shadow" title="Remover"><X className="w-3 h-3" /></button>
                  </div>
                )}
                {audioAnexo && (
                  <div className="relative flex items-center gap-2 h-12 px-3 rounded-lg border border-surface-200 bg-white/95 shadow-sm">
                    <AudioLines className="w-4 h-4 text-primary-600 shrink-0" />
                    <span className="text-xs text-stone-700 max-w-[110px] truncate">{audioAnexo.nome || 'Áudio'}</span>
                    <button onClick={() => setAudioAnexo(null)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-700 text-white hover:bg-red-600 shadow" title="Remover"><X className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
            )}

            {/* Botão enviar: ícone flutuante no canto inferior direito */}
            <button
              onClick={iniciarEnvio}
              disabled={!lista.trim() || !mensagem.trim() || !instanciaSelecionada?.nomeInstancia || iniciando}
              title={iniciando ? 'Iniciando…' : 'Enviar mensagem'}
              className={`absolute bottom-3 right-3 z-20 h-11 w-11 flex items-center justify-center rounded-xl shadow-sm transition-colors ${
                iniciando
                  ? 'bg-primary-50 text-primary-600'
                  : 'bg-surface-100 text-stone-500 hover:bg-primary-600 hover:text-white disabled:opacity-40 disabled:hover:bg-surface-100 disabled:hover:text-stone-500'
              }`}
            >
              {iniciando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </aside>

          <div className="border border-surface-200/90 rounded-2xl sm:rounded-3xl overflow-hidden bg-white shadow-inner shadow-slate-200/40 ring-1 ring-white/80 flex flex-col shrink-0 min-w-0 lg:w-[min(400px,34vw)] lg:max-w-md">
            <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-surface-200/80 bg-gradient-to-r from-surface-50/90 to-primary-50/30 flex-wrap">
              <Users className="w-4 h-4 text-primary-600 shrink-0" />
              <span className="text-sm font-semibold text-stone-800">Lista de contatos</span>
              <div className="ml-auto flex items-center gap-0.5">
                <NichoPicker tipo="whatsapp" iconOnly label="Nicho" onPick={(linhas) => setLista((prev) => [prev.trim(), linhas.join('\n')].filter(Boolean).join('\n'))} />
                <button type="button" onClick={handleBaixarExemplo} title="Baixar exemplo Excel" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation">
                  <Download className="w-4 h-4" />
                </button>
                <label title="Subir Excel" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
                </label>
              </div>
            </div>
            <div className="relative flex flex-1 min-h-[150px]">
              <img src={excelImg} alt="" className="pointer-events-none absolute bottom-3 right-3 h-24 w-24 object-contain opacity-50 z-0 animate-float-soft" />
              <textarea
                value={lista}
                onChange={(e) => setLista(e.target.value)}
                placeholder={'5511999999999\n5521988888888,João\n5531977777777;Maria'}
                className="relative z-10 w-full flex-1 p-4 bg-transparent resize-none focus:ring-0 focus:outline-none text-sm font-mono min-h-[150px] placeholder:text-stone-400 text-stone-800"
              />
            </div>
          </div>
      </div>

      {/* Aviso de intervalo + propaganda Fireon */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl border border-surface-200 bg-surface-50/60">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <Clock className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
          <p className="text-xs text-stone-600 leading-relaxed">As mensagens são enviadas em <strong>intervalos de 1 a 5 minutos</strong> pra imitar um envio humano e reduzir o risco de bloqueio.</p>
        </div>
        <a href="https://fireon.com.br" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5 rounded-xl border border-surface-200 bg-white px-3 py-2 hover:border-primary-300 hover:shadow-sm transition shrink-0">
          <img src="https://www.fireon.com.br/assets/logo2-ChO_Qgix.png" alt="Fireon" className="h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <span className="text-[11px] text-stone-600 leading-tight">Levou ban? <strong className="text-stone-800">Aqueça seus números no Fireon</strong> <span className="text-primary-600 group-hover:underline">→</span></span>
        </a>
      </div>

      {historico.length > 0 && (
        <Panel title="Histórico de disparos" icon={History} noPadding collapsible open={timelineOpen} onToggle={() => setTimelineOpen((v) => !v)}>
          <div className="divide-y divide-surface-100">
            {historicoPagina.map((item) => {
              const aberto = expandedWa === item.disparoId
              const enviados = item.enviados ?? item.enviadosCount ?? 0
              const falhas = item.falhas ?? 0
              const status = item.status || 'enviando'
              return (
                <div key={item.disparoId}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-4">
                    <button onClick={() => setExpandedWa(aberto ? null : item.disparoId)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">{item.nomeDisparo}</p>
                        <p className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap">
                          <span>{formatDate(item.createdAt)}</span>
                          {item.sessao && (
                            <span className="inline-flex items-center gap-1 text-stone-600 max-w-[160px]">
                              <span className="text-stone-300">·</span>
                              <WhatsAppIcon className="w-3 h-3 text-green-600 shrink-0" />
                              <span className="truncate">{item.sessao}</span>
                            </span>
                          )}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      {item.imagemUrl && <ImageLucide className="w-3.5 h-3.5 text-stone-400 shrink-0" title="Imagem anexada" />}
                      {item.audioUrl && <AudioLines className="w-3.5 h-3.5 text-stone-400 shrink-0" title="Áudio anexado" />}
                      <span className="text-xs text-stone-600">{enviados}/{item.total} enviados</span>
                      {falhas > 0 && <span className="text-xs text-red-500 font-medium">{falhas} falha{falhas > 1 ? 's' : ''}</span>}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${WA_STATUS[status] || 'bg-stone-100 text-stone-600'}`}>
                        {WA_STATUS_LABEL[status] || status}
                      </span>
                      <button onClick={() => handleExcluirDisparo(item.disparoId, item.nomeDisparo)} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="px-4 pb-4 space-y-3">
                      <div className="text-xs text-stone-500 p-3 bg-surface-50 rounded-xl space-y-1">
                        <p className="text-stone-700 font-medium">Mensagem enviada:</p>
                        <p className="whitespace-pre-wrap break-words">{item.mensagem || '—'}</p>
                      </div>
                      {(item.imagemUrl || item.audioUrl) && (
                        <div className="flex flex-wrap items-center gap-3">
                          {item.imagemUrl && (
                            <button type="button" onClick={() => setLightboxImg(item.imagemUrl)} className="group relative w-16 h-16 rounded-xl overflow-hidden shrink-0" title="Ver imagem">
                              <img src={item.imagemUrl} alt="Imagem do disparo" className="w-full h-full object-cover" />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                                <ImageLucide className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </span>
                            </button>
                          )}
                          {item.audioUrl && (
                            <AudioPlayer src={item.audioUrl} className="w-[320px] max-w-full" />
                          )}
                        </div>
                      )}
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

      {/* Pickers de anexo */}
      <ImageLibraryPicker uid={user?.uid} open={imgPickerOpen} onClose={() => setImgPickerOpen(false)} onPick={(img) => setImgAnexo(img)} currentSrc={imgAnexo?.src} />
      <AudioTemplatePicker uid={user?.uid} open={audioPickerOpen} onClose={() => setAudioPickerOpen(false)} onPick={(t) => setAudioAnexo({ url: t.audioUrl, nome: t.nome, ext: t.ext })} currentId={null} />
      <input ref={imgUpInputRef} type="file" accept="image/*" onChange={subirImagemPc} className="hidden" />
      <input ref={audioUpInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav" onChange={subirAudioPc} className="hidden" />

      {/* Lightbox da imagem do disparo */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/80" onClick={() => setLightboxImg(null)}>
          <button type="button" onClick={() => setLightboxImg(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" title="Fechar"><X className="w-5 h-5" /></button>
          <img src={lightboxImg} alt="Imagem do disparo" className="max-w-full max-h-full rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Popup: origem da imagem (Biblioteca / Computador) */}
      {imgOrigemOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setImgOrigemOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ImageLucide className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Anexar imagem</h3>
              <button onClick={() => setImgOrigemOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <button type="button" onClick={() => { setImgOrigemOpen(false); setImgPickerOpen(true) }} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><ImageLucide className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-stone-800">Da biblioteca</span>
            </button>
            <button type="button" onClick={() => { setImgOrigemOpen(false); imgUpInputRef.current?.click() }} disabled={enviandoImg} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition disabled:opacity-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">{enviandoImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</span>
              <span className="text-sm font-medium text-stone-800">Do computador (máx 1 MB)</span>
            </button>
          </div>
        </div>
      )}

      {/* Popup: origem do áudio (Template / Computador) */}
      {audioOrigemOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setAudioOrigemOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><AudioLines className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Anexar áudio</h3>
              <button onClick={() => setAudioOrigemOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <button type="button" onClick={() => { setAudioOrigemOpen(false); setAudioPickerOpen(true) }} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><AudioLines className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-stone-800">Dos meus templates</span>
            </button>
            <button type="button" onClick={() => { setAudioOrigemOpen(false); audioUpInputRef.current?.click() }} disabled={enviandoAudio} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition disabled:opacity-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">{enviandoAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</span>
              <span className="text-sm font-medium text-stone-800">Do computador (MP3/WAV)</span>
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}

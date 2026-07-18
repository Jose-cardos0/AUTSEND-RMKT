import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth, functions } from '../../lib/firebase'
import { getSmsDisparos, deleteSmsDisparo } from '../../lib/firestore'
import { usePlano } from '../../lib/PlanoContext'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import NichoPicker from '../../components/NichoPicker'
import ChavesPicker from '../../components/ChavesPicker'
import MelhorarPlano from '../../components/MelhorarPlano'
import { Send, Loader2, Upload, Download, Users, History, Trash2, AlertCircle, MessageSquare, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import excelImg from '../../assets/excel.png'

/** Normaliza pra E.164 (espelho do backend). Rejeita BR (+55) salvo permitirBR (conta própria/API). */
function normalizarE164Internacional(raw, permitirBR) {
  let s = String(raw || '').trim()
  const temMais = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false, motivo: 'vazio' }
  if (!temMais && d.length === 10) d = '1' + d
  if (!permitirBR && d.startsWith('55')) return { ok: false, motivo: 'brasil' }
  if (d.length < 8 || d.length > 15) return { ok: false, motivo: 'tamanho' }
  return { ok: true, e164: '+' + d }
}

/** Cada linha: "numero" ou "numero,nome". */
function parseLista(text, permitirBR) {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\t,;]/).map((p) => p.trim()).filter(Boolean)
      const numero = parts[0] || ''
      const nome = parts.slice(1).join(' ').trim()
      const norm = normalizarE164Internacional(numero, permitirBR)
      return { numero, telefone: norm.ok ? norm.e164 : '', nome, ok: norm.ok, motivo: norm.motivo }
    })
    .filter((r) => r.numero)
}

const STATUS = {
  enviado: 'bg-green-100 text-green-700',
  enviando: 'bg-blue-100 text-blue-700',
  parcial: 'bg-amber-100 text-amber-700',
  erro: 'bg-red-100 text-red-700',
}

export default function SmsDisparos() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = ['api', 'brl'].includes(canalParam) ? canalParam : 'eua'
  const { temFeature, limiteDe } = usePlano()
  const podeSms = temFeature('smsDisparos') && (canal === 'api' || canal === 'brl' || limiteDe('smsMes') > 0)

  const [loading, setLoading] = useState(true)
  const [historico, setHistorico] = useState([])
  const [mensagem, setMensagem] = useState('')
  const [nomeDisparo, setNomeDisparo] = useState('')
  const [showNomeModal, setShowNomeModal] = useState(false)
  const [lista, setLista] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Ritmo de envio fixo (config do admin — ultra segurança, não exposto ao usuário).
  const loteSize = 50
  const intervaloMin = 5
  const [pHist, setPHist] = useState(1)
  const [expanded, setExpanded] = useState(null)
  const [histOpen, setHistOpen] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    setLoading(true)
    getSmsDisparos(user.uid, canal)
      .then((disp) => setHistorico(disp))
      .finally(() => setLoading(false))
  }, [user?.uid, canal])

  const linhas = useMemo(() => parseLista(lista, canal === 'api' || canal === 'brl'), [lista, canal])
  const validos = useMemo(() => linhas.filter((l) => l.ok), [linhas])
  const brExcluidos = useMemo(() => linhas.filter((l) => l.motivo === 'brasil').length, [linhas])

  // Consumo estimado (SMS ≈ 160 chars por segmento)
  const segmentos = Math.max(1, Math.ceil((mensagem.length || 1) / 160))

  const handleUploadExcel = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
        const out = []
        for (const row of rows) {
          const numero = String(row[0] ?? '').trim()
          const nome = String(row[1] ?? '').trim()
          if (numero.replace(/\D/g, '')) out.push(nome ? `${numero},${nome}` : numero)
        }
        setLista((prev) => (prev ? prev + '\n' : '') + out.join('\n'))
        toast.success(`${out.length} número(s) importado(s) (coluna A = número com DDI, B = nome).`)
      } catch {
        toast.error('Erro ao ler a planilha.')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const handleBaixarExemplo = () => {
    const ws = XLSX.utils.aoa_to_sheet([['Numero (com DDI)', 'Nome'], ['+14155552671', 'John'], ['+442079460958', 'Mary']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos')
    XLSX.writeFile(wb, 'lista_sms_exemplo.xlsx')
  }

  const iniciarEnvio = () => {
    if (!mensagem.trim()) { toast.error('Escreva a mensagem do SMS.'); return }
    if (validos.length === 0) { toast.error('Adicione ao menos um número internacional válido.'); return }
    setShowNomeModal(true)
  }

  const handleEnviar = async () => {
    if (!mensagem.trim()) { toast.error('Escreva a mensagem do SMS.'); return }
    if (validos.length === 0) { toast.error('Adicione ao menos um número internacional válido.'); return }
    setShowNomeModal(false)
    setEnviando(true)
    try {
      const sendBulk = httpsCallable(functions, 'sendBulkSMS')
      const res = await sendBulk({
        mensagem: mensagem.trim(),
        nomeDisparo: nomeDisparo.trim() || `SMS ${new Date().toLocaleDateString('pt-BR')}`,
        recipients: validos.map((v) => ({ telefone: v.telefone, nome: v.nome })),
        loteSize,
        intervaloMin,
        canal,
      })
      const { enviados, total, lotes, ignoradosBR } = res.data || {}
      if (lotes > 1) {
        toast.success(`Iniciado: ${enviados}/${total} no 1º lote. O resto sai em segundo plano.`)
      } else {
        toast.success(`SMS enviado: ${enviados}/${total}.`)
      }
      if (ignoradosBR > 0) toast(`${ignoradosBR} número(s) do Brasil foram ignorados (SMS só internacional).`, { icon: '🇧🇷' })
      setLista('')
      setNomeDisparo('')
      setHistorico(await getSmsDisparos(user.uid, canal))
    } catch (err) {
      toast.error(err.message || 'Falha no disparo.')
    } finally {
      setEnviando(false)
    }
  }

  const handleExcluir = async (id) => {
    try {
      await deleteSmsDisparo(user.uid, id)
      setHistorico((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir.')
    }
  }

  const formatDate = (ts) => {
    if (!ts) return '-'
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const HIST_POR_PAGINA = 10
  const totalPagHist = Math.max(1, Math.ceil(historico.length / HIST_POR_PAGINA))
  const pagHistAtual = Math.min(pHist, totalPagHist)
  const historicoPagina = historico.slice((pagHistAtual - 1) * HIST_POR_PAGINA, pagHistAtual * HIST_POR_PAGINA)

  return (
    <PageShell
      compact
      badge={`SMS · Disparos · ${canal === 'api' ? "API's" : canal === 'brl' ? 'Brasil' : 'EUA'}`}
      title="Disparos de SMS"
      right={
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[280px] sm:max-w-none">
          <div className="rounded-2xl border border-surface-200/90 bg-white/90 backdrop-blur-sm px-3 py-2.5 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Válidos</p>
            <p className="text-lg font-bold text-stone-800 tabular-nums">{validos.length}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5 text-center shadow-sm shadow-emerald-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Segmentos</p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums">{segmentos}</p>
          </div>
          <div className="rounded-2xl border border-primary-200/90 bg-gradient-to-br from-primary-50 to-white px-3 py-2.5 text-center shadow-sm shadow-primary-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Envios</p>
            <p className="text-lg font-bold text-primary-700 tabular-nums">{historico.length}</p>
          </div>
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-5">
      {showNomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" onClick={() => setShowNomeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-[95vw] sm:max-w-md w-full p-4 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base sm:text-lg font-semibold text-stone-800">Nome do disparo</h3>
            <input
              type="text"
              value={nomeDisparo}
              onChange={(e) => setNomeDisparo(e.target.value)}
              placeholder={canal === 'brl' ? 'Ex: Black Friday BR' : 'Ex: Black Friday US'}
              className="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-base"
              autoFocus
            />
            <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
              <button type="button" onClick={() => setShowNomeModal(false)} className="btn-secondary min-h-[44px] touch-manipulation">Voltar</button>
              <button type="button" onClick={handleEnviar} disabled={enviando} className="btn-primary min-h-[44px] touch-manipulation">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Iniciar envio
              </button>
            </div>
          </div>
        </div>
      )}
      {!podeSms && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1">Seu plano não inclui SMS. Faça upgrade para disparar SMS internacional.</span>
          <MelhorarPlano label="Ver planos" className="shrink-0" />
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch">
        {/* Config do disparo */}
        <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg">
          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-stone-800 shrink-0 mb-3 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 shrink-0 text-primary-600" />
              Mensagem
            </h3>
            <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-stone-600">Texto do SMS</label>
                <ChavesPicker onPick={(chave) => setMensagem((m) => m + chave)} />
              </div>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder={'Ex.: Autsend: sua oferta expira hoje! {nome_cliente}, garanta: https://...'}
                className="w-full flex-1 min-h-[120px] px-3 py-2.5 rounded-xl border border-surface-200 text-sm resize-none"
              />
              <p className="text-[11px] text-stone-400 mt-1 shrink-0">
                {mensagem.length} caractere(s) · <span className={segmentos > 1 ? 'text-amber-600 font-medium' : ''}>{segmentos} segmento(s) por SMS</span>. Acentos são removidos automaticamente. Coloque o nome da sua marca no texto.
              </p>
            </div>
            <button
              onClick={iniciarEnvio}
              disabled={enviando || !podeSms || !mensagem.trim() || validos.length === 0}
              className="btn-primary w-full min-h-[48px] touch-manipulation shrink-0"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviando ? 'Enviando...' : `Enviar para ${validos.length} número(s)`}
            </button>
            </div>
          </div>
        </aside>

        {/* Lista */}
        <div className="app-panel rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col flex-1 min-w-0">
          <div className="p-3 sm:p-4 border-b border-surface-200 shrink-0 flex items-center gap-2 text-stone-700">
            <Users className="w-4 h-4" />
            <p className="text-sm font-semibold">Lista de números (com DDI)</p>
          </div>
          <div className="p-3 sm:p-4 flex flex-col flex-1 min-w-0">
            <div className="relative flex flex-1 min-h-[220px]">
              <img src={excelImg} alt="" className="pointer-events-none absolute bottom-3 right-3 h-24 w-24 object-contain opacity-50 z-0 animate-float-soft" />
              <textarea
                value={lista}
                onChange={(e) => setLista(e.target.value)}
                placeholder={canal === 'brl' ? '+5511999998888\n+5521988887777,Maria' : '+14155552671\n+442079460958,Mary'}
                className="relative z-10 w-full flex-1 p-4 rounded-xl border border-surface-200 bg-transparent focus:border-surface-300 focus:ring-0 outline-none resize-y text-sm font-mono min-h-[220px]"
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <NichoPicker tipo="whatsapp" className="min-h-[44px]" onPick={(linhas) => setLista((prev) => [prev.trim(), linhas.join('\n')].filter(Boolean).join('\n'))} />
              <button onClick={handleBaixarExemplo} className="btn-secondary text-sm py-2.5 min-h-[44px] px-4 touch-manipulation"><Download className="w-4 h-4" /> Exemplo</button>
              <label className="btn-secondary text-sm py-2.5 min-h-[44px] px-4 cursor-pointer touch-manipulation flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" /> Subir Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              {validos.length} número(s) internacional(is) válido(s).
              {brExcluidos > 0 && <span className="text-amber-600"> {brExcluidos} do Brasil serão ignorados.</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Histórico */}
      {historico.length > 0 && (
        <Panel title="Histórico de disparos" icon={History} noPadding collapsible open={histOpen} onToggle={() => setHistOpen((v) => !v)}>
          <div className="divide-y divide-surface-100">
            {historicoPagina.map((d) => {
              const aberto = expanded === d.id
              return (
                <div key={d.id}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-4">
                    <button onClick={() => setExpanded(aberto ? null : d.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">{d.nomeDisparo}</p>
                        <p className="text-xs text-stone-500">{formatDate(d.createdAt)}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-stone-600">
                        {d.enviados}/{d.total} enviados{d.erros ? ` · ${d.erros} erro(s)` : ''}
                      </span>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS[d.status] || 'bg-stone-100 text-stone-600'} ${d.erros > 0 && d.erroMotivo ? 'cursor-help' : ''}`}
                        title={d.erros > 0 && d.erroMotivo ? `Motivo: ${d.erroMotivo}` : undefined}
                      >
                        {d.status === 'enviado' ? 'Enviado' : d.status === 'enviando' ? 'Enviando' : d.status === 'parcial' ? 'Parcial' : d.status === 'erro' ? 'Erro' : d.status}
                      </span>
                      <button onClick={() => handleExcluir(d.id)} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="px-4 pb-4">
                      <div className="text-xs text-stone-500 p-3 bg-surface-50 rounded-xl space-y-1">
                        <p className="text-stone-700 font-medium">Mensagem enviada:</p>
                        <p className="whitespace-pre-wrap break-words">{d.mensagem}</p>
                        {d.ignoradosBR > 0 && <p className="text-amber-600">{d.ignoradosBR} número(s) do Brasil ignorados neste disparo.</p>}
                        {d.erros > 0 && d.erroMotivo && (
                          <p className="text-red-600 mt-1"><b>Motivo do erro:</b> {d.erroMotivo}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {historico.length > HIST_POR_PAGINA && (
            <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-3">
              <p className="text-xs text-stone-600">Página {pagHistAtual} de {totalPagHist} · {historico.length} campanha(s)</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPHist((p) => Math.max(1, p - 1))} disabled={pagHistAtual <= 1} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPHist((p) => Math.min(totalPagHist, p + 1))} disabled={pagHistAtual >= totalPagHist} className="px-3 py-2 min-h-[38px] rounded-xl border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Panel>
      )}
      </div>
    </PageShell>
  )
}

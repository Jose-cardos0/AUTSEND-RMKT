import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, getEmailConfig, getEmailDisparos, deleteEmailDisparo, getEmailEvents, getEmailProviders } from '../../lib/firestore'
import { listDomains } from '../../lib/emailDomains'
import ChavesPicker from '../../components/ChavesPicker'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import RemetentePicker from '../../components/RemetentePicker'
import NichoPicker from '../../components/NichoPicker'
import StatCard from '../../components/StatCard'
import { Send, Loader2, Upload, Download, Users, History, Trash2, AlertCircle, Mail, ChevronLeft, ChevronRight, ChevronDown, Eye, MousePointerClick, CheckCircle2, XCircle } from 'lucide-react'
import excelImg from '../../assets/excel.png'
import { emailPreviewDoc } from '../../lib/emailPreview'

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

function parseLista(text) {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\t,;]/).map((p) => p.trim()).filter(Boolean)
      const email = parts.find((p) => emailValido(p)) || parts[0] || ''
      const nome = parts.filter((p) => p !== email).join(' ').trim()
      return { email, nome }
    })
    .filter((r) => emailValido(r.email))
}

const STATUS = {
  enviado: 'bg-green-100 text-green-700',
  enviando: 'bg-blue-100 text-blue-700',
  parcial: 'bg-amber-100 text-amber-700',
  erro: 'bg-red-100 text-red-700',
}

export default function EmailDisparos() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [config, setConfig] = useState(null)
  const [providers, setProviders] = useState([])
  const [temDom, setTemDom] = useState(false)
  const [remetenteId, setRemetenteId] = useState(null)
  const [historico, setHistorico] = useState([])

  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [nomeDisparo, setNomeDisparo] = useState('')
  const [showNomeModal, setShowNomeModal] = useState(false)
  const [lista, setLista] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Ritmo de envio fixo (config do admin — não exposto ao usuário).
  const loteSize = 30
  const intervaloMin = 5
  const [pHist, setPHist] = useState(1)
  const [events, setEvents] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [histOpen, setHistOpen] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getEmailTemplates(user.uid), getEmailConfig(user.uid), getEmailDisparos(user.uid), getEmailEvents(user.uid), getEmailProviders(user.uid)])
      .then(([tpls, cfg, disp, evs, provs]) => {
        setTemplates(tpls)
        setConfig(cfg)
        setHistorico(disp)
        setEvents(evs)
        setProviders(provs)
        if (tpls.length > 0) { setTemplateId(tpls[0].id); setSubject(tpls[0].subject || '') }
      })
      .finally(() => setLoading(false))
    listDomains().then((r) => setTemDom((r.dominios || []).some((d) => d.status === 'verified' && (d.senders || []).length))).catch(() => {})
  }, [user?.uid])

  const onSelectTemplate = (id) => {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    setSubject(t?.subject || '')
  }

  const contatos = useMemo(() => parseLista(lista), [lista])
  const configOk = !!(config?.apiKey && config?.fromEmail) || providers.some((p) => p.apiKey && (p.remetentes || []).some((r) => r.email)) || temDom

  const handleUploadExcel = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
        const linhas = []
        for (const row of rows) {
          const email = String(row[0] ?? '').trim()
          const nome = String(row[1] ?? '').trim()
          if (emailValido(email)) linhas.push(nome ? `${email},${nome}` : email)
        }
        setLista((prev) => (prev ? prev + '\n' : '') + linhas.join('\n'))
        toast.success(`${linhas.length} e-mail(s) importado(s) (coluna A = e-mail, B = nome).`)
      } catch {
        toast.error('Erro ao ler a planilha.')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const handleBaixarExemplo = () => {
    const ws = XLSX.utils.aoa_to_sheet([['E-mail', 'Nome'], ['cliente@email.com', 'João'], ['maria@email.com', 'Maria']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos')
    XLSX.writeFile(wb, 'lista_email_exemplo.xlsx')
  }

  const iniciarEnvio = () => {
    if (!configOk) { toast.error('Configure o Resend em Integrações de E-mail.'); return }
    if (!templateId) { toast.error('Escolha um template.'); return }
    if (contatos.length === 0) { toast.error('Adicione ao menos um e-mail válido.'); return }
    setShowNomeModal(true)
  }

  const handleEnviar = async () => {
    if (!configOk) { toast.error('Configure o Resend em Integrações de E-mail.'); return }
    if (!templateId) { toast.error('Escolha um template.'); return }
    if (contatos.length === 0) { toast.error('Adicione ao menos um e-mail válido.'); return }
    setShowNomeModal(false)
    setEnviando(true)
    try {
      const sendBulk = httpsCallable(functions, 'sendBulkEmail')
      const res = await sendBulk({
        templateId,
        subject: subject.trim(),
        nomeDisparo: nomeDisparo.trim() || `Disparo ${new Date().toLocaleDateString('pt-BR')}`,
        recipients: contatos,
        loteSize,
        intervaloMin,
        remetenteId,
      })
      const { enviados, total, lotes } = res.data || {}
      if (lotes > 1) {
        toast.success(`Iniciado: ${enviados}/${total} no 1º lote. O resto sai em lotes de ${loteSize} a cada ${intervaloMin} min.`)
      } else {
        toast.success(`Disparo enviado: ${enviados}/${total}.`)
      }
      setLista('')
      setNomeDisparo('')
      setHistorico(await getEmailDisparos(user.uid))
    } catch (err) {
      toast.error(err.message || 'Falha no disparo.')
    } finally {
      setEnviando(false)
    }
  }

  const handleExcluir = async (id) => {
    try {
      await deleteEmailDisparo(user.uid, id)
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

  const totalEnviados = historico.reduce((s, d) => s + (d.enviados || 0), 0)
  const totalErros = historico.reduce((s, d) => s + (d.erros || 0), 0)

  return (
    <PageShell
      compact
      badge="E-mail · Disparos"
      title="Disparos de e-mail"
      right={
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 w-full max-w-[220px] lg:max-w-[540px]">
          <StatCard label="Contatos" value={contatos.length} icon={Users} color="blue" />
          <StatCard label="Enviados" value={totalEnviados} icon={CheckCircle2} color="green" />
          <StatCard label="Erros" value={totalErros} icon={XCircle} color="red" />
          <StatCard label="Campanhas" value={historico.length} icon={Mail} color="purple" />
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
              placeholder="Ex: Campanha Black Friday"
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
      {!configOk && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Conecte o Resend em <Link to="/email/integracoes" className="font-semibold underline">Integrações de E-mail</Link> antes de disparar.</span>
        </div>
      )}
      {templates.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Crie um template no <Link to="/email/construtor" className="font-semibold underline">Construtor</Link> para poder disparar.</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-stretch">
        {/* Config do disparo */}
        <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg">
          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-stone-800 shrink-0 mb-3 flex items-center gap-2">
              <Mail className="w-5 h-5 shrink-0 text-primary-600" />
              Configuração
            </h3>
            <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Template</label>
              <Select
                value={templateId}
                onChange={onSelectTemplate}
                placeholder=""
                className="w-full"
                preview
                options={templates.map((t) => ({ value: t.id, label: t.nome, preview: emailPreviewDoc(t) }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-stone-600">Assunto</label>
                <ChavesPicker onPick={(chave) => setSubject((s) => s + chave)} />
              </div>
              <textarea
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                rows={2}
                placeholder="Assunto do e-mail"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-200 text-sm resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Remetente</label>
              <RemetentePicker providers={providers} value={remetenteId} onChange={setRemetenteId} />
            </div>
            <button
              onClick={iniciarEnvio}
              disabled={enviando || !configOk || !templateId || contatos.length === 0}
              className="btn-primary w-full min-h-[48px] touch-manipulation"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviando ? 'Enviando...' : `Enviar para ${contatos.length} contato(s)`}
            </button>
            </div>
          </div>
        </aside>

        {/* Lista */}
        <div className="border border-surface-200/90 rounded-2xl sm:rounded-3xl overflow-hidden bg-white shadow-inner shadow-slate-200/40 ring-1 ring-white/80 flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-surface-200/80 bg-gradient-to-r from-surface-50/90 to-primary-50/30 flex-wrap">
            <Users className="w-4 h-4 text-primary-600 shrink-0" />
            <span className="text-sm font-semibold text-stone-800">Lista de e-mails</span>
            <div className="ml-auto flex items-center gap-0.5">
              <NichoPicker tipo="email" iconOnly label="Nicho" onPick={(linhas) => setLista((prev) => [prev.trim(), linhas.join('\n')].filter(Boolean).join('\n'))} />
              <button type="button" onClick={handleBaixarExemplo} title="Baixar exemplo Excel" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation">
                <Download className="w-4 h-4" />
              </button>
              <label title="Subir Excel" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation cursor-pointer">
                <Upload className="w-4 h-4" />
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
          </div>
          <div className="relative flex flex-1 min-h-[220px]">
            <img src={excelImg} alt="" className="pointer-events-none absolute bottom-3 right-3 h-24 w-24 object-contain opacity-50 z-0 animate-float-soft" />
            <textarea
              value={lista}
              onChange={(e) => setLista(e.target.value)}
              placeholder={'cliente@email.com\nmaria@email.com,Maria'}
              className="relative z-10 w-full flex-1 p-4 bg-transparent resize-none focus:ring-0 focus:outline-none text-sm font-mono min-h-[220px] placeholder:text-stone-400 text-stone-800"
            />
          </div>
        </div>
      </div>

      {/* Histórico */}
      {historico.length > 0 && (
        <Panel title="Histórico de disparos" icon={History} noPadding collapsible open={histOpen} onToggle={() => setHistOpen((v) => !v)}>
          <div className="divide-y divide-surface-100">
            {historicoPagina.map((d) => {
              const aberto = expanded === d.id
              const porEmail = {}
              events.filter((e) => e.disparoId === d.id).forEach((e) => {
                const k = (e.email || '').toLowerCase()
                if (!k) return
                if (!porEmail[k]) porEmail[k] = { email: e.email, opened: false, clicked: false }
                if (e.tipo === 'opened') porEmail[k].opened = true
                if (e.tipo === 'clicked') porEmail[k].clicked = true
              })
              const contatos = Object.values(porEmail)
              return (
                <div key={d.id}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-4">
                    <button onClick={() => setExpanded(aberto ? null : d.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">{d.nomeDisparo}</p>
                        <p className="text-xs text-stone-500">{d.templateNome} · {formatDate(d.createdAt)}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-stone-600">
                        {d.enviados}/{d.total} enviados{d.erros ? ` · ${d.erros} erro(s)` : ''}
                        {' · '}<span className="text-blue-600">{d.aberturas || 0} aberturas</span>
                        {' · '}<span className="text-violet-600">{d.cliques || 0} cliques</span>
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS[d.status] || 'bg-stone-100 text-stone-600'}`}>
                        {d.status === 'enviado' ? 'Enviado' : d.status === 'enviando' ? 'Enviando' : d.status === 'parcial' ? 'Parcial' : d.status === 'erro' ? 'Erro' : d.status}
                      </span>
                      <button onClick={() => handleExcluir(d.id)} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="px-4 pb-4">
                      {contatos.length === 0 ? (
                        <p className="text-xs text-stone-400 p-3 bg-surface-50 rounded-xl">Ninguém abriu ou clicou ainda (ou o rastreamento não estava ligado quando este disparo saiu).</p>
                      ) : (
                        <div className="rounded-xl border border-surface-200 overflow-hidden max-h-72 overflow-y-auto scroll-y-soft">
                          {contatos.map((c) => (
                            <div key={c.email} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-surface-100 last:border-0 text-sm">
                              <span className="truncate min-w-0 text-stone-700">{c.email}</span>
                              <span className="flex items-center gap-2 shrink-0">
                                {c.opened && <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600"><Eye className="w-3.5 h-3.5" /> Abriu</span>}
                                {c.clicked && <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600"><MousePointerClick className="w-3.5 h-3.5" /> Clicou</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
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

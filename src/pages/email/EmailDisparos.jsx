import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, getEmailConfig, getEmailDisparos, deleteEmailDisparo, getEmailEvents, getEmailProviders } from '../../lib/firestore'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import RemetentePicker from '../../components/RemetentePicker'
import { Send, Loader2, Upload, Download, Users, History, Trash2, AlertCircle, Mail, ChevronLeft, ChevronRight, ChevronDown, Eye, MousePointerClick } from 'lucide-react'

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
  const [remetenteId, setRemetenteId] = useState(null)
  const [historico, setHistorico] = useState([])

  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [nomeDisparo, setNomeDisparo] = useState('')
  const [lista, setLista] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [loteSize, setLoteSize] = useState(30)
  const [intervaloMin, setIntervaloMin] = useState(5)
  const [pHist, setPHist] = useState(1)
  const [events, setEvents] = useState([])
  const [expanded, setExpanded] = useState(null)

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
  }, [user?.uid])

  const onSelectTemplate = (id) => {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    setSubject(t?.subject || '')
  }

  const contatos = useMemo(() => parseLista(lista), [lista])
  const configOk = !!(config?.apiKey && config?.fromEmail) || providers.some((p) => p.apiKey && (p.remetentes || []).some((r) => r.email))

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

  const handleEnviar = async () => {
    if (!configOk) { toast.error('Configure o Resend em Integrações de E-mail.'); return }
    if (!templateId) { toast.error('Escolha um template.'); return }
    if (contatos.length === 0) { toast.error('Adicione ao menos um e-mail válido.'); return }
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

  return (
    <PageShell
      badge="E-mail · Disparos"
      title="Disparos de e-mail"
    >
      <div className="space-y-4 sm:space-y-5">
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

      <div className="flex flex-col lg:flex-row gap-3">
        {/* Config do disparo */}
        <Panel title="Configuração" icon={Mail} className="lg:w-96 shrink-0">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Template</label>
              <select
                value={templateId}
                onChange={(e) => onSelectTemplate(e.target.value)}
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm bg-white"
              >
                <option value="">— escolha —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Assunto</label>
              <textarea
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                rows={2}
                placeholder="Assunto do e-mail"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-200 text-sm resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Nome do disparo</label>
              <input
                value={nomeDisparo}
                onChange={(e) => setNomeDisparo(e.target.value)}
                placeholder="Ex: Campanha Black Friday"
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Remetente</label>
              <RemetentePicker providers={providers} value={remetenteId} onChange={setRemetenteId} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Lote (por vez)</label>
                <input type="number" min={1} value={loteSize} onChange={(e) => setLoteSize(Math.max(1, Number(e.target.value) || 1))} className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Intervalo (min)</label>
                <input type="number" min={0} value={intervaloMin} onChange={(e) => setIntervaloMin(Math.max(0, Number(e.target.value) || 0))} className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm" />
              </div>
            </div>
            <p className="text-[11px] text-stone-400">
              Envia {loteSize} por vez, a cada {intervaloMin} min{contatos.length > 0 ? ` · ~${Math.ceil(contatos.length / Math.max(1, loteSize))} lote(s)` : ''}. Ritmo menor protege a reputação (domínio novo).
            </p>
            <button
              onClick={handleEnviar}
              disabled={enviando || !configOk || !templateId || contatos.length === 0}
              className="btn-primary w-full min-h-[48px] touch-manipulation"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviando ? 'Enviando...' : `Enviar para ${contatos.length} contato(s)`}
            </button>
          </div>
        </Panel>

        {/* Lista */}
        <Panel title="Lista de e-mails" icon={Users} className="flex-1">
          <div className="space-y-3">
            <p className="text-xs text-stone-500">Uma linha por contato: <strong>email</strong> ou <strong>email,nome</strong>. Ou suba um Excel (A = e-mail, B = nome).</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleBaixarExemplo} className="btn-secondary text-sm min-h-[40px] px-4"><Download className="w-4 h-4" /> Exemplo</button>
              <label className="btn-secondary text-sm min-h-[40px] px-4 cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" /> Subir Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
            <textarea
              value={lista}
              onChange={(e) => setLista(e.target.value)}
              rows={10}
              placeholder={'cliente@email.com\nmaria@email.com,Maria'}
              className="w-full p-3 rounded-xl border border-surface-200 font-mono text-sm resize-y min-h-[220px]"
            />
            <p className="text-xs text-stone-400">{contatos.length} e-mail(s) válido(s) detectado(s).</p>
          </div>
        </Panel>
      </div>

      {/* Histórico */}
      {historico.length > 0 && (
        <Panel title="Histórico de disparos" icon={History} noPadding>
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

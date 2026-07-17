import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { EmailEditor, EmailEditorProvider } from 'easy-email-editor'
import { StandardLayout } from 'easy-email-extensions'
import { BlockManager, BasicType, JsonToMjml } from 'easy-email-core'
import mjml from 'mjml-browser'
import 'easy-email-editor/lib/style.css'
import 'easy-email-extensions/lib/style.css'
import '@arco-design/web-react/dist/css/arco.css'

import { auth } from '../../lib/firebase'
import { getEmailTemplates, saveEmailTemplate, deleteEmailTemplate } from '../../lib/firestore'
import { uploadEmailAsset } from '../../lib/storageAssets'
import PageShell from '../../components/PageShell'
import Select from '../../components/Select'
import { useConfirm } from '../../components/ConfirmDialog'
import MelhorarPlano from '../../components/MelhorarPlano'
import { usePlano } from '../../lib/PlanoContext'
import { Loader2, Save, Send, Trash2, Plus } from 'lucide-react'

// Variáveis do nosso backend. O Easy Email insere como {{tag}}; convertemos pra {tag} ao salvar.
const MERGE_TAGS = {
  nome_cliente: 'João',
  numero_cliente: '5511999999999',
  email_cliente: 'cliente@email.com',
  nome_produto: 'Seu produto',
}

/** Página em branco do Easy Email. */
function paginaVazia() {
  return {
    subject: '',
    subTitle: '',
    content: BlockManager.getBlockByType(BasicType.PAGE).create({}),
  }
}

/** Compila o conteúdo do Easy Email pra HTML de e-mail (MJML → HTML) + troca {{tag}} por {tag}. */
function compilarHtml(values) {
  const mjmlStr = JsonToMjml({ data: values.content, mode: 'production', context: values.content })
  let { html } = mjml(mjmlStr, { validationLevel: 'soft' })
  html = html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, '{$1}')
  return html
}

export default function EmailConstrutor() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const { limiteDe } = usePlano()
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [nome, setNome] = useState('')
  const [subject, setSubject] = useState('')
  const [dados, setDados] = useState(null) // dados do Easy Email do template atual
  const [salvando, setSalvando] = useState(false)
  const valuesRef = useRef(null) // valores atuais do editor (pra salvar)

  // Carrega templates
  useEffect(() => {
    if (!user?.uid) return
    getEmailTemplates(user.uid).then((list) => {
      setTemplates(list)
      if (list.length > 0) setSelectedId((cur) => cur ?? list[0].id)
      else setDados(paginaVazia())
    })
  }, [user?.uid])

  // Ao trocar de template, carrega o conteúdo (json do Easy Email)
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedId)
    setNome(tpl?.nome || '')
    setSubject(tpl?.subject || '')
    if (tpl?.easyEmail?.content) setDados({ subject: tpl.subject || '', subTitle: '', content: tpl.easyEmail.content })
    else setDados(paginaVazia())
  }, [selectedId, templates])

  const novoTemplate = () => {
    setSelectedId(null)
    setNome('')
    setSubject('')
    setDados(paginaVazia())
  }

  const onUploadImage = async (blob) => {
    if (!user?.uid) throw new Error('Faça login.')
    const file = blob instanceof File ? blob : new File([blob], `img-${Date.now()}.png`, { type: blob.type || 'image/png' })
    const { src } = await uploadEmailAsset(user.uid, file)
    return src
  }

  const handleSalvar = async () => {
    if (!user?.uid) return
    if (!nome.trim()) { toast.error('Dê um nome ao template (ex.: "E-mail de recuperação").'); return }
    const limite = limiteDe('templates')
    if (!selectedId && templates.length >= limite) {
      toast.error(`Seu plano permite ${limite} template${limite === 1 ? '' : 's'}. Faça upgrade pra criar mais.`)
      setUpgradeOpen(true)
      return
    }
    const values = valuesRef.current
    if (!values) { toast.error('Editor ainda carregando, tente de novo.'); return }
    setSalvando(true)
    try {
      const html = compilarHtml(values)
      const id = await saveEmailTemplate(user.uid, selectedId, {
        nome: nome.trim(),
        subject: subject.trim(),
        html,
        css: '',
        inlined: html, // MJML já sai email-safe (estilos inline)
        easyEmail: { content: values.content }, // pra reabrir/editar depois
      })
      const list = await getEmailTemplates(user.uid)
      setTemplates(list)
      setSelectedId(id)
      toast.success('Template salvo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar template')
    } finally {
      setSalvando(false)
    }
  }

  const handleExcluir = async () => {
    if (!user?.uid || !selectedId) { toast.error('Selecione um template salvo para excluir.'); return }
    if (!(await confirm({ title: `Excluir o template "${nome}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteEmailTemplate(user.uid, selectedId)
      const list = await getEmailTemplates(user.uid)
      setTemplates(list)
      if (list.length === 0) novoTemplate()
      else setSelectedId(list[0].id)
      toast.success('Template excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  const initialValues = useMemo(() => dados, [dados])

  return (
    <PageShell
      fill
      badge="E-mail · Construtor"
      title="Construtor de e-mail"
      right={
        <div className="flex flex-wrap gap-2">
          <button onClick={novoTemplate} className="btn-secondary text-sm min-h-[40px]"><Plus className="w-4 h-4" /> Novo</button>
          {selectedId && <button onClick={handleExcluir} className="btn-secondary text-sm min-h-[40px] text-red-600"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={handleSalvar} disabled={salvando} className="btn-primary text-sm min-h-[40px]">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
        </div>
      }
    >
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
        {/* Faixa de topo: template + nome + assunto (compacto) */}
        <div className="shrink-0 app-panel rounded-2xl p-2.5 flex flex-wrap items-center gap-2">
          <Select
            value={selectedId || ''}
            onChange={(v) => setSelectedId(v || null)}
            compact
            className="w-44"
            options={[{ value: '', label: 'Novo template' }, ...templates.map((t) => ({ value: t.id, label: t.nome }))]}
          />
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do template" className="w-48 px-3 h-9 rounded-lg border border-surface-200 text-sm" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail (ex.: {nome_cliente}, volte!)" className="flex-1 min-w-[180px] px-3 h-9 rounded-lg border border-surface-200 text-sm" />
          <div className="flex items-center gap-1">
            {Object.keys(MERGE_TAGS).map((k) => (
              <button key={k} type="button" title={`Inserir no assunto`} onClick={() => setSubject((s) => `${s || ''}{${k}}`)} className="px-2 py-1 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-200/70 text-[10px] font-medium">{`{${k}}`}</button>
            ))}
          </div>
        </div>

        {/* Editor Easy Email — largura total */}
        <div className="flex-1 min-h-0 min-w-0 app-panel rounded-2xl overflow-hidden">
          {initialValues ? (
            <EmailEditorProvider
              key={selectedId || 'novo'}
              data={initialValues}
              height="100%"
              autoComplete
              dashed={false}
              mergeTags={MERGE_TAGS}
              onUploadImage={onUploadImage}
            >
              {({ values }) => {
                valuesRef.current = values
                return (
                  <StandardLayout showSourceCode>
                    <EmailEditor />
                  </StandardLayout>
                )
              }}
            </EmailEditorProvider>
          ) : (
            <div className="h-full flex items-center justify-center text-stone-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando editor…
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}

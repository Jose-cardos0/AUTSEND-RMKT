import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { EmailEditor, EmailEditorProvider } from 'easy-email-editor'
import { StandardLayout } from 'easy-email-extensions'
import { BlockManager, BasicType, AdvancedType, JsonToMjml } from 'easy-email-core'
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
import { Loader2, Save, Trash2, Plus, ArrowLeft, Mail, Pencil } from 'lucide-react'

// Variáveis do nosso backend. O Easy Email insere como {{tag}}; convertemos pra {tag} ao salvar.
const MERGE_TAGS = {
  nome_cliente: 'João',
  numero_cliente: '5511999999999',
  email_cliente: 'cliente@email.com',
  nome_produto: 'Seu produto',
}

// Blocos disponíveis no painel esquerdo (senão o painel fica VAZIO).
const CATEGORIES = [
  {
    label: 'Conteúdo',
    active: true,
    blocks: [
      { type: AdvancedType.TEXT },
      { type: AdvancedType.IMAGE, payload: { attributes: { padding: '0px 0px 0px 0px' } } },
      { type: AdvancedType.BUTTON },
      { type: AdvancedType.DIVIDER },
      { type: AdvancedType.SPACER },
      { type: AdvancedType.HERO },
      { type: AdvancedType.SOCIAL },
    ],
  },
  {
    label: 'Layout',
    active: true,
    displayType: 'column',
    blocks: [
      { title: '1 coluna', payload: [['100%']] },
      { title: '2 colunas', payload: [['50%', '50%'], ['33%', '67%'], ['67%', '33%']] },
      { title: '3 colunas', payload: [['33.33%', '33.33%', '33.33%']] },
    ],
  },
]

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
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(false) // false = lista; true = editor tela cheia
  const [selectedId, setSelectedId] = useState(null)
  const [nome, setNome] = useState('')
  const [subject, setSubject] = useState('')
  const [dados, setDados] = useState(null) // dados do Easy Email do template em edição
  const [salvando, setSalvando] = useState(false)
  const valuesRef = useRef(null) // valores atuais do editor (pra salvar)

  // Carrega templates
  const recarregar = async () => {
    if (!user?.uid) return []
    const list = await getEmailTemplates(user.uid)
    setTemplates(list)
    return list
  }
  useEffect(() => {
    if (!user?.uid) return
    setCarregando(true)
    recarregar().finally(() => setCarregando(false))
  }, [user?.uid])

  // Abre o editor tela cheia para um template existente
  const abrirTemplate = (tpl) => {
    setSelectedId(tpl.id)
    setNome(tpl.nome || '')
    setSubject(tpl.subject || '')
    setDados(
      tpl?.easyEmail?.content
        ? { subject: tpl.subject || '', subTitle: '', content: tpl.easyEmail.content }
        : paginaVazia()
    )
    setEditando(true)
  }

  // Abre o editor tela cheia em branco
  const novoTemplate = () => {
    setSelectedId(null)
    setNome('')
    setSubject('')
    setDados(paginaVazia())
    setEditando(true)
  }

  const fecharEditor = () => {
    setEditando(false)
    valuesRef.current = null
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
      await recarregar()
      setSelectedId(id)
      toast.success('Template salvo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar template')
    } finally {
      setSalvando(false)
    }
  }

  // Exclui um template (a partir do card na lista OU do topo do editor)
  const handleExcluir = async (tpl) => {
    const alvoId = tpl?.id || selectedId
    const alvoNome = tpl?.nome || nome
    if (!user?.uid || !alvoId) { toast.error('Selecione um template salvo para excluir.'); return }
    if (!(await confirm({ title: `Excluir o template "${alvoNome}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteEmailTemplate(user.uid, alvoId)
      await recarregar()
      if (editando && alvoId === selectedId) fecharEditor()
      toast.success('Template excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  const initialValues = useMemo(() => dados, [dados])

  // ─────────────────────────────────────────────────────────────
  // TELA 2 — Editor em tela cheia (overlay que escapa do PageShell)
  // O Easy Email precisa da tela inteira; espremer quebra o CSS.
  // ─────────────────────────────────────────────────────────────
  if (editando) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
        {/* Barra superior do editor — altura fixa 56px (usada no calc abaixo) */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-surface-200 bg-white" style={{ minHeight: 56 }}>
          <button onClick={fecharEditor} className="btn-secondary text-sm min-h-[38px]" title="Voltar">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do template" className="w-48 px-3 h-9 rounded-lg border border-surface-200 text-sm" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail (ex.: {nome_cliente}, volte!)" className="flex-1 min-w-[180px] px-3 h-9 rounded-lg border border-surface-200 text-sm" />
          <div className="flex items-center gap-1">
            {Object.keys(MERGE_TAGS).map((k) => (
              <button key={k} type="button" title="Inserir no assunto" onClick={() => setSubject((s) => `${s || ''}{${k}}`)} className="px-2 py-1 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-200/70 text-[10px] font-medium">{`{${k}}`}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {selectedId && (
              <button onClick={() => handleExcluir()} className="btn-secondary text-sm min-h-[38px] text-red-600" title="Excluir template"><Trash2 className="w-4 h-4" /></button>
            )}
            <button onClick={handleSalvar} disabled={salvando} className="btn-primary text-sm min-h-[38px]">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>

        {/* Editor Easy Email — tela cheia, altura DEFINIDA (senão os painéis colapsam) */}
        <div className="min-h-0 min-w-0" style={{ height: 'calc(100vh - 56px)' }}>
          {initialValues ? (
            <EmailEditorProvider
              key={selectedId || 'novo'}
              data={initialValues}
              height="calc(100vh - 56px)"
              autoComplete
              dashed={false}
              mergeTags={MERGE_TAGS}
              onUploadImage={onUploadImage}
            >
              {({ values }) => {
                valuesRef.current = values
                return (
                  <StandardLayout showSourceCode categories={CATEGORIES}>
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
    )
  }

  // ─────────────────────────────────────────────────────────────
  // TELA 1 — Lista de templates
  // ─────────────────────────────────────────────────────────────
  return (
    <PageShell
      badge="E-mail · Construtor"
      title="Construtor de e-mail"
      right={
        <button onClick={novoTemplate} className="btn-primary text-sm min-h-[40px]"><Plus className="w-4 h-4" /> Novo template</button>
      }
    >
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      {carregando ? (
        <div className="flex items-center justify-center py-24 text-stone-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando templates…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Card "novo" */}
          <button
            onClick={novoTemplate}
            className="app-panel rounded-2xl p-5 flex flex-col items-center justify-center gap-2 min-h-[150px] border-2 border-dashed border-surface-200 hover:border-primary-300 hover:bg-primary-50/40 transition text-stone-500 hover:text-primary-600"
          >
            <div className="w-11 h-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><Plus className="w-5 h-5" /></div>
            <span className="text-sm font-medium">Criar novo template</span>
          </button>

          {/* Cards dos templates */}
          {templates.map((tpl) => (
            <div key={tpl.id} className="app-panel rounded-2xl p-5 flex flex-col min-h-[150px] group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0"><Mail className="w-5 h-5" /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-stone-800 truncate">{tpl.nome || 'Sem nome'}</h3>
                  <p className="text-xs text-stone-400 truncate mt-0.5">{tpl.subject || 'Sem assunto'}</p>
                </div>
              </div>
              <div className="mt-auto pt-4 flex items-center gap-2">
                <button onClick={() => abrirTemplate(tpl)} className="btn-secondary text-xs min-h-[34px] flex-1"><Pencil className="w-3.5 h-3.5" /> Editar</button>
                <button onClick={() => handleExcluir(tpl)} className="btn-secondary text-xs min-h-[34px] px-2.5 text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}

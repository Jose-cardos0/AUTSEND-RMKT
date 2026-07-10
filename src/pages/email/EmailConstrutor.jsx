import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import grapesjs from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import presetNewsletter from 'grapesjs-preset-newsletter'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/themes/prism-tomorrow.css'
import { html as beautifyHtml } from 'js-beautify'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, saveEmailTemplate, deleteEmailTemplate } from '../../lib/firestore'
import { TEMPLATE_VARIABLES } from '../../lib/constants'
import PageShell from '../../components/PageShell'
import Select from '../../components/Select'
import { emailPreviewDoc } from '../../lib/emailPreview'
import { useConfirm } from '../../components/ConfirmDialog'
import { Loader2, Save, Send, Trash2, Plus, FileText, Code2 } from 'lucide-react'
import EmojiPicker from '../../components/EmojiPicker'

const PLACEHOLDER = '<div style="padding:40px;text-align:center;font-family:Arial,sans-serif;color:#666">Arraste blocos aqui para montar seu e-mail…</div>'

export default function EmailConstrutor() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [nome, setNome] = useState('')
  const [subject, setSubject] = useState('')
  const [ready, setReady] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importCode, setImportCode] = useState('')
  const containerRef = useRef(null)
  const editorRef = useRef(null)
  const subjectRef = useRef(null)

  // Inicializa o GrapesJS uma vez
  useEffect(() => {
    if (editorRef.current || !containerRef.current) return
    const editor = grapesjs.init({
      container: containerRef.current,
      height: '100%',
      width: 'auto',
      storageManager: false,
      plugins: [(ed) => presetNewsletter(ed, {
        modalTitleImport: 'Importar HTML',
        modalTitleExport: 'HTML do e-mail',
      })],
    })
    editorRef.current = editor
    setReady(true)
    return () => {
      try { editor.destroy() } catch (_) {}
      editorRef.current = null
    }
  }, [])

  // Carrega templates do usuário
  useEffect(() => {
    if (!user?.uid) return
    getEmailTemplates(user.uid).then((list) => {
      setTemplates(list)
      if (list.length > 0) setSelectedId((cur) => cur ?? list[0].id)
    })
  }, [user?.uid])

  // Ao selecionar um template (ou ficar pronto), carrega o conteúdo no editor
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !ready) return
    const tpl = templates.find((t) => t.id === selectedId)
    setNome(tpl?.nome || '')
    setSubject(tpl?.subject || '')
    editor.setComponents(tpl?.html || PLACEHOLDER)
    editor.setStyle(tpl?.css || '')
  }, [selectedId, ready, templates])

  const novoTemplate = () => {
    setSelectedId(null)
    setNome('')
    setSubject('')
    const editor = editorRef.current
    if (editor) { editor.setComponents(PLACEHOLDER); editor.setStyle('') }
  }

  const handleSalvar = async () => {
    if (!user?.uid) return
    if (!nome.trim()) { toast.error('Dê um nome ao template (ex.: "E-mail de recuperação").'); return }
    const editor = editorRef.current
    if (!editor) return
    setSalvando(true)
    try {
      const html = editor.getHtml()
      const css = editor.getCss()
      let inlined = html
      try { inlined = editor.runCommand('gjs-get-inlined-html') || html } catch (_) {}
      const id = await saveEmailTemplate(user.uid, selectedId, {
        nome: nome.trim(),
        subject: subject.trim(),
        html,
        css,
        inlined,
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
      setSelectedId(list[0]?.id ?? null)
      if (list.length === 0) novoTemplate()
      toast.success('Template excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  // Abre o modal de código já preenchido com o HTML atual do editor (ver/editar/colar)
  const abrirCodigo = () => {
    const editor = editorRef.current
    let code = ''
    if (editor) {
      code = editor.getHtml()
      try { code = editor.runCommand('gjs-get-inlined-html') || code } catch (_) {}
    }
    // Indenta/organiza o HTML (o GrapesJS exporta tudo "amassado")
    try {
      code = beautifyHtml(code, { indent_size: 2, wrap_line_length: 0, preserve_newlines: false, wrap_attributes: 'auto' })
    } catch (_) {}
    setImportCode(code)
    setShowImport(true)
  }

  const importarHtml = () => {
    const editor = editorRef.current
    if (!editor) return
    const raw = importCode.trim()
    if (!raw) { toast.error('Cole o HTML primeiro.'); return }
    // Preserva o <style> (media queries do e-mail) e usa o conteúdo do <body>
    const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const body = bodyMatch ? bodyMatch[1] : raw
    editor.setComponents(body)
    // addStyle (acrescenta) e NÃO setStyle (substituiria e apagaria os estilos extraídos do inline)
    if (styles) editor.addStyle(styles)
    setShowImport(false)
    setImportCode('')
    toast.success('HTML importado! Ajuste no editor e clique em Salvar.')
  }

  const enviarTeste = async () => {
    const editor = editorRef.current
    if (!editor) return
    const to = (testEmail || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error('Informe um e-mail válido.')
      return
    }
    setTestando(true)
    try {
      let inlined = editor.getHtml()
      try { inlined = editor.runCommand('gjs-get-inlined-html') || inlined } catch (_) {}
      const sendTest = httpsCallable(functions, 'sendTestEmail')
      await sendTest({ to, html: inlined, subject: subject.trim() || nome.trim() || 'Teste de e-mail' })
      toast.success(`Teste enviado para ${to}.`)
      setShowTest(false)
    } catch (err) {
      toast.error(err.message || 'Falha ao enviar teste. Confira as Integrações de E-mail.')
    } finally {
      setTestando(false)
    }
  }

  return (
    <PageShell
      fill
      badge="E-mail · Construtor"
      title="Construtor de e-mail"
      right={
        <div className="flex flex-wrap gap-2">
          <button onClick={novoTemplate} className="btn-secondary text-sm min-h-[40px]">
            <Plus className="w-4 h-4" /> Novo
          </button>
          <button onClick={abrirCodigo} className="btn-secondary text-sm min-h-[40px]">
            <Code2 className="w-4 h-4" /> Código HTML
          </button>
          <button onClick={() => setShowTest(true)} className="btn-secondary text-sm min-h-[40px]">
            <Send className="w-4 h-4" /> Testar
          </button>
          <button onClick={handleSalvar} disabled={salvando} className="btn-primary text-sm min-h-[40px]">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
        </div>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-3 overflow-hidden">
        {/* Coluna esquerda: dados do template */}
        <div className="lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto scroll-y-soft pr-0.5">
          <div className="app-panel rounded-2xl p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Template</label>
              <div className="flex gap-2">
                <Select
                  value={selectedId || ''}
                  onChange={(v) => setSelectedId(v || null)}
                  className="flex-1 min-w-0"
                  preview
                  options={[{ value: '', label: 'Novo' }, ...templates.map((t) => ({ value: t.id, label: t.nome, preview: emailPreviewDoc(t) }))]}
                />
                {selectedId && (
                  <button onClick={handleExcluir} className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir template">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Nome do template</label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: E-mail de recuperação"
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs font-medium text-stone-600">Assunto do e-mail</label>
                <EmojiPicker
                  buttonClassName="ml-auto p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                  onPick={(emoji) => {
                    const ta = subjectRef.current
                    const text = subject || ''
                    const start = ta ? ta.selectionStart : text.length
                    setSubject(text.slice(0, start) + emoji + text.slice(start))
                    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + emoji.length, start + emoji.length) } }, 0)
                  }}
                />
              </div>
              <textarea
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                rows={3}
                placeholder="Ex: {nome_cliente}, seu carrinho ainda está te esperando!"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-200 text-sm resize-y min-h-[76px] leading-snug"
              />
            </div>
          </div>

          <div className="app-panel rounded-2xl p-4">
            <p className="text-xs font-semibold text-stone-600 mb-2 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Variáveis <span className="font-normal text-stone-400">(clique pra inserir no assunto)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={v.label || v.key}
                  onClick={() => {
                    const ta = subjectRef.current
                    const text = subject || ''
                    const start = ta ? ta.selectionStart : text.length
                    setSubject(text.slice(0, start) + v.key + text.slice(start))
                    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + v.key.length, start + v.key.length) } }, 0)
                  }}
                  className="px-2.5 py-1 rounded-full bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-200/70 text-[11px] font-medium transition-colors"
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Coluna direita: editor */}
        <div className="flex-1 min-h-0 min-w-0 app-panel rounded-2xl overflow-hidden relative">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm gap-2 bg-white/70 z-10">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando editor…
            </div>
          )}
          <div ref={containerRef} className="h-full" />
        </div>
      </div>

      {/* Modal: enviar e-mail de teste */}
      {showTest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowTest(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0">
                <Send className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-stone-800">Enviar e-mail de teste</h3>
                <p className="text-xs text-stone-500">Recebe este template na sua caixa para conferir o visual.</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Enviar para</label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') enviarTeste() }}
                placeholder="voce@email.com"
                autoFocus
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTest(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={enviarTeste} disabled={testando} className="btn-primary min-h-[44px]">
                {testando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar teste
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: colar código HTML */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[80vw] p-4 sm:p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-stone-800">Código HTML</h3>
            <div className="rounded-xl border border-surface-300 overflow-auto max-h-[62vh]" style={{ background: '#2d2d2d' }}>
              <Editor
                value={importCode}
                onValueChange={setImportCode}
                highlight={(code) => Prism.highlight(code || '', Prism.languages.markup, 'markup')}
                padding={14}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 12.5,
                  color: '#e6e6e6',
                  minHeight: '42vh',
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={importarHtml} className="btn-primary min-h-[44px]"><Code2 className="w-4 h-4" /> Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

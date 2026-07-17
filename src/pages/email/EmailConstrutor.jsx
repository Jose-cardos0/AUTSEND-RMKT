import { useState, useEffect, useRef } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import grapesjs from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import '../../styles/grapes-theme.css'
import presetNewsletter from 'grapesjs-preset-newsletter'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/themes/prism-tomorrow.css'
import { html as beautifyHtml } from 'js-beautify'
import { auth, functions } from '../../lib/firebase'
import { getEmailTemplates, saveEmailTemplate, deleteEmailTemplate, getEmailProviders, getEmailConfig } from '../../lib/firestore'
import { uploadEmailAsset, listEmailAssets, deleteEmailAsset } from '../../lib/storageAssets'
import { registrarBlocosEmail } from '../../lib/emailBlocks'
import { DTC_PRESETS } from '../../lib/dtcPresets'
import PageShell from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import Select from '../../components/Select'
import { emailPreviewDoc } from '../../lib/emailPreview'
import { useConfirm } from '../../components/ConfirmDialog'
import MelhorarPlano from '../../components/MelhorarPlano'
import { usePlano } from '../../lib/PlanoContext'
import { Loader2, Save, Send, Trash2, Plus, Code2, ImagePlus, Paintbrush, GripVertical, Undo2, Redo2, Settings, Layers, Eraser, X, Eye } from 'lucide-react'

const TITULOS_PAINEL = { blocos: 'Blocos', estilo: 'Estilo', config: 'Configurações', camadas: 'Camadas' }
import EmojiPicker from '../../components/EmojiPicker'
import ChavesPicker from '../../components/ChavesPicker'

const PLACEHOLDER = '<div style="padding:40px;text-align:center;font-family:Arial,sans-serif;color:#666">Arraste blocos aqui para montar seu e-mail…</div>'

/** Botão do dock flutuante (ícone). */
function DockBtn({ onClick, title, ativo, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-2 rounded-xl transition-colors ${ativo ? 'bg-primary-100 text-primary-700' : 'text-stone-800 hover:bg-primary-50 hover:text-primary-700'}`}
    >
      {children}
    </button>
  )
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
  const [ready, setReady] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importCode, setImportCode] = useState('')
  const [showHtmlBlock, setShowHtmlBlock] = useState(false) // popup do bloco HTML
  const [htmlBlockCode, setHtmlBlockCode] = useState('')
  const [carregandoImgs, setCarregandoImgs] = useState(false) // loading da galeria de imagens
  const [showDtc, setShowDtc] = useState(false) // popup de blocos DTC pré-prontos
  const htmlTargetRef = useRef(null) // componente HTML solto (pra substituir pelo HTML digitado)
  const dtcTargetRef = useRef(null) // componente DTC solto (placeholder a substituir)
  const containerRef = useRef(null)
  const editorRef = useRef(null)
  const subjectRef = useRef(null)
  const uidRef = useRef(null)
  const dockRef = useRef(null)
  const [dockPos, setDockPos] = useState(null) // {left, top} em px; null = posição padrão (centro-baixo)
  const [painelAberto, setPainelAberto] = useState(null) // qual painel lateral está aberto (null = escondido)
  const [arrastando, setArrastando] = useState(false)
  const [remetente, setRemetente] = useState(null) // {nome, email} principal — pro mockup do Gmail na prévia

  // Abre/fecha um painel lateral (mostra só o container escolhido; um por vez).
  const togglePainel = (key) => setPainelAberto((p) => (p === key ? null : key))
  const desfazer = () => { try { editorRef.current?.UndoManager.undo() } catch (_) {} }
  const refazer = () => { try { editorRef.current?.UndoManager.redo() } catch (_) {} }
  const limparCanvas = async () => {
    if (!(await confirm({ title: 'Limpar o e-mail?', message: 'Remove tudo do canvas. Não dá pra desfazer depois de salvar.', confirmLabel: 'Limpar' }))) return
    const ed = editorRef.current
    if (ed) { ed.setComponents(PLACEHOLDER); ed.setStyle('') }
  }

  // Arrastar o dock flutuante pela pegada (com overlay pra não travar sobre o canvas/iframe).
  const iniciarArraste = (e) => {
    e.preventDefault()
    const dock = dockRef.current
    const parent = dock?.offsetParent
    if (!dock || !parent) return
    const r = dock.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const offX = e.clientX - r.left
    const offY = e.clientY - r.top
    setArrastando(true)
    const onMove = (ev) => {
      let left = ev.clientX - pr.left - offX
      let top = ev.clientY - pr.top - offY
      left = Math.max(6, Math.min(left, pr.width - r.width - 6))
      top = Math.max(6, Math.min(top, pr.height - r.height - 6))
      setDockPos({ left, top })
    }
    const onUp = () => {
      setArrastando(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Mantém o uid disponível pro upload do Asset Manager (o editor é criado uma vez só).
  useEffect(() => { uidRef.current = user?.uid || null }, [user?.uid])

  // Carrega o remetente principal (usado no mockup do Gmail na prévia).
  useEffect(() => {
    if (!user?.uid) return
    ;(async () => {
      try {
        const provs = await getEmailProviders(user.uid)
        const rem = provs.flatMap((p) => p.remetentes || []).find((r) => r.email)
        if (rem) { setRemetente({ nome: rem.nome || '', email: rem.email }); return }
        const cfg = await getEmailConfig(user.uid)
        if (cfg?.fromEmail) setRemetente({ nome: cfg.fromName || '', email: cfg.fromEmail })
      } catch (_) {}
    })()
  }, [user?.uid])

  // Inicializa o GrapesJS uma vez
  useEffect(() => {
    if (editorRef.current || !containerRef.current) return
    const editor = grapesjs.init({
      container: containerRef.current,
      height: '100%',
      width: 'auto',
      storageManager: false,
      // Estiliza SEMPRE o elemento selecionado (por id), NUNCA a classe compartilhada —
      // senão mudar a cor/largura de uma div mudava todas que têm a classe am-drop.
      selectorManager: { componentFirst: true },
      // Cada painel é renderizado no NOSSO container (controlamos qual aparece).
      blockManager: { appendTo: '#am-blocks' },
      styleManager: { appendTo: '#am-styles' },
      traitManager: { appendTo: '#am-traits' },
      layerManager: { appendTo: '#am-layers' },
      assetManager: {
        // O usuário sobe a imagem → vai pro NOSSO Storage (pasta dele) → entra na galeria.
        upload: false,
        autoAdd: true,
        dropzone: true,
        uploadText: 'Arraste a imagem aqui ou clique para enviar',
        addBtnText: 'Adicionar por URL',
        uploadName: 'files',
        uploadFile: async (e) => {
          const files = e.dataTransfer ? e.dataTransfer.files : e.target.files
          const uid = uidRef.current
          if (!uid) { toast.error('Faça login para enviar imagens.'); return }
          const ed = editorRef.current
          for (const file of files) {
            try {
              const asset = await uploadEmailAsset(uid, file)
              ed?.AssetManager.add(asset)
            } catch (err) { toast.error(err.message || 'Falha ao enviar imagem.') }
          }
        },
      },
      i18n: {
        messages: {
          en: {
            assetManager: {
              modalTitle: 'Suas imagens',
              uploadTitle: 'Enviar imagem',
            },
          },
        },
      },
      plugins: [(ed) => presetNewsletter(ed, {
        modalTitleImport: 'Importar HTML',
        modalTitleExport: 'HTML do e-mail',
      })],
    })
    editorRef.current = editor

    // Troca os blocos "crus" do preset por blocos bonitos com ícone (Título, Texto, Imagem…).
    registrarBlocosEmail(editor)

    // Esconde ícones da barra que confundem/duplicam (view components, preview, fullscreen,
    // código </>, import HTML e o toggle de imagens "imgx").
    // Tudo vai pro dock flutuante — limpa a barra de cima e as abas laterais.
    ;['sw-visibility', 'preview', 'fullscreen', 'export-template',
      'gjs-open-import-webpage', 'gjs-open-import-template', 'gjs-toggle-images',
      'undo', 'redo', 'canvas-clear', 'gjs-open-import',
    ].forEach((id) => { try { editor.Panels.removeButton('options', id) } catch (_) {} })
    // Os painéis viraram containers nossos (appendTo) — remove os painéis de abas do GrapesJS.
    ;['views', 'views-container'].forEach((id) => { try { editor.Panels.removePanel(id) } catch (_) {} })


    editor.on('load', () => {
      // Dica visual "Arraste blocos aqui" nas caixas VAZIAS — só no editor, NÃO vai pro e-mail.
      try {
        const doc = editor.Canvas.getDocument()
        if (doc && !doc.getElementById('am-editor-helpers')) {
          const st = doc.createElement('style')
          st.id = 'am-editor-helpers'
          st.textContent = '.am-drop:empty{min-height:56px;outline:1px dashed #c4b5fd;outline-offset:-4px;border-radius:8px;position:relative}.am-drop:empty::before{content:"Arraste blocos aqui";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#a78bfa;font:500 12px Arial,sans-serif;pointer-events:none}'
          doc.head.appendChild(st)
        }
      } catch (_) {}

      // Setores de estilo ENXUTOS pra e-mail (definições explícitas; sobrescreve o preset).
      try {
        editor.StyleManager.getSectors().reset([
          { id: 'am-texto', name: 'Texto', open: true, properties: [
            { property: 'font-size', name: 'Tamanho', type: 'number', units: ['px', '%'], unit: 'px', default: '15px' },
            { property: 'color', name: 'Cor do texto', type: 'color' },
            { property: 'font-weight', name: 'Peso', type: 'select', default: '400', options: [{ id: '300', name: 'Fino' }, { id: '400', name: 'Normal' }, { id: '600', name: 'Semi' }, { id: '700', name: 'Negrito' }] },
            { property: 'line-height', name: 'Altura da linha', type: 'number', units: ['px', '%'], unit: 'px' },
          ] },
          { id: 'am-align', name: 'Alinhamento', open: true, properties: [
            { property: 'text-align', name: 'Horizontal', type: 'radio', default: 'left', options: [{ id: 'left', name: 'Esq.' }, { id: 'center', name: 'Centro' }, { id: 'right', name: 'Dir.' }] },
            { property: 'vertical-align', name: 'Vertical', type: 'select', default: 'top', options: [{ id: 'top', name: 'Topo' }, { id: 'middle', name: 'Meio' }, { id: 'bottom', name: 'Base' }] },
          ] },
          { id: 'am-fundo', name: 'Fundo', open: true, properties: [
            { property: 'background-color', name: 'Cor de fundo', type: 'color' },
            { property: 'background-image', name: 'Imagem de fundo', type: 'file', functionName: 'url', full: true },
            { property: 'background-size', name: 'Tamanho', type: 'select', default: 'auto', options: [{ id: 'auto', name: 'Auto' }, { id: 'cover', name: 'Cobrir' }, { id: 'contain', name: 'Conter' }] },
            { property: 'background-repeat', name: 'Repetir', type: 'select', default: 'no-repeat', options: [{ id: 'no-repeat', name: 'Não' }, { id: 'repeat', name: 'Sim' }, { id: 'repeat-x', name: 'Horizontal' }, { id: 'repeat-y', name: 'Vertical' }] },
            { property: 'background-position', name: 'Posição', type: 'select', default: 'center center', options: [{ id: 'center center', name: 'Centro' }, { id: 'top center', name: 'Topo' }, { id: 'bottom center', name: 'Base' }, { id: 'left center', name: 'Esquerda' }, { id: 'right center', name: 'Direita' }] },
          ] },
          { id: 'am-dim', name: 'Dimensão', open: false, properties: [
            { property: 'width', name: 'Largura', type: 'number', units: ['px', '%'], unit: 'px' },
            { property: 'max-width', name: 'Largura máx.', type: 'number', units: ['px', '%'], unit: 'px' },
            { property: 'height', name: 'Altura', type: 'number', units: ['px', '%'], unit: 'px' },
          ] },
          { id: 'am-espaco', name: 'Espaçamento', open: false, properties: [
            { property: 'padding', name: 'Interno', type: 'composite', properties: [
              { property: 'padding-top', name: 'Cima', type: 'number', units: ['px'], unit: 'px' },
              { property: 'padding-right', name: 'Direita', type: 'number', units: ['px'], unit: 'px' },
              { property: 'padding-bottom', name: 'Baixo', type: 'number', units: ['px'], unit: 'px' },
              { property: 'padding-left', name: 'Esquerda', type: 'number', units: ['px'], unit: 'px' },
            ] },
            { property: 'margin', name: 'Externo', type: 'composite', properties: [
              { property: 'margin-top', name: 'Cima', type: 'number', units: ['px'], unit: 'px' },
              { property: 'margin-right', name: 'Direita', type: 'number', units: ['px'], unit: 'px' },
              { property: 'margin-bottom', name: 'Baixo', type: 'number', units: ['px'], unit: 'px' },
              { property: 'margin-left', name: 'Esquerda', type: 'number', units: ['px'], unit: 'px' },
            ] },
          ] },
          { id: 'am-borda', name: 'Borda', open: false, properties: [
            { property: 'border-radius', name: 'Cantos', type: 'number', units: ['px'], unit: 'px' },
          ] },
        ])
      } catch (_) {}

      // Body (wrapper): libera fundo (cor/imagem) + text-align pra alinhar/centralizar o conteúdo dentro dele.
      try {
        const wrapper = editor.getWrapper()
        wrapper.set('stylable', ['background', 'background-color', 'background-image', 'background-size', 'background-repeat', 'background-position', 'text-align'])
      } catch (_) {}
    })

    // Ao ABRIR o gerenciador (botão Imagens, imagem de fundo OU duplo-clique numa imagem):
    // se a coleção estiver VAZIA, carrega as imagens do Storage (com o foguetinho).
    // Checa a coleção real (não um flag) — funciona por qualquer caminho de abertura.
    editor.on('asset:open', async () => {
      const am = editor.AssetManager
      if (am.getAll().length > 0) return // já tem imagens
      const uid = uidRef.current
      if (!uid) return
      setCarregandoImgs(true)
      try {
        const assets = await listEmailAssets(uid)
        if (assets.length) am.add(assets)
      } catch (_) {
        toast.error('Não consegui carregar suas imagens. Tente de novo.')
      } finally {
        setCarregandoImgs(false)
      }
    })

    // Ao remover um asset da galeria, apaga do Storage também.
    editor.on('asset:remove', (asset) => {
      const src = asset?.get?.('src') || asset?.src
      if (src && /firebasestorage|storage\.googleapis/.test(src)) deleteEmailAsset(src)
    })

    // Ao soltar o bloco "HTML" abre popup pra digitar; ao soltar "DTC" abre popup dos pré-prontos.
    editor.on('block:drag:stop', (component, block) => {
      try {
        const bid = block?.id || block?.get?.('id')
        if (bid === 'e-html' && component) {
          htmlTargetRef.current = component
          setHtmlBlockCode('')
          setShowHtmlBlock(true)
        } else if (bid === 'e-dtc' && component) {
          dtcTargetRef.current = component
          setShowDtc(true)
        }
      } catch (_) {}
    })

    // Alinhamento CASCATA: ao setar text-align num container (bloco/div/section/td),
    // aplica em TODOS os filhos — assim "Centro" centraliza tudo o que está dentro.
    // Precisa mexer no atributo style inline (que ganha da regra) e no content cru.
    let propagandoAlign = false
    editor.on('component:styleUpdate:text-align', (component) => {
      if (propagandoAlign || !component) return
      const val = component.getStyle()?.['text-align']
      if (!val) return
      propagandoAlign = true
      try {
        // margin p/ centralizar o PRÓPRIO bloco (quando tem largura definida < 100%)
        const marginPorAlinhamento = val === 'center'
          ? { 'margin-left': 'auto', 'margin-right': 'auto' }
          : val === 'right'
            ? { 'margin-left': 'auto', 'margin-right': '0' }
            : { 'margin-left': '0', 'margin-right': 'auto' }
        const aplicarFundo = (comp) => {
          comp.components?.().forEach((child) => {
            try {
              // 1) alinha o CONTEÚDO (texto/inline) do filho
              child.addStyle({ 'text-align': val, ...marginPorAlinhamento })
              const at = child.getAttributes ? child.getAttributes() : {}
              if (at && at.style && /text-align/i.test(at.style)) {
                child.addAttributes({ style: at.style.replace(/text-align\s*:\s*[^;]+;?/gi, `text-align:${val};`) })
              }
              const cont = child.get('content')
              if (typeof cont === 'string' && cont && /text-align/i.test(cont)) {
                child.set('content', cont.replace(/text-align\s*:\s*[^;"']+/gi, `text-align:${val}`))
              }
            } catch (_) {}
            aplicarFundo(child)
          })
        }
        aplicarFundo(component)
      } finally {
        propagandoAlign = false
      }
    })

    // Renomeia "Table cell" → "Bloco" no editor (nome do componente).
    try { editor.DomComponents.addType('cell', { model: { defaults: { name: 'Bloco' } } }) } catch (_) {}

    // Largura/altura num BLOCO de célula única (1 Bloco): a tabela é 100%, então
    // propaga a medida pra própria tabela — senão ela ignora e nada muda.
    ;['width', 'max-width', 'height'].forEach((prop) => {
      editor.on(`component:styleUpdate:${prop}`, (component) => {
        try {
          const el = component?.getEl?.()
          if (!el || el.tagName !== 'TD') return
          // sobe até a TABELA de verdade (td → tr → tbody → table)
          let table = component.parent?.()
          while (table && table.getEl?.()?.tagName !== 'TABLE') table = table.parent?.()
          if (!table) return
          const cells = table.find ? table.find('td') : []
          if (cells.length !== 1) return // só bloco simples; multi-coluna resize por célula
          const val = component.getStyle()?.[prop]
          if (val) table.addStyle({ [prop]: val })
        } catch (_) {}
      })
    })
    setReady(true)
    // Garante que o × do modal de imagens SEMPRE fecha (às vezes o modal aberto pelo
    // seletor de "imagem de fundo" não fechava no clique do ×).
    const fecharModalNoX = (e) => {
      if (e.target?.closest?.('.gjs-mdl-btn-close')) {
        try { editor.Modal.close() } catch (_) {}
        try { editor.AssetManager.close() } catch (_) {}
      }
    }
    document.addEventListener('click', fecharModalNoX, true)

    return () => {
      document.removeEventListener('click', fecharModalNoX, true)
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

  // As imagens são carregadas ao ABRIR o gerenciador (handler asset:open na init),
  // checando a coleção real — cobre botão Imagens, imagem de fundo e duplo-clique numa imagem.

  // Enquanto carrega as imagens, marca o body pra ESCONDER o modal (só mostra o foguetinho).
  useEffect(() => {
    document.body.classList.toggle('imgs-carregando', carregandoImgs)
    return () => document.body.classList.remove('imgs-carregando')
  }, [carregandoImgs])

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
    // Trava de quantidade: só bloqueia ao criar um template NOVO acima do limite do plano
    const limite = limiteDe('templates')
    if (!selectedId && templates.length >= limite) {
      toast.error(`Seu plano permite ${limite} template${limite === 1 ? '' : 's'}. Faça upgrade pra criar mais.`)
      setUpgradeOpen(true)
      return
    }
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

  // Pré-visualização do e-mail renderizado (mockup estilo Gmail)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewInfo, setPreviewInfo] = useState(null) // dados do mockup: remetente, assunto, data, cor do avatar
  const [iframeH, setIframeH] = useState(600) // altura auto do corpo do e-mail dentro do mockup
  const abrirPreview = () => {
    const editor = editorRef.current
    if (!editor) return
    const html = editor.getHtml()
    const css = editor.getCss()
    setPreviewHtml(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar{display:none;width:0;height:0}body{margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif}${css}</style></head><body>${html}</body></html>`)
    // Congela os dados do remetente/assunto/data pro mockup do Gmail
    const nomeRem = remetente?.nome?.trim() || (remetente?.email ? remetente.email.split('@')[0] : 'Sua Empresa')
    const emailRem = remetente?.email || 'contato@suaempresa.com'
    const inicial = (nomeRem.trim()[0] || 'S').toUpperCase()
    const cores = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#0b8043']
    const cor = cores[inicial.charCodeAt(0) % cores.length]
    const d = new Date()
    const dataLabel = `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    setPreviewInfo({ nome: nomeRem, email: emailRem, inicial, cor, dataLabel, subject: (subject || '').trim() || 'Assunto do seu e-mail' })
    setIframeH(600)
    setShowPreview(true)
  }

  // Abre a galeria de imagens. O carregamento (lazy + loading) acontece no
  // handler 'asset:open' na init — assim funciona por QUALQUER caminho que abra
  // o gerenciador (botão Imagens, imagem de fundo no Estilo, etc.).
  const abrirImagens = () => {
    editorRef.current?.runCommand('open-assets')
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

  // Aplica o HTML digitado no bloco HTML solto (substitui o placeholder pelo HTML renderizado).
  const aplicarHtmlBlock = () => {
    const comp = htmlTargetRef.current
    const raw = htmlBlockCode.trim()
    if (!comp) { setShowHtmlBlock(false); return }
    try {
      const parent = comp.parent()
      const idx = comp.index()
      comp.remove()
      if (raw && parent) parent.append(raw, { at: idx })
    } catch (_) {
      try { comp.remove() } catch (_) {}
    }
    htmlTargetRef.current = null
    setShowHtmlBlock(false)
    setHtmlBlockCode('')
  }

  // Cancela o bloco HTML (remove o placeholder que foi solto).
  const cancelarHtmlBlock = () => {
    try { htmlTargetRef.current?.remove() } catch (_) {}
    htmlTargetRef.current = null
    setShowHtmlBlock(false)
    setHtmlBlockCode('')
  }

  // Insere o DTC pré-pronto escolhido no lugar do placeholder solto.
  const inserirDtc = (preset) => {
    const comp = dtcTargetRef.current
    if (!comp) { setShowDtc(false); return }
    try {
      const parent = comp.parent()
      const idx = comp.index()
      comp.remove()
      if (parent) parent.append(preset.html, { at: idx })
    } catch (_) {
      try { comp.remove() } catch (_) {}
    }
    dtcTargetRef.current = null
    setShowDtc(false)
    toast.success('Bloco DTC inserido! Ajuste os links/imagens e clique em Salvar.')
  }

  // Cancela o DTC (remove o placeholder que foi solto).
  const cancelarDtc = () => {
    try { dtcTargetRef.current?.remove() } catch (_) {}
    dtcTargetRef.current = null
    setShowDtc(false)
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
          <button onClick={abrirImagens} title="Imagens" className="btn-secondary min-h-[40px] min-w-[40px] justify-center px-2.5">
            <ImagePlus className="w-4 h-4" />
          </button>
          <button onClick={abrirPreview} title="Pré-visualizar" className="btn-secondary min-h-[40px] min-w-[40px] justify-center px-2.5">
            <Eye className="w-4 h-4" />
          </button>
          <button onClick={() => setShowTest(true)} title="Enviar teste" className="btn-secondary min-h-[40px] min-w-[40px] justify-center px-2.5">
            <Send className="w-4 h-4" />
          </button>
          <button onClick={handleSalvar} disabled={salvando} title="Salvar" className="btn-primary min-h-[40px] min-w-[40px] justify-center px-2.5">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
        </div>
      }
    >
      <MelhorarPlano trigger={false} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
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
                <div className="ml-auto flex items-center gap-0.5">
                  <ChavesPicker
                    buttonClassName="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    onPick={(chave) => {
                      const ta = subjectRef.current
                      const text = subject || ''
                      const start = ta ? ta.selectionStart : text.length
                      setSubject(text.slice(0, start) + chave + text.slice(start))
                      setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + chave.length, start + chave.length) } }, 0)
                    }}
                  />
                  <EmojiPicker
                    buttonClassName="p-1.5 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    onPick={(emoji) => {
                      const ta = subjectRef.current
                      const text = subject || ''
                      const start = ta ? ta.selectionStart : text.length
                      setSubject(text.slice(0, start) + emoji + text.slice(start))
                      setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + emoji.length, start + emoji.length) } }, 0)
                    }}
                  />
                </div>
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

        </div>

        {/* Coluna direita: editor (canvas + painel lateral custom) */}
        <div className="flex-1 min-h-0 min-w-0 app-panel overflow-hidden relative flex">
          {/* Área do canvas */}
          <div className="flex-1 min-w-0 relative">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm gap-2 bg-white/70 z-10">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando editor…
            </div>
          )}
          <div ref={containerRef} className="h-full" />

          {/* Overlay durante o arraste — impede o iframe do canvas de "engolir" o mouse */}
          {arrastando && <div className="absolute inset-0 z-40 cursor-grabbing" />}

          {/* Dock flutuante e movível: tudo aqui */}
          {ready && (
            <div
              ref={dockRef}
              style={dockPos ? { left: dockPos.left, top: dockPos.top } : { left: '50%', bottom: 18, transform: 'translateX(-50%)' }}
              className="absolute z-50 flex items-center gap-0.5 rounded-2xl bg-white/95 backdrop-blur shadow-xl border border-surface-200 p-1"
            >
              <button type="button" onMouseDown={iniciarArraste} title="Arraste pra mover" className="cursor-grab active:cursor-grabbing p-1.5 text-stone-300 hover:text-stone-500">
                <GripVertical className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-0.5 pr-1 mr-0.5 border-r border-surface-200">
                <DockBtn onClick={desfazer} title="Desfazer"><Undo2 className="w-4 h-4" /></DockBtn>
                <DockBtn onClick={refazer} title="Refazer"><Redo2 className="w-4 h-4" /></DockBtn>
                <DockBtn onClick={limparCanvas} title="Limpar tudo"><Eraser className="w-4 h-4" /></DockBtn>
                <DockBtn onClick={abrirCodigo} title="Código HTML"><Code2 className="w-4 h-4" /></DockBtn>
              </div>
              <DockBtn onClick={() => togglePainel('blocos')} title="Blocos" ativo={painelAberto === 'blocos'}><Plus className="w-4 h-4" /></DockBtn>
              <DockBtn onClick={() => togglePainel('estilo')} title="Estilo" ativo={painelAberto === 'estilo'}><Paintbrush className="w-4 h-4" /></DockBtn>
              <DockBtn onClick={() => togglePainel('config')} title="Configurações" ativo={painelAberto === 'config'}><Settings className="w-4 h-4" /></DockBtn>
              <DockBtn onClick={() => togglePainel('camadas')} title="Camadas" ativo={painelAberto === 'camadas'}><Layers className="w-4 h-4" /></DockBtn>
            </div>
          )}
          </div>{/* fim área do canvas */}

          {/* Painel lateral custom — cada manager no seu container; um por vez; some quando nada aberto */}
          <div className={`gjs-editor am-panel shrink-0 flex flex-col border-l border-surface-200 bg-white ${painelAberto ? 'w-72 xl:w-80' : 'w-0 overflow-hidden border-l-0'}`}>
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-100">
              <span className="text-sm font-semibold text-stone-800">{TITULOS_PAINEL[painelAberto] || ''}</span>
              <button onClick={() => setPainelAberto(null)} title="Fechar" className="p-1 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div id="am-blocks" style={{ display: painelAberto === 'blocos' ? 'block' : 'none' }} />
              <div id="am-styles" style={{ display: painelAberto === 'estilo' ? 'block' : 'none' }} />
              <div id="am-traits" style={{ display: painelAberto === 'config' ? 'block' : 'none' }} />
              <div id="am-layers" style={{ display: painelAberto === 'camadas' ? 'block' : 'none' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Modal: pré-visualização (mockup estilo Gmail — mostra como chega na caixa do cliente) */}
      {showPreview && previewInfo && (
        <div className="fixed inset-0 z-50 flex flex-col p-4 bg-stone-900/60 backdrop-blur-sm" onClick={() => setShowPreview(false)}>
          <div className="mx-auto w-[80vw] max-w-none flex-1 min-h-0 flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Barra da nossa modal */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-surface-100 bg-surface-50/70">
              <span className="text-xs font-medium text-stone-400 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-primary-500" /> Prévia</span>
              <button onClick={() => setShowPreview(false)} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
            </div>

            {/* Página estilo Gmail — rola tudo junto, sem barra visível (mouse/touch rolam) */}
            <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft no-scrollbar bg-white">
              <div className="w-full px-5 sm:px-10 pt-6">
                {/* Assunto + marcador */}
                <div className="flex items-start gap-2 mb-5">
                  <h1 className="flex-1 min-w-0 text-[21px] leading-snug font-normal text-stone-800">{previewInfo.subject}</h1>
                  <span className="mt-1 shrink-0 text-[11px] text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">Caixa de entrada</span>
                </div>
                {/* Remetente */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-base shrink-0" style={{ background: previewInfo.cor }}>{previewInfo.inicial}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-semibold text-stone-800 text-sm">{previewInfo.nome}</span>
                      <span className="text-xs text-stone-500 truncate">&lt;{previewInfo.email}&gt;</span>
                    </div>
                    <div className="text-xs text-stone-500">para mim ▾</div>
                  </div>
                  <div className="text-xs text-stone-400 whitespace-nowrap shrink-0">{previewInfo.dataLabel}</div>
                </div>
              </div>
              {/* Corpo do e-mail — iframe FULL WIDTH (o fundo do e-mail preenche tudo), altura automática */}
              <iframe
                title="Prévia do e-mail"
                srcDoc={previewHtml}
                scrolling="no"
                onLoad={(e) => {
                  const el = e.target
                  const medir = () => { try { setIframeH(Math.max(300, el.contentWindow.document.documentElement.scrollHeight)) } catch (_) {} }
                  medir(); setTimeout(medir, 300); setTimeout(medir, 900)
                }}
                className="block w-full border-0"
                style={{ height: iframeH }}
              />
              {/* Rodapé Responder / Encaminhar (só visual) */}
              <div className="w-full px-5 sm:px-10 py-6 flex gap-3">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-stone-300 text-sm text-stone-600">↩ Responder</span>
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-stone-300 text-sm text-stone-600">↪ Encaminhar</span>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Loading da galeria (foguetinho) — fundo transparente; o modal das imagens
          fica escondido (via classe no body) até terminar de carregar. */}
      {carregandoImgs && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 100000 }}>
          <PageLoader label="Carregando suas imagens…" />
        </div>
      )}

      {/* Modal: blocos DTC pré-prontos (escolher um pra inserir) */}
      {showDtc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={cancelarDtc}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[86vh] overflow-y-auto p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-stone-800">DTC</h3>
              <button onClick={cancelarDtc} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {DTC_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => inserirDtc(preset)}
                  className="text-left rounded-xl border border-surface-200 hover:border-primary-400 hover:shadow-md transition overflow-hidden group"
                >
                  <div className="bg-white overflow-hidden border-b border-surface-100" style={{ height: 200 }}>
                    <iframe
                      title={preset.nome}
                      scrolling="no"
                      tabIndex={-1}
                      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1140"></head><body style="margin:0;background:#fff">${preset.html}</body></html>`}
                      style={{ width: 1140, height: 640, border: 0, transformOrigin: 'top left', transform: 'scale(0.3)', pointerEvents: 'none' }}
                    />
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-stone-800">{preset.nome}</p>
                    {preset.descricao && <p className="text-xs text-stone-400 mt-0.5">{preset.descricao}</p>}
                    <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary-600 group-hover:text-primary-700">Usar este bloco →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: bloco HTML (digitar HTML que será renderizado no e-mail) */}
      {showHtmlBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={cancelarHtmlBlock}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[80vw] p-4 sm:p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold text-stone-800 flex items-center gap-2"><Code2 className="w-5 h-5 text-primary-600" /> Bloco HTML</h3>
              <p className="text-xs text-stone-500 mt-0.5">Cole ou escreva seu HTML — ele será renderizado direto no e-mail.</p>
            </div>
            <div className="rounded-xl border border-surface-300 overflow-auto max-h-[62vh]" style={{ background: '#2d2d2d' }}>
              <Editor
                value={htmlBlockCode}
                onValueChange={setHtmlBlockCode}
                highlight={(code) => Prism.highlight(code || '', Prism.languages.markup, 'markup')}
                padding={14}
                placeholder="<div style=&quot;padding:16px;text-align:center;&quot;>Seu HTML aqui…</div>"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 12.5,
                  color: '#e6e6e6',
                  minHeight: '42vh',
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={cancelarHtmlBlock} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={aplicarHtmlBlock} className="btn-primary min-h-[44px]"><Code2 className="w-4 h-4" /> Inserir no e-mail</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

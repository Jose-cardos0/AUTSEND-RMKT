import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../lib/firebase'
import { getMessageTemplates, saveMessageTemplate, deleteMessageTemplate, getCheckoutStores, getAudioTemplates, saveAudioTemplate, deleteAudioTemplate, uploadCallAudio } from '../lib/firestore'
import { uploadEmailAsset, listEmailAssets, deleteEmailAsset } from '../lib/storageAssets'
import { TEMPLATE_VARIABLES } from '../lib/constants'
import { lojaByKey } from '../lib/lojas'
import { criarGravador } from '../lib/audioRec'
import AudioPlayer from '../components/AudioPlayer'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import WhatsAppIcon from '../components/WhatsAppIcon'
import EmojiPicker from '../components/EmojiPicker'
import { useConfirm } from '../components/ConfirmDialog'
import { MessageSquare, Plus, Pencil, Trash2, Loader2, X, Copy, Check, Bold, Italic, Strikethrough, Code, Smile, Braces, ShoppingBag, Search, ChevronLeft, ChevronRight, Type, AudioLines, Play, Square, Upload, Pause, Image as ImageLucide } from 'lucide-react'
import micImg from '../assets/mic/mic.png'

const EMOJIS = ['😀', '😊', '😍', '🥰', '👍', '🙏', '👋', '❤️', '🔥', '✅', '⚡', '🎉', '⭐', '💰', '🎁', '📢', '⏳', '🚀', '💬', '👇', '🛒', '😱']

// Valores de exemplo pra prévia (o backend troca essas chaves no envio real).
const SAMPLE = {
  nome_cliente: 'João',
  numero_cliente: '+55 11 99999-9999',
  email_cliente: 'joao@email.com',
  nome_produto: 'Gekko Pan',
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Renderiza texto no estilo WhatsApp (negrito/itálico/tachado/mono + variáveis) pra prévia. */
function renderWhatsapp(text) {
  let t = escapeHtml(text || '')
  t = t
    .replace(/\{nome_cliente\}/gi, SAMPLE.nome_cliente)
    .replace(/\{numero_cliente\}/gi, SAMPLE.numero_cliente)
    .replace(/\{email_cliente\}/gi, SAMPLE.email_cliente)
    .replace(/\{nome_produto\}/gi, SAMPLE.nome_produto)
  t = t
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~(.+?)~/g, '<del>$1</del>')
    .replace(/\n/g, '<br/>')
  return t
}

/** Primeira URL/link encontrada no texto (com ou sem http). */
function extrairUrl(text) {
  const m = String(text || '').match(/(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i)
  return m ? m[0].replace(/[.,;:)]+$/, '') : ''
}

export default function MensagemTemplates() {
  const [user] = useAuthState(auth)
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [showEditor, setShowEditor] = useState(false)
  const [editId, setEditId] = useState(null)
  const [nome, setNome] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [copiadoId, setCopiadoId] = useState(null)
  const textareaRef = useRef(null)
  const [showEmojis, setShowEmojis] = useState(false)
  const [checkouts, setCheckouts] = useState([])
  const [showCheckouts, setShowCheckouts] = useState(false)
  const [checkoutQ, setCheckoutQ] = useState('')
  const [checkoutPage, setCheckoutPage] = useState(1)
  const [linkPreview, setLinkPreview] = useState(null)
  const previewCache = useRef(new Map())

  // ── Templates de áudio (Ligação IA) ──
  const [aba, setAba] = useState('texto') // 'texto' | 'audio' | 'imagens'
  // ── Biblioteca de imagens da conta (users/{uid}/emailAssets) ──
  const [imgs, setImgs] = useState([])
  const [enviandoImg, setEnviandoImg] = useState(false)
  const [excluindoImg, setExcluindoImg] = useState(null)
  const [imgPage, setImgPage] = useState(1)
  const [imgLightbox, setImgLightbox] = useState(null) // imagem aberta em tela cheia
  const imgInputRef = useRef(null)
  const [audioTemplates, setAudioTemplates] = useState([])
  const [showAudioEditor, setShowAudioEditor] = useState(false)
  const [audioNome, setAudioNome] = useState('')
  const [audioBlob, setAudioBlob] = useState(null) // Blob a subir (wav gravado ou mp3 escolhido)
  const [audioExt, setAudioExt] = useState('wav')
  const [audioTipo, setAudioTipo] = useState('gravado') // 'gravado' | 'upload'
  const [audioPreviewUrl, setAudioPreviewUrl] = useState('')
  const [gravando, setGravando] = useState(false)
  const [salvandoAudio, setSalvandoAudio] = useState(false)
  const [playingId, setPlayingId] = useState(null)
  const [loadingAudioId, setLoadingAudioId] = useState(null)
  const gravadorRef = useRef(null)
  const audioElRef = useRef(null)
  const fileInputRef = useRef(null)

  const iniciarGravacao = async () => {
    try {
      const rec = await criarGravador()
      gravadorRef.current = rec
      rec.start()
      setGravando(true)
    } catch (err) {
      toast.error('Não consegui acessar o microfone. Permita o acesso no navegador.')
    }
  }
  const pararGravacao = async () => {
    const rec = gravadorRef.current
    if (!rec) return
    try {
      const { wavBlob, url } = await rec.stop()
      rec.dispose()
      gravadorRef.current = null
      setGravando(false)
      setAudioBlob(wavBlob)
      setAudioExt('wav')
      setAudioTipo('gravado')
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
      setAudioPreviewUrl(url)
    } catch (err) {
      setGravando(false)
      toast.error('Erro ao finalizar a gravação.')
    }
  }
  const escolherArquivo = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!/audio\/(mpeg|mp3|wav|x-wav)/.test(f.type) && !/\.(mp3|wav)$/i.test(f.name)) {
      toast.error('Escolha um arquivo MP3 ou WAV.'); return
    }
    if (f.size > 10 * 1024 * 1024) { toast.error('Áudio muito grande (máx. 10 MB).'); return }
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
    setAudioBlob(f)
    setAudioExt(/\.wav$/i.test(f.name) ? 'wav' : 'mp3')
    setAudioTipo('upload')
    setAudioPreviewUrl(URL.createObjectURL(f))
    if (!audioNome.trim()) setAudioNome(f.name.replace(/\.[^.]+$/, ''))
  }
  const abrirNovoAudio = () => {
    setAudioNome(''); setAudioBlob(null); setAudioExt('wav'); setAudioTipo('gravado')
    if (audioPreviewUrl) { URL.revokeObjectURL(audioPreviewUrl); setAudioPreviewUrl('') }
    setGravando(false)
    setShowAudioEditor(true)
  }
  const fecharAudioEditor = () => {
    if (gravadorRef.current) { try { gravadorRef.current.dispose() } catch (_) {} gravadorRef.current = null }
    setGravando(false)
    setShowAudioEditor(false)
  }
  const salvarAudio = async () => {
    if (!audioBlob) { toast.error('Grave ou envie um áudio primeiro.'); return }
    setSalvandoAudio(true)
    try {
      const ct = audioExt === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      const { url, path } = await uploadCallAudio(user.uid, audioBlob, audioExt, ct)
      await saveAudioTemplate(user.uid, null, { nome: audioNome.trim() || 'Áudio sem título', audioUrl: url, storagePath: path, tipo: audioTipo, ext: audioExt })
      setAudioTemplates(await getAudioTemplates(user.uid))
      fecharAudioEditor()
      toast.success('Template de áudio salvo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar áudio')
    } finally {
      setSalvandoAudio(false)
    }
  }
  const excluirAudio = async (t) => {
    if (!(await confirm({ title: `Excluir "${t.nome || 'áudio'}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteAudioTemplate(user.uid, t)
      setAudioTemplates(await getAudioTemplates(user.uid))
      toast.success('Áudio excluído.')
    } catch (err) { toast.error(err.message || 'Erro ao excluir') }
  }
  const tocarAudio = (t) => {
    if (playingId === t.id) { audioElRef.current?.pause(); return }
    if (audioElRef.current) audioElRef.current.pause()
    const a = new Audio(t.audioUrl)
    audioElRef.current = a
    a.onended = () => { setPlayingId(null); setLoadingAudioId(null) }
    a.onpause = () => setPlayingId((cur) => (cur === t.id ? null : cur))
    a.onplaying = () => { setLoadingAudioId(null); setPlayingId(t.id) }
    setLoadingAudioId(t.id)
    a.play().catch(() => { setLoadingAudioId(null); toast.error('Não consegui tocar o áudio.') })
  }

  // ── Biblioteca de imagens: subir (do PC) e excluir ──
  const subirImagem = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setEnviandoImg(true)
    try {
      const img = await uploadEmailAsset(user.uid, f) // comprime <1 MB
      setImgs((prev) => [img, ...prev])
      toast.success('Imagem enviada.')
    } catch (err) { toast.error(err.message || 'Erro ao enviar imagem') }
    finally { setEnviandoImg(false) }
  }
  const excluirImagem = async (img) => {
    if (!(await confirm({ title: 'Excluir imagem?', message: 'Ela sai da sua biblioteca. Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    setExcluindoImg(img.src)
    try { await deleteEmailAsset(img.src); setImgs((prev) => prev.filter((x) => x.src !== img.src)) }
    catch { toast.error('Erro ao excluir') }
    finally { setExcluindoImg(null) }
  }

  // Envolve a seleção (negrito/itálico/etc.)
  const insertAtCursor = (before, after = '') => {
    const ta = textareaRef.current
    if (!ta) { setMensagem((m) => `${m}${before}${after}`); return }
    const start = ta.selectionStart, end = ta.selectionEnd
    const text = mensagem || ''
    const sel = text.slice(start, end)
    setMensagem(text.slice(0, start) + before + sel + after + text.slice(end))
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + sel.length) }, 0)
  }

  // Insere um texto (variável/emoji) na posição do cursor
  const inserirTexto = (str) => {
    const ta = textareaRef.current
    if (!ta) { setMensagem((m) => `${m}${str}`); return }
    const start = ta.selectionStart
    const text = mensagem || ''
    setMensagem(text.slice(0, start) + str + text.slice(start))
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + str.length, start + str.length) }, 0)
  }

  const carregar = async () => {
    if (!user?.uid) return
    setLoading(true)
    const [tpls, stores, audios, imagens] = await Promise.all([getMessageTemplates(user.uid), getCheckoutStores(user.uid), getAudioTemplates(user.uid), listEmailAssets(user.uid)])
    setTemplates(tpls)
    setAudioTemplates(audios)
    setImgs(imagens)
    const flat = (stores || [])
      .filter((s) => s.ativo !== false)
      .flatMap((s) => (s.produtos || []).filter((p) => p.link).map((p) => ({ ...p, loja: s.loja })))
    setCheckouts(flat)
    setLoading(false)
  }
  useEffect(() => { carregar() }, [user?.uid])

  // Prévia do link (busca og:image/título/descrição) — como o WhatsApp mostra o card.
  useEffect(() => {
    if (!showEditor) { setLinkPreview(null); return }
    const url = extrairUrl(mensagem)
    if (!url) { setLinkPreview(null); return }
    if (previewCache.current.has(url)) { setLinkPreview(previewCache.current.get(url)); return }
    let cancel = false
    const t = setTimeout(async () => {
      try {
        const { data } = await httpsCallable(functions, 'linkPreview')({ url })
        const info = data && (data.image || data.title) ? data : null
        previewCache.current.set(url, info)
        if (!cancel) setLinkPreview(info)
      } catch {
        if (!cancel) setLinkPreview(null)
      }
    }, 700)
    return () => { cancel = true; clearTimeout(t) }
  }, [mensagem, showEditor])

  const abrirNovo = () => { setEditId(null); setNome(''); setMensagem(''); setShowEmojis(false); setShowCheckouts(false); setLinkPreview(null); setShowEditor(true) }
  const abrirEditar = (t) => { setEditId(t.id); setNome(t.nome || ''); setMensagem(t.mensagem || ''); setShowEmojis(false); setShowCheckouts(false); setLinkPreview(null); setShowEditor(true) }

  const handleSalvar = async () => {
    if (!mensagem.trim()) { toast.error('Escreva a mensagem.'); return }
    setSalvando(true)
    try {
      await saveMessageTemplate(user.uid, editId, { nome: nome.trim() || 'Sem título', mensagem: mensagem.trim() })
      setTemplates(await getMessageTemplates(user.uid))
      setShowEditor(false)
      toast.success(editId ? 'Template atualizado.' : 'Template salvo.')
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const handleExcluir = async (t) => {
    if (!(await confirm({ title: `Excluir "${t.nome || 'template'}"?`, message: 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir' }))) return
    try {
      await deleteMessageTemplate(user.uid, t.id)
      setTemplates(await getMessageTemplates(user.uid))
      toast.success('Template excluído.')
    } catch (err) {
      toast.error(err.message || 'Erro ao excluir')
    }
  }

  const copiar = (t) => {
    navigator.clipboard.writeText(t.mensagem || '')
    setCopiadoId(t.id)
    setTimeout(() => setCopiadoId(null), 2000)
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  const IMGS_POR_PAGINA = 20
  const imgsTotalPag = Math.max(1, Math.ceil(imgs.length / IMGS_POR_PAGINA))
  const imgsPg = Math.min(imgPage, imgsTotalPag)
  const imgsPagina = imgs.slice((imgsPg - 1) * IMGS_POR_PAGINA, imgsPg * IMGS_POR_PAGINA)

  return (
    <PageShell
      badge="Geral · Templates"
      title="Templates"
      right={
        aba === 'imagens'
          ? <button onClick={() => imgInputRef.current?.click()} disabled={enviandoImg} className="btn-primary text-sm min-h-[44px]">{enviandoImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Enviar imagem</button>
          : <button onClick={aba === 'audio' ? abrirNovoAudio : abrirNovo} className="btn-primary text-sm min-h-[44px]"><Plus className="w-4 h-4" /> Criar template</button>
      }
    >
      {/* Abas Texto / Áudio */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface-100 mb-4">
        <button onClick={() => setAba('texto')} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${aba === 'texto' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
          <Type className="w-4 h-4" /> Texto {templates.length > 0 && <span className="text-[11px] text-stone-400">({templates.length})</span>}
        </button>
        <button onClick={() => setAba('audio')} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${aba === 'audio' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
          <AudioLines className="w-4 h-4" /> Áudio {audioTemplates.length > 0 && <span className="text-[11px] text-stone-400">({audioTemplates.length})</span>}
        </button>
        <button onClick={() => setAba('imagens')} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${aba === 'imagens' ? 'bg-white text-primary-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
          <ImageLucide className="w-4 h-4" /> Imagens {imgs.length > 0 && <span className="text-[11px] text-stone-400">({imgs.length})</span>}
        </button>
      </div>
      <input ref={imgInputRef} type="file" accept="image/*" onChange={subirImagem} className="hidden" />

      {aba === 'audio' ? (
        audioTemplates.length === 0 ? (
          <Panel>
            <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><AudioLines className="w-7 h-7" /></span>
              <h2 className="text-lg font-semibold text-stone-800">Nenhum áudio ainda</h2>
              <p className="text-sm text-stone-500 max-w-md leading-relaxed">
                Grave ou envie um MP3 pra usar como voz da <strong>Ligação IA</strong>.
              </p>
              <button onClick={abrirNovoAudio} className="btn-primary min-h-[44px]"><Plus className="w-4 h-4" /> Criar template</button>
            </div>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {audioTemplates.map((t) => (
              <div key={t.id} className="app-panel rounded-2xl p-4 flex items-center gap-3">
                <button onClick={() => tocarAudio(t)} className="shrink-0 h-11 w-11 flex items-center justify-center text-primary-600 hover:text-primary-800 transition" title={playingId === t.id ? 'Pausar' : 'Ouvir'}>
                  {loadingAudioId === t.id ? <Loader2 className="w-5 h-5 animate-spin" /> : playingId === t.id ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-stone-800 text-sm truncate">{t.nome || 'Áudio sem título'}</h3>
                  <p className="text-[11px] text-stone-400 flex items-center gap-1">
                    <AudioLines className="w-3 h-3" /> {t.tipo === 'upload' ? 'Enviado' : 'Gravado'} · {(t.ext || 'wav').toUpperCase()}
                  </p>
                </div>
                <button onClick={() => excluirAudio(t)} className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )
      ) : aba === 'imagens' ? (
        imgs.length === 0 ? (
          <Panel>
            <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><ImageLucide className="w-7 h-7" /></span>
              <h2 className="text-lg font-semibold text-stone-800">Nenhuma imagem ainda</h2>
              <p className="text-sm text-stone-500 max-w-md leading-relaxed">Suba imagens pra usar nos disparos e onde precisar. Ficam salvas na sua biblioteca (máx 1 MB cada).</p>
              <button onClick={() => imgInputRef.current?.click()} disabled={enviandoImg} className="btn-primary min-h-[44px]">{enviandoImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Enviar imagem</button>
            </div>
          </Panel>
        ) : (
          <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {imgsPagina.map((img) => (
              <div key={img.src} className="group relative app-panel rounded-2xl overflow-hidden">
                <button type="button" onClick={() => setImgLightbox(img)} className="block w-full aspect-square bg-surface-50" title="Abrir imagem">
                  <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
                </button>
                <button onClick={() => excluirImagem(img)} disabled={excluindoImg === img.src} className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600" title="Excluir">
                  {excluindoImg === img.src ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
          {imgsTotalPag > 1 && (
            <div className="flex items-center justify-between gap-2 pt-4">
              <span className="text-xs text-stone-500">Página {imgsPg} de {imgsTotalPag} · {imgs.length} imagem(ns)</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setImgPage((p) => Math.max(1, p - 1))} disabled={imgsPg <= 1} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setImgPage((p) => Math.min(imgsTotalPag, p + 1))} disabled={imgsPg >= imgsTotalPag} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
          </>
        )
      ) : (
      <>
      {templates.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><MessageSquare className="w-7 h-7" /></span>
            <h2 className="text-lg font-semibold text-stone-800">Nenhum template ainda</h2>
            <p className="text-sm text-stone-500 max-w-md leading-relaxed">
              Salve suas copys de WhatsApp aqui pra reusar nas automações, funis e disparos — é só copiar quando precisar.
            </p>
            <button onClick={abrirNovo} className="btn-primary min-h-[44px]"><Plus className="w-4 h-4" /> Criar template</button>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="app-panel rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-600 shrink-0" />
                <h3 className="font-semibold text-stone-800 text-sm truncate flex-1">{t.nome || 'Sem título'}</h3>
              </div>
              {/* Prévia WhatsApp do template */}
              <div className="rounded-xl overflow-hidden border border-surface-200/80 flex-1">
                <div className="p-2.5 bg-[#ece5dd] flex h-full">
                  <div className="max-w-[92%] ml-auto self-end bg-[#d9fdd3] rounded-lg rounded-tr-sm px-2.5 py-1.5 shadow-sm">
                    <p className="text-[13px] text-stone-800 break-words wa-preview leading-snug line-clamp-[8]" dangerouslySetInnerHTML={{ __html: renderWhatsapp(t.mensagem) }} />
                    <span className="block text-right text-[9px] text-stone-500 mt-0.5">23:15 ✓✓</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 pt-2 border-t border-surface-100">
                <button onClick={() => copiar(t)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-stone-600 hover:bg-surface-100 rounded-lg py-2 transition-colors">
                  {copiadoId === t.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} {copiadoId === t.id ? 'Copiado' : 'Copiar'}
                </button>
                <button onClick={() => abrirEditar(t)} className="p-2 rounded-lg text-stone-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleExcluir(t)} className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {/* Popup: criar / editar template */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowEditor(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92dvh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><MessageSquare className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">{editId ? 'Editar template' : 'Novo template'}</h3>
              <button onClick={() => setShowEditor(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Nome (pra você achar depois)</label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Carrinho abandonado 30% OFF"
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Editor */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">Mensagem</label>
                <div className="border border-surface-200 rounded-xl overflow-hidden bg-white">
                  {/* Toolbar */}
                  <div className="flex items-center gap-0.5 flex-wrap px-1.5 py-1.5 border-b border-surface-200 bg-surface-50/70">
                    <button type="button" onClick={() => insertAtCursor('*', '*')} title="Negrito" className="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors"><Bold className="w-4 h-4" /></button>
                    <button type="button" onClick={() => insertAtCursor('_', '_')} title="Itálico" className="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors"><Italic className="w-4 h-4" /></button>
                    <button type="button" onClick={() => insertAtCursor('~', '~')} title="Tachado" className="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors"><Strikethrough className="w-4 h-4" /></button>
                    <button type="button" onClick={() => insertAtCursor('```', '```')} title="Monoespaçado" className="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors"><Code className="w-4 h-4" /></button>
                    <div className="w-px h-5 bg-surface-200 mx-1" />
                    <EmojiPicker onPick={(e) => inserirTexto(e)} buttonClassName="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors" />
                    <div className="w-px h-5 bg-surface-200 mx-1" />
                    <button type="button" onClick={() => { setCheckoutQ(''); setCheckoutPage(1); setShowCheckouts(true) }} title="Inserir checkout" className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-primary-600 hover:bg-primary-50 text-xs font-semibold transition-colors"><ShoppingBag className="w-3.5 h-3.5" /> Checkout</button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    rows={8}
                    placeholder="Escreva sua copy de WhatsApp aqui..."
                    className="w-full px-3 py-2.5 text-sm resize-y leading-relaxed focus:outline-none min-h-[160px]"
                  />
                </div>

                {/* Variáveis */}
                <div className="mt-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-500 mb-1.5"><Braces className="w-3.5 h-3.5" /> Inserir variável</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => inserirTexto(v.key)}
                        title={v.label}
                        className="text-[11px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200/70 rounded-full px-2.5 py-1 transition-colors"
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Prévia WhatsApp */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">Prévia no WhatsApp</label>
                <div className="rounded-xl overflow-hidden border border-surface-200 h-full flex flex-col">
                  <div className="px-3 py-2 bg-[#075E54] text-white text-xs font-medium flex items-center gap-2 shrink-0">
                    <WhatsAppIcon className="w-4 h-4" white /> Como o cliente vê
                  </div>
                  <div className="p-4 bg-[#ece5dd] flex-1 min-h-[200px] flex flex-col justify-end">
                    <div className="self-end max-w-[88%] bg-[#d9fdd3] rounded-lg rounded-tr-sm px-2 py-2 shadow-sm">
                      {linkPreview && (
                        <div className="mb-1.5 rounded-md overflow-hidden bg-black/5">
                          {linkPreview.image && <img src={linkPreview.image} alt="" className="w-full max-h-44 object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                          <div className="px-2.5 py-1.5">
                            {linkPreview.title && <p className="text-[13px] font-semibold text-stone-800 leading-snug line-clamp-2">{linkPreview.title}</p>}
                            {linkPreview.description && <p className="text-[11px] text-stone-500 leading-snug line-clamp-2 mt-0.5">{linkPreview.description}</p>}
                            <p className="text-[10px] text-stone-400 mt-0.5 truncate uppercase tracking-wide">{linkPreview.domain}</p>
                          </div>
                        </div>
                      )}
                      <div className="px-1">
                        {mensagem.trim() ? (
                          <p className="text-sm text-stone-800 break-words wa-preview" dangerouslySetInnerHTML={{ __html: renderWhatsapp(mensagem) }} />
                        ) : (
                          <p className="text-sm text-stone-400 italic">Sua mensagem aparece aqui…</p>
                        )}
                        <span className="block text-right text-[10px] text-stone-500 mt-1">23:15 ✓✓</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <button onClick={() => setShowEditor(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={handleSalvar} disabled={salvando} className="btn-primary min-h-[44px]">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: inserir checkout (com busca + paginação) */}
      {showCheckouts && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCheckouts(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ShoppingBag className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Inserir checkout</h3>
              <button onClick={() => setShowCheckouts(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            {checkouts.length === 0 ? (
              <p className="px-2 py-6 text-sm text-stone-500 text-center leading-relaxed">Nenhum checkout salvo.<br />Cadastre em <Link to="/checkouts" className="text-primary-600 underline">Checkouts</Link>.</p>
            ) : (() => {
              const t = checkoutQ.trim().toLowerCase()
              const filt = t ? checkouts.filter((c) => (c.nome || '').toLowerCase().includes(t) || (c.link || '').toLowerCase().includes(t)) : checkouts
              const totPag = Math.max(1, Math.ceil(filt.length / 5))
              const pg = Math.min(checkoutPage, totPag)
              const itens = filt.slice((pg - 1) * 5, pg * 5)
              return (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input value={checkoutQ} onChange={(e) => { setCheckoutQ(e.target.value); setCheckoutPage(1) }} placeholder="Pesquisar checkout..." autoFocus className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
                  </div>
                  <ul className="space-y-1 min-h-[60px]">
                    {itens.length === 0 && <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>}
                    {itens.map((c, i) => {
                      const loja = lojaByKey(c.loja)
                      return (
                        <li key={c.id || i}>
                          <button type="button" onClick={() => { inserirTexto(c.link); setShowCheckouts(false) }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-100 text-left transition-colors">
                            {loja?.logo ? <img src={loja.logo} alt="" className="w-7 h-7 object-contain shrink-0" /> : <ShoppingBag className="w-5 h-5 text-stone-400 shrink-0" />}
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-stone-800 truncate">{c.nome}</span>
                              <span className="block text-[11px] text-stone-400 truncate">{c.link}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {totPag > 1 && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-stone-500">Página {pg} de {totPag}</span>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setCheckoutPage((p) => Math.max(1, p - 1))} disabled={pg <= 1} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                        <button onClick={() => setCheckoutPage((p) => Math.min(totPag, p + 1))} disabled={pg >= totPag} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Popup: gravar / subir áudio */}
      {showAudioEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={fecharAudioEditor}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><AudioLines className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">Novo template de áudio</h3>
              <button onClick={fecharAudioEditor} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Nome do áudio</label>
              <input value={audioNome} onChange={(e) => setAudioNome(e.target.value)} placeholder="Ex.: Oferta carrinho abandonado" className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm" />
            </div>

            {/* Gravar */}
            <div className="flex flex-col items-center gap-2 py-2">
              <button
                type="button"
                onClick={gravando ? pararGravacao : iniciarGravacao}
                className={`flex items-center justify-center transition ${gravando ? 'animate-pulse' : 'hover:scale-105'}`}
                title={gravando ? 'Parar gravação' : 'Gravar'}
              >
                {gravando ? <span className="w-12 h-12 rounded-2xl bg-red-500 shadow-lg" /> : <img src={micImg} alt="Gravar" className="w-20 h-20 object-contain" />}
              </button>
              <p className="text-xs text-stone-500">{gravando ? 'Gravando… toque pra parar' : 'Toque no microfone pra gravar'}</p>
            </div>

            {/* Subir arquivo */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-surface-200" />
              <span className="text-[11px] text-stone-400">ou</span>
              <div className="flex-1 h-px bg-surface-200" />
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-surface-200 text-sm font-medium text-stone-600 hover:bg-surface-50 transition">
              <Upload className="w-4 h-4" /> Subir áudio (MP3)
            </button>
            <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav" onChange={escolherArquivo} className="hidden" />

            {/* Prévia */}
            {audioPreviewUrl && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-stone-500 flex items-center gap-1"><AudioLines className="w-3.5 h-3.5" /> Prévia ({audioTipo === 'upload' ? 'enviado' : 'gravado'})</p>
                <AudioPlayer src={audioPreviewUrl} />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={fecharAudioEditor} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={salvarAudio} disabled={salvandoAudio || !audioBlob} className="btn-primary min-h-[44px]">{salvandoAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar</button>
            </div>
          </div>
        </div>
      )}
      {/* Lightbox: imagem em tela cheia */}
      {imgLightbox && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/80" onClick={() => setImgLightbox(null)}>
          <button onClick={() => setImgLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition"><X className="w-5 h-5" /></button>
          <img src={imgLightbox.src} alt={imgLightbox.name} className="max-w-full max-h-[88dvh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </PageShell>
  )
}

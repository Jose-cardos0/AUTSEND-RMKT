import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../lib/firebase'
import { getMessageTemplates, saveMessageTemplate, deleteMessageTemplate, getCheckoutStores } from '../lib/firestore'
import { TEMPLATE_VARIABLES } from '../lib/constants'
import { lojaByKey } from '../lib/lojas'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import WhatsAppIcon from '../components/WhatsAppIcon'
import { useConfirm } from '../components/ConfirmDialog'
import { MessageSquare, Plus, Pencil, Trash2, Loader2, X, Copy, Check, Bold, Italic, Strikethrough, Code, Smile, Braces, ShoppingBag, Search, ChevronLeft, ChevronRight } from 'lucide-react'

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
    const [tpls, stores] = await Promise.all([getMessageTemplates(user.uid), getCheckoutStores(user.uid)])
    setTemplates(tpls)
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

  return (
    <PageShell
      badge="Geral · Templates"
      title="Templates de mensagens"
      right={
        <button onClick={abrirNovo} className="btn-primary text-sm min-h-[44px]"><Plus className="w-4 h-4" /> Criar template</button>
      }
    >
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
              <p className="text-xs text-stone-500 whitespace-pre-wrap line-clamp-5 flex-1 leading-relaxed min-h-[3.5rem]">{t.mensagem}</p>
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
                    <div className="relative">
                      <button type="button" onClick={() => setShowEmojis((s) => !s)} title="Emoji" className="p-2 rounded-lg text-stone-500 hover:bg-surface-200 hover:text-stone-700 transition-colors"><Smile className="w-4 h-4" /></button>
                      {showEmojis && (
                        <div className="absolute left-0 top-full mt-1.5 p-2 rounded-xl bg-white border border-surface-200 shadow-lg z-20 grid grid-cols-6 gap-0.5 w-60 max-w-[calc(100vw-3rem)]">
                          {EMOJIS.map((e) => (
                            <button key={e} type="button" onClick={() => { inserirTexto(e); setShowEmojis(false) }} className="text-xl hover:bg-surface-100 rounded-lg p-1 transition-colors">{e}</button>
                          ))}
                        </div>
                      )}
                    </div>
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
    </PageShell>
  )
}

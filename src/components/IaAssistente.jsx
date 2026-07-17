import { useState, useRef, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { functions } from '../lib/firebase'
import { getIaBlocks, saveIaBlock, deleteIaBlock } from '../lib/firestore'
import { uploadEmailAsset } from '../lib/storageAssets'
import { X, Plus, Sparkles, ArrowUp, Loader2, Save, Trash2, ArrowLeft, User } from 'lucide-react'
import foguete from '../assets/foguetes/foguete1.png'

const iaGerar = httpsCallable(functions, 'iaGerarEmailHtml')

/** Envolve o HTML do e-mail num doc pra renderizar no iframe de prévia. */
const docPreview = (html) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff">${html || ''}</body></html>`

/** Avatar da IA: nosso foguetinho (inteiro, centralizado — sem cover). */
function AvatarIa() {
  return (
    <div className="w-7 h-7 rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0 p-1">
      <img src={foguete} alt="IA" className="w-full h-full object-contain" />
    </div>
  )
}

/**
 * Assistente de IA do construtor.
 * modo 'lista' = popup com os modelos IA salvos + "Novo IA".
 * modo 'chat'  = chat (balões) com o Grok + prévia ao lado (desktop) + salvar.
 */
export default function IaAssistente({ uid, fotoUsuario, onInsert, onClose }) {
  const [modo, setModo] = useState('lista')
  const [blocos, setBlocos] = useState([])
  const [carregando, setCarregando] = useState(true)

  const [input, setInput] = useState('')
  const [conversa, setConversa] = useState([]) // {de:'user'|'ia', texto, imgs?}
  const [historicoApi, setHistoricoApi] = useState([]) // {role, content} p/ o Grok
  const [imgs, setImgs] = useState([]) // {src, nome} chips
  const [gerando, setGerando] = useState(false)
  const [subindoImg, setSubindoImg] = useState(false)
  const [htmlAtual, setHtmlAtual] = useState('')
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [nomeModelo, setNomeModelo] = useState('')
  const fileRef = useRef(null)
  const fimRef = useRef(null)

  useEffect(() => {
    if (!uid) return
    setCarregando(true)
    getIaBlocks(uid).then(setBlocos).catch(() => {}).finally(() => setCarregando(false))
  }, [uid])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [conversa, gerando])

  const novoChat = () => {
    setConversa([]); setHistoricoApi([]); setInput(''); setImgs([]); setHtmlAtual(''); setSalvandoNome(false); setNomeModelo('')
    setModo('chat')
  }

  const enviar = async () => {
    const txt = input.trim()
    if ((!txt && !imgs.length) || gerando) return
    const imgsMsg = [...imgs]
    // balão do usuário (mantém o texto e as imagens visíveis)
    setConversa((c) => [...c, { de: 'user', texto: txt, imgs: imgsMsg }])
    // conteúdo pro Grok (com as URLs das imagens)
    let conteudo = txt
    if (imgsMsg.length) conteudo += (txt ? '\n\n' : '') + 'Imagens (use EXATAMENTE estas URLs no src das <img>):\n' + imgsMsg.map((i) => i.src).join('\n')
    const novoApi = [...historicoApi, { role: 'user', content: conteudo }]
    setHistoricoApi(novoApi)
    setInput(''); setImgs([]); setGerando(true)
    try {
      const res = await iaGerar({ mensagens: novoApi })
      const html = res?.data?.html || ''
      const mensagem = res?.data?.mensagem || 'Prontinho! Olha aqui do lado 🚀'
      if (!html) throw new Error('A IA não retornou o e-mail. Tente de novo.')
      setHtmlAtual(html)
      setConversa((c) => [...c, { de: 'ia', texto: mensagem }])
      setHistoricoApi([...novoApi, { role: 'assistant', content: html }])
    } catch (err) {
      setConversa((c) => [...c, { de: 'ia', texto: 'Ops, deu erro aqui 😅 tenta de novo?' }])
      toast.error(err?.message || 'Erro na IA')
    } finally {
      setGerando(false)
    }
  }

  const subirImagem = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !uid) return
    setSubindoImg(true)
    try {
      const { src, name } = await uploadEmailAsset(uid, file)
      setImgs((a) => [...a, { src, nome: name || 'imagem' }])
    } catch (err) {
      toast.error(err?.message || 'Erro ao subir imagem')
    } finally {
      setSubindoImg(false)
    }
  }

  const confirmarSalvar = async () => {
    const nome = nomeModelo.trim()
    if (!nome) { toast.error('Dê um nome ao modelo.'); return }
    if (!htmlAtual) return
    try {
      await saveIaBlock(uid, { nome, html: htmlAtual })
      toast.success('Modelo IA salvo!')
      onInsert(htmlAtual)
    } catch (err) {
      toast.error(err?.message || 'Erro ao salvar')
    }
  }

  const excluirBloco = async (id, ev) => {
    ev?.stopPropagation()
    try { await deleteIaBlock(uid, id); setBlocos((b) => b.filter((x) => x.id !== id)) } catch (_) {}
  }

  // ─────────────────────────── CHAT ───────────────────────────
  if (modo === 'chat') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col p-4 bg-stone-900/60 backdrop-blur-sm" onClick={onClose}>
        <div className="mx-auto w-full max-w-5xl flex-1 min-h-0 flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          {/* Cabeçalho */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-surface-100">
            <button onClick={() => setModo('lista')} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-primary-600"><ArrowLeft className="w-4 h-4" /> Voltar</button>
            <span className="font-semibold text-stone-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary-600" /> Criar com IA</span>
            <button onClick={onClose} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
          </div>

          {/* Corpo: PRÉVIA (esquerda) + CHAT (direita) no desktop; empilhado no mobile */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* CHAT (direita no desktop) */}
            <div className="order-2 flex flex-col min-h-0 md:w-[380px] md:border-l border-surface-100 md:h-auto h-[45%]">
              {/* Balões */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 scroll-y-soft no-scrollbar">
                {conversa.length === 0 && !gerando && (
                  <div className="h-full flex flex-col items-center justify-center text-center text-stone-400 gap-2 px-4">
                    <AvatarIa />
                    <p className="text-sm">Descreva o e-mail que você quer (pode enviar imagens). Depois é só pedir alterações.</p>
                  </div>
                )}
                {conversa.map((m, i) => m.de === 'user' ? (
                  <div key={i} className="flex items-end gap-2 justify-end">
                    <div className="max-w-[80%] bg-primary-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm break-words">
                      {m.imgs?.length > 0 && (
                        <div className="flex gap-1 mb-1 flex-wrap">
                          {m.imgs.map((im, j) => <img key={j} src={im.src} alt="" className="w-11 h-11 rounded-lg object-cover" />)}
                        </div>
                      )}
                      {m.texto}
                    </div>
                    {fotoUsuario
                      ? <img src={fotoUsuario} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-stone-500" /></div>}
                  </div>
                ) : (
                  <div key={i} className="flex items-end gap-2">
                    <AvatarIa />
                    <div className="max-w-[80%] bg-surface-100 text-stone-700 rounded-2xl rounded-bl-sm px-3 py-2 text-sm break-words">{m.texto}</div>
                  </div>
                ))}
                {gerando && (
                  <div className="flex items-end gap-2">
                    <AvatarIa />
                    <div className="bg-surface-100 rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-stone-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> montando…</div>
                  </div>
                )}
                <div ref={fimRef} />
              </div>

              {/* Salvar + input */}
              <div className="shrink-0 p-3 border-t border-surface-100 space-y-2">
                {htmlAtual && (
                  salvandoNome ? (
                    <div className="flex gap-2">
                      <input autoFocus value={nomeModelo} onChange={(e) => setNomeModelo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmarSalvar() }} placeholder="Nome do modelo" className="flex-1 px-3 h-9 rounded-lg border border-surface-200 text-sm focus:ring-0 focus:border-primary-400" />
                      <button onClick={confirmarSalvar} className="btn-primary text-sm min-h-[36px]"><Save className="w-4 h-4" /> Salvar</button>
                      <button onClick={() => setSalvandoNome(false)} className="btn-secondary text-sm min-h-[36px]">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setSalvandoNome(true)} className="btn-primary w-full text-sm min-h-[38px]"><Save className="w-4 h-4" /> Salvar modelo</button>
                  )
                )}

                <div className="rounded-2xl border border-surface-200 shadow-sm p-2.5 transition-colors focus-within:border-primary-400">
                  {imgs.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {imgs.map((im, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-primary-50 border border-primary-200 rounded-lg pl-1 pr-1.5 py-1 text-xs text-primary-700">
                          <img src={im.src} alt="" className="w-6 h-6 rounded object-cover" />
                          <span className="max-w-[90px] truncate">{im.nome}</span>
                          <button onClick={() => setImgs((a) => a.filter((_, j) => j !== i))} className="text-primary-400 hover:text-primary-700"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
                    rows={2}
                    placeholder={htmlAtual ? 'Peça uma alteração… (ex.: deixe o botão vermelho)' : 'Descreva o e-mail que você quer…'}
                    className="w-full resize-none border-0 outline-none focus:ring-0 focus:border-transparent text-sm px-1 bg-transparent placeholder:text-stone-400"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <button onClick={() => fileRef.current?.click()} disabled={subindoImg} title="Enviar imagem" className="w-8 h-8 flex items-center justify-center rounded-full text-stone-500 hover:bg-surface-100 disabled:opacity-50">
                      {subindoImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </button>
                    <button onClick={enviar} disabled={gerando || (!input.trim() && !imgs.length)} className="w-9 h-9 rounded-full bg-primary-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary-700 transition">
                      {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                    </button>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={subirImagem} />
                </div>
              </div>
            </div>

            {/* PRÉVIA (esquerda no desktop) */}
            <div className="order-1 flex-1 min-h-0 bg-surface-50 relative">
              {htmlAtual ? (
                <iframe title="Prévia IA" srcDoc={docPreview(htmlAtual)} className="w-full h-full border-0 bg-white" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-stone-400 gap-3 px-8">
                  <Sparkles className="w-9 h-9 text-primary-300" />
                  <p className="text-sm max-w-sm">A prévia do e-mail aparece aqui assim que a IA gerar.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────── LISTA (popup) ───────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[86vh] overflow-y-auto p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-stone-800 flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary-600" /> IA</h3>
          <div className="flex items-center gap-2">
            <button onClick={novoChat} className="btn-primary text-sm min-h-[36px]"><Plus className="w-4 h-4" /> Novo IA</button>
            <button onClick={onClose} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:bg-surface-100"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
        ) : blocos.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-14 gap-3 text-stone-400">
            <Sparkles className="w-9 h-9 text-primary-300" />
            <p className="text-sm max-w-xs">Nenhum modelo criado por IA ainda. Clique em <b className="text-primary-600">Novo IA</b> pra criar o primeiro.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {blocos.map((b) => (
              <div key={b.id} className="rounded-xl border border-surface-200 hover:border-primary-400 hover:shadow-md transition overflow-hidden group relative">
                <button onClick={() => onInsert(b.html)} className="w-full text-left">
                  <div className="bg-white overflow-hidden border-b border-surface-100" style={{ height: 190 }}>
                    <iframe title={b.nome} scrolling="no" tabIndex={-1} srcDoc={docPreview(b.html)} style={{ width: 1140, height: 640, border: 0, transformOrigin: 'top left', transform: 'scale(0.3)', pointerEvents: 'none' }} />
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-stone-800 truncate">{b.nome}</p>
                    <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-primary-600 group-hover:text-primary-700">Usar este bloco →</span>
                  </div>
                </button>
                <button onClick={(ev) => excluirBloco(b.id, ev)} title="Excluir" className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-surface-200 text-red-500 hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

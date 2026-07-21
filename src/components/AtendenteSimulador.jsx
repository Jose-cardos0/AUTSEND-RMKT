import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { simularAtendente } from '../lib/firestore'
import WhatsAppIcon from './WhatsAppIcon'
import { X, Send, Loader2, RotateCcw, FlaskConical } from 'lucide-react'

/** Transforma URLs do texto em links clicáveis (pra ver o checkout que a IA mandou). */
function comLinks(texto) {
  const partes = String(texto || '').split(/(https?:\/\/[^\s]+)/g)
  return partes.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer" className="underline text-primary-700 break-all">{p}</a>
      : <span key={i}>{p}</span>,
  )
}

/** Modal de teste: conversa com o atendente IA (mesmo cérebro, sem WhatsApp real). */
export default function AtendenteSimulador({ grupoId, nome, onClose }) {
  const [msgs, setMsgs] = useState([]) // [{ role:'user'|'assistant', text }]
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fimRef = useRef(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, enviando])

  const enviar = async () => {
    const t = input.trim()
    if (!t || enviando) return
    const novoHist = [...msgs, { role: 'user', text: t }]
    setMsgs(novoHist)
    setInput('')
    setEnviando(true)
    try {
      const r = await simularAtendente(grupoId, novoHist)
      setMsgs((m) => [...m, { role: 'assistant', text: r?.resposta || '(sem resposta)', midias: Array.isArray(r?.midias) ? r.midias : [] }])
    } catch (err) {
      toast.error(err.message || 'A IA não respondeu.')
      setMsgs((m) => m.slice(0, -1)) // desfaz a msg do usuário se falhou
      setInput(t)
    } finally { setEnviando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header estilo WhatsApp */}
        <div className="flex items-center gap-2.5 px-4 py-3 bg-[#075E54] text-white shrink-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><WhatsAppIcon className="w-5 h-5" white /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{nome || 'Atendente IA'}</p>
            <p className="text-[11px] text-white/70 flex items-center gap-1"><FlaskConical className="w-3 h-3" /> Simulação (não envia WhatsApp real)</p>
          </div>
          <button onClick={() => setMsgs([])} title="Reiniciar conversa" className="p-1.5 rounded-lg hover:bg-white/10"><RotateCcw className="w-4 h-4" /></button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#ece5dd] space-y-2">
          {msgs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-stone-500">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow"><WhatsAppIcon className="w-6 h-6 text-[#25D366]" /></span>
              <p className="text-sm max-w-[240px]">Escreva como se fosse um lead no WhatsApp. Ex.: <em>"oi, quanto custa?"</em></p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className="space-y-1.5">
              <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-lg px-3 py-2 shadow-sm text-sm text-stone-800 whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'}`}>
                  {comLinks(m.text)}
                </div>
              </div>
              {/* Mídias que saem logo após a resposta (imagem/áudio ligados ao checkout) */}
              {Array.isArray(m.midias) && m.midias.map((mid, j) => (
                <div key={j} className="flex justify-start">
                  <div className="max-w-[82%] rounded-lg rounded-tl-sm p-1 shadow-sm bg-white">
                    {mid.tipo === 'audio'
                      ? <audio controls src={mid.url} className="w-[240px] max-w-full" />
                      : <img src={mid.url} alt={mid.nome || ''} className="rounded-md max-w-full max-h-64 object-contain" />}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {enviando && (
            <div className="flex justify-start">
              <div className="bg-white rounded-lg rounded-tl-sm px-3 py-2 shadow-sm text-sm text-stone-400 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> digitando…</div>
            </div>
          )}
          <div ref={fimRef} />
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 p-3 border-t border-surface-100 bg-white shrink-0">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            placeholder="Escreva como um cliente…"
            className="flex-1 px-3.5 py-2.5 min-h-[44px] rounded-full border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          <button onClick={enviar} disabled={enviando || !input.trim()} className="h-11 w-11 shrink-0 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow hover:bg-[#1eb457] disabled:opacity-40 transition">
            {enviando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

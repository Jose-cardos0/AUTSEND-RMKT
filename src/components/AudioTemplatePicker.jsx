import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { getAudioTemplates } from '../lib/firestore'
import { AudioLines, X, Search, Play, Pause, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

const POR_PAGINA = 5

/**
 * Popup pra escolher um template de áudio (Ligação IA). Filtro + play + selecionar + paginação (5/pág).
 * Props: { uid, open, onClose, onPick(t), currentId }
 */
export default function AudioTemplatePicker({ uid, open, onClose, onPick, currentId }) {
  const [audios, setAudios] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [playingId, setPlayingId] = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const audioElRef = useRef(null)

  useEffect(() => {
    if (!open || !uid) return
    setLoading(true)
    getAudioTemplates(uid).then(setAudios).finally(() => setLoading(false))
    setQ(''); setPage(1)
  }, [open, uid])

  useEffect(() => { setPage(1) }, [q])
  useEffect(() => () => { if (audioElRef.current) audioElRef.current.pause() }, [])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? audios.filter((a) => (a.nome || '').toLowerCase().includes(t)) : audios
  }, [audios, q])

  const totalPag = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const pAtual = Math.min(page, totalPag)
  const pagina = filtrados.slice((pAtual - 1) * POR_PAGINA, pAtual * POR_PAGINA)

  const tocar = (t) => {
    if (playingId === t.id) { audioElRef.current?.pause(); return }
    if (audioElRef.current) audioElRef.current.pause()
    const a = new Audio(t.audioUrl)
    audioElRef.current = a
    a.onended = () => { setPlayingId(null); setLoadingId(null) }
    a.onpause = () => setPlayingId((cur) => (cur === t.id ? null : cur))
    a.onplaying = () => { setLoadingId(null); setPlayingId(t.id) }
    setLoadingId(t.id)
    a.play().catch(() => setLoadingId(null))
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><AudioLines className="w-4 h-4" /></span>
          <h3 className="text-sm font-semibold text-stone-800 flex-1">Escolher áudio</h3>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar áudio..." autoFocus className="w-full pl-9 pr-3 py-2.5 min-h-[42px] rounded-xl border border-surface-200 text-sm outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400" />
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-stone-400" /></div>
        ) : audios.length === 0 ? (
          <p className="px-2 py-6 text-sm text-stone-500 text-center leading-relaxed">Nenhum áudio salvo.<br />Grave ou envie um em <Link to="/templates" className="text-primary-600 underline">Templates → Áudio</Link>.</p>
        ) : (
          <>
            <ul className="space-y-1 min-h-[60px]">
              {pagina.length === 0 && <li className="px-3 py-6 text-sm text-stone-400 text-center">Nada encontrado</li>}
              {pagina.map((t) => {
                const sel = currentId === t.id
                return (
                  <li key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-xl ${sel ? 'bg-primary-50' : 'hover:bg-surface-100'}`}>
                    <button type="button" onClick={() => tocar(t)} className="shrink-0 h-9 w-9 flex items-center justify-center text-primary-600 hover:text-primary-800" title={playingId === t.id ? 'Pausar' : 'Ouvir'}>
                      {loadingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : playingId === t.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-stone-800 truncate">{t.nome || 'Áudio sem título'}</span>
                      <span className="block text-[11px] text-stone-400">{t.tipo === 'upload' ? 'Enviado' : 'Gravado'} · {(t.ext || 'wav').toUpperCase()}</span>
                    </span>
                    <button type="button" onClick={() => { onPick(t); onClose() }} className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg ${sel ? 'bg-primary-600 text-white' : 'text-primary-600 hover:bg-primary-100'}`}>
                      {sel ? <><Check className="w-3.5 h-3.5" /> Selecionado</> : 'Usar'}
                    </button>
                  </li>
                )
              })}
            </ul>
            {filtrados.length > POR_PAGINA && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-stone-500">Página {pAtual} de {totalPag} · {filtrados.length} áudio(s)</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pAtual <= 1} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setPage((p) => Math.min(totalPag, p + 1))} disabled={pAtual >= totalPag} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-surface-200 bg-white hover:bg-surface-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

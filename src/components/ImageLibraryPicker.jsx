import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { listEmailAssets, deleteEmailAsset } from '../lib/storageAssets'
import { Image as ImageIcon, X, Loader2, Trash2, Check } from 'lucide-react'

/**
 * Popup da BIBLIOTECA de imagens da conta (users/{uid}/emailAssets). Só a grade — o upload do
 * computador é tratado por quem abre (popup de origem). Aqui dá pra escolher ou deletar.
 * Props: { uid, open, onClose, onPick(img: {src, name}), currentSrc }
 */
export default function ImageLibraryPicker({ uid, open, onClose, onPick, currentSrc }) {
  const [imgs, setImgs] = useState([])
  const [loading, setLoading] = useState(false)
  const [excluindo, setExcluindo] = useState(null)

  useEffect(() => {
    if (!open || !uid) return
    setLoading(true)
    listEmailAssets(uid).then(setImgs).finally(() => setLoading(false))
  }, [open, uid])

  const excluir = async (img) => {
    setExcluindo(img.src)
    try { await deleteEmailAsset(img.src); setImgs((prev) => prev.filter((x) => x.src !== img.src)) }
    catch { toast.error('Erro ao excluir') }
    finally { setExcluindo(null) }
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ImageIcon className="w-4 h-4" /></span>
          <h3 className="text-sm font-semibold text-stone-800 flex-1">Biblioteca de imagens</h3>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-stone-400" /></div>
        ) : imgs.length === 0 ? (
          <p className="px-2 py-8 text-sm text-stone-500 text-center leading-relaxed">Nenhuma imagem na biblioteca ainda.<br />Anexe uma <strong>do computador</strong> — ela é salva aqui automaticamente.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[360px] overflow-y-auto">
            {imgs.map((img) => {
              const sel = currentSrc === img.src
              return (
                <div key={img.src} className={`group relative rounded-xl overflow-hidden border-2 ${sel ? 'border-primary-500' : 'border-surface-200'}`}>
                  <button type="button" onClick={() => { onPick(img); onClose() }} className="block w-full aspect-square bg-surface-50">
                    <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
                  </button>
                  <button type="button" onClick={() => excluir(img)} disabled={excluindo === img.src} className="absolute top-1 right-1 p-1 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600" title="Excluir">
                    {excluindo === img.src ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  </button>
                  {sel && <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center shadow"><Check className="w-3 h-3" /></span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

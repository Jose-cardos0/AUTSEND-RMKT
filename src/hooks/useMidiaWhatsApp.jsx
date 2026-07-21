import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { uploadCallAudio, saveAudioTemplate } from '../lib/firestore'
import { uploadEmailAsset } from '../lib/storageAssets'
import ImageLibraryPicker from '../components/ImageLibraryPicker'
import AudioTemplatePicker from '../components/AudioTemplatePicker'
import { Image as ImageLucide, AudioLines, Upload, Loader2, X } from 'lucide-react'

/**
 * Anexo de imagem + áudio pro WhatsApp (mesmo UI do Disparos), reutilizável.
 * Retorna os pedaços de UI pra montar em qualquer editor:
 *  - toolbarExtra: os 2 ícones (imagem/áudio) pra barra do MessageEditor
 *  - previews: a prévia dos anexos (miniatura + chip com X)
 *  - popups: os modais de origem + pickers + inputs (renderize 1x na página)
 *  - img/audio: { src, name } / { url, nome, ext } · setImg/setAudio · clear()
 *
 * @param {string} uid
 * @param {{ img?: any, audio?: any, onImg?: (v:any)=>void, onAudio?: (v:any)=>void }} [ctrl]
 *        Controlado (ex.: nós do funil): passe img/audio + onImg/onAudio pra persistir no nó.
 */
export default function useMidiaWhatsApp(uid, ctrl) {
  const controlado = !!ctrl
  const [imgLocal, setImgLocal] = useState(null)
  const [audioLocal, setAudioLocal] = useState(null)
  const img = controlado ? (ctrl.img ?? null) : imgLocal
  const audio = controlado ? (ctrl.audio ?? null) : audioLocal
  const setImg = (v) => (controlado ? ctrl.onImg?.(v) : setImgLocal(v))
  const setAudio = (v) => (controlado ? ctrl.onAudio?.(v) : setAudioLocal(v))

  const [imgOrigemOpen, setImgOrigemOpen] = useState(false)
  const [imgPickerOpen, setImgPickerOpen] = useState(false)
  const [enviandoImg, setEnviandoImg] = useState(false)
  const [audioOrigemOpen, setAudioOrigemOpen] = useState(false)
  const [audioPickerOpen, setAudioPickerOpen] = useState(false)
  const [enviandoAudio, setEnviandoAudio] = useState(false)
  const imgUpInputRef = useRef(null)
  const audioUpInputRef = useRef(null)

  const clear = () => { setImg(null); setAudio(null) }

  const subirImagemPc = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setEnviandoImg(true)
    try { const im = await uploadEmailAsset(uid, f); setImg(im); toast.success('Imagem anexada.') }
    catch (err) { toast.error(err.message || 'Erro ao enviar imagem') }
    finally { setEnviandoImg(false) }
  }

  // Áudio do computador: sobe pro Storage + salva na biblioteca de áudios (Templates → Áudio) e anexa.
  const subirAudioPc = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!/audio\/(mpeg|mp3|wav|x-wav)/.test(f.type) && !/\.(mp3|wav)$/i.test(f.name)) { toast.error('Escolha um MP3 ou WAV.'); return }
    if (f.size > 10 * 1024 * 1024) { toast.error('Áudio muito grande (máx. 10 MB).'); return }
    setEnviandoAudio(true)
    try {
      const ext = /\.wav$/i.test(f.name) ? 'wav' : 'mp3'
      const ct = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      const { url, path } = await uploadCallAudio(uid, f, ext, ct)
      const nome = f.name.replace(/\.[^.]+$/, '')
      await saveAudioTemplate(uid, null, { nome, audioUrl: url, storagePath: path, tipo: 'upload', ext })
      setAudio({ url, nome, ext })
      toast.success('Áudio anexado.')
    } catch (err) { toast.error(err.message || 'Erro ao enviar áudio') }
    finally { setEnviandoAudio(false) }
  }

  const toolbarExtra = (
    <>
      <button type="button" onClick={() => setImgOrigemOpen(true)} title="Anexar imagem" className={`p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors ${img ? 'text-primary-600 bg-primary-50' : 'text-stone-500 hover:text-stone-700 hover:bg-surface-200'}`}>
        <ImageLucide className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => setAudioOrigemOpen(true)} title="Anexar áudio" className={`p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors ${audio ? 'text-primary-600 bg-primary-50' : 'text-stone-500 hover:text-stone-700 hover:bg-surface-200'}`}>
        <AudioLines className="w-4 h-4" />
      </button>
    </>
  )

  const previews = (img || audio) ? (
    <div className="flex flex-wrap gap-2">
      {img && (
        <div className="relative">
          <img src={img.src} alt="" className="h-14 w-14 rounded-lg object-cover border border-surface-200" />
          <button type="button" onClick={() => setImg(null)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-700 text-white hover:bg-red-600 shadow" title="Remover"><X className="w-3 h-3" /></button>
        </div>
      )}
      {audio && (
        <div className="relative flex items-center gap-2 h-14 px-3 rounded-lg border border-surface-200 bg-surface-50">
          <AudioLines className="w-4 h-4 text-primary-600 shrink-0" />
          <span className="text-xs text-stone-700 max-w-[130px] truncate">{audio.nome || 'Áudio'}</span>
          <button type="button" onClick={() => setAudio(null)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-700 text-white hover:bg-red-600 shadow" title="Remover"><X className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  ) : null

  const popups = (
    <>
      <ImageLibraryPicker uid={uid} open={imgPickerOpen} onClose={() => setImgPickerOpen(false)} onPick={(im) => setImg(im)} currentSrc={img?.src} />
      <AudioTemplatePicker uid={uid} open={audioPickerOpen} onClose={() => setAudioPickerOpen(false)} onPick={(t) => setAudio({ url: t.audioUrl, nome: t.nome, ext: t.ext })} currentId={null} />
      <input ref={imgUpInputRef} type="file" accept="image/*" onChange={subirImagemPc} className="hidden" />
      <input ref={audioUpInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav" onChange={subirAudioPc} className="hidden" />

      {/* Popup: origem da imagem (Biblioteca / Computador) */}
      {imgOrigemOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setImgOrigemOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><ImageLucide className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Anexar imagem</h3>
              <button onClick={() => setImgOrigemOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <button type="button" onClick={() => { setImgOrigemOpen(false); setImgPickerOpen(true) }} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><ImageLucide className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-stone-800">Da biblioteca</span>
            </button>
            <button type="button" onClick={() => { setImgOrigemOpen(false); imgUpInputRef.current?.click() }} disabled={enviandoImg} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition disabled:opacity-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">{enviandoImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</span>
              <span className="text-sm font-medium text-stone-800">Do computador (máx 1 MB)</span>
            </button>
          </div>
        </div>
      )}

      {/* Popup: origem do áudio (Template / Computador) */}
      {audioOrigemOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setAudioOrigemOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><AudioLines className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-stone-800 flex-1">Anexar áudio</h3>
              <button onClick={() => setAudioOrigemOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>
            <button type="button" onClick={() => { setAudioOrigemOpen(false); setAudioPickerOpen(true) }} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><AudioLines className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-stone-800">Dos meus templates</span>
            </button>
            <button type="button" onClick={() => { setAudioOrigemOpen(false); audioUpInputRef.current?.click() }} disabled={enviandoAudio} className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-surface-50 text-left transition disabled:opacity-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">{enviandoAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</span>
              <span className="text-sm font-medium text-stone-800">Do computador (MP3/WAV)</span>
            </button>
          </div>
        </div>
      )}
    </>
  )

  return { img, audio, setImg, setAudio, clear, toolbarExtra, previews, popups }
}

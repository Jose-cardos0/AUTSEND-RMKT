import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Loader2 } from 'lucide-react'

const N = 44 // nº de barrinhas da waveform

const fmt = (s) => {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

// Padrão decorativo (usado enquanto carrega ou se não der pra ler o áudio real por CORS).
const padraoDefault = () =>
  Array.from({ length: N }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.7) * 0.5 + Math.sin(i * 1.9) * 0.3 + Math.cos(i * 0.35) * 0.2)
    return 0.2 + 0.8 * Math.min(1, v)
  })

/** Player custom com waveform de barrinhas (cara do app): play + barras clicáveis + tempo. */
export default function AudioPlayer({ src, className = '' }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [peaks, setPeaks] = useState(padraoDefault)

  // Lê o áudio pra desenhar a waveform real (amplitude por trecho). Se falhar (CORS), mantém o padrão.
  useEffect(() => {
    let cancel = false
    setPeaks(padraoDefault())
    if (!src) return
    ;(async () => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        const Ctx = window.AudioContext || window.webkitAudioContext
        const ctx = new Ctx()
        const audioBuf = await ctx.decodeAudioData(buf)
        ctx.close()
        const raw = audioBuf.getChannelData(0)
        const block = Math.floor(raw.length / N) || 1
        const arr = []
        for (let i = 0; i < N; i++) {
          let max = 0
          for (let j = 0; j < block; j++) { const v = Math.abs(raw[i * block + j] || 0); if (v > max) max = v }
          arr.push(max)
        }
        const norm = Math.max(...arr) || 1
        if (!cancel) setPeaks(arr.map((p) => Math.max(0.12, p / norm)))
      } catch (_) { /* CORS/decode falhou → mantém o padrão decorativo */ }
    })()
    return () => { cancel = true }
  }, [src])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); return }
    setLoading(true)
    a.play().catch(() => setLoading(false))
  }

  const onBarsClick = (e) => {
    const a = audioRef.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    a.currentTime = frac * dur
    setCur(a.currentTime)
  }

  const progresso = dur ? cur / dur : 0

  return (
    <div className={`flex items-center gap-2.5 rounded-xl border border-surface-200 bg-white px-2.5 py-2 ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime || 0)}
        onPlaying={() => { setPlaying(true); setLoading(false) }}
        onPlay={() => setPlaying(true)}
        onWaiting={() => setLoading(true)}
        onPause={() => { setPlaying(false); setLoading(false) }}
        onEnded={() => { setPlaying(false); setLoading(false) }}
      />
      <button type="button" onClick={toggle} className="shrink-0 h-9 w-9 flex items-center justify-center text-primary-600 hover:text-primary-800 transition" title={playing ? 'Pausar' : 'Ouvir'}>
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </button>
      <div onClick={onBarsClick} className="flex items-center gap-[2px] flex-1 min-w-0 h-9 cursor-pointer" role="slider" aria-label="Progresso do áudio">
        {peaks.map((p, i) => {
          const played = (i + 0.5) / N <= progresso
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-colors ${played ? 'bg-primary-500' : 'bg-surface-200'}`}
              style={{ height: `${Math.max(12, Math.round(p * 100))}%` }}
            />
          )
        })}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-stone-500 w-[68px] text-right">{fmt(cur)} / {fmt(dur)}</span>
    </div>
  )
}

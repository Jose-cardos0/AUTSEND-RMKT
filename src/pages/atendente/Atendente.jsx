import { useState, useEffect, useRef, useCallback } from 'react'
import { TelnyxRTC } from '@telnyx/webrtc'
import { Phone, PhoneOff, PhoneIncoming, Delete, Mic, MicOff, Loader2, LogOut, Wifi, WifiOff } from 'lucide-react'
import { parear, obterTokenWebrtc, getSessao, getRamalSalvo, salvarSessao, limparSessao } from '../../lib/atendente'

function fmtNum(n) {
  const d = String(n || '').replace(/[^\d+]/g, '')
  const only = d.replace(/\D/g, '')
  if (only.length === 11 && only.startsWith('1')) return `+1 (${only.slice(1, 4)}) ${only.slice(4, 7)}-${only.slice(7)}`
  return n
}
function fmtDur(s) {
  const m = Math.floor(s / 60), ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
// Garante um destino discável (E.164). Sem +, assume EUA se 10 dígitos.
function normDestino(v) {
  const t = String(v || '').trim()
  if (t.startsWith('+')) return '+' + t.slice(1).replace(/\D/g, '')
  const d = t.replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  return '+' + d
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#']

export default function Atendente() {
  const [fase, setFase] = useState('carregando') // carregando | login | conectando | pronto | erro
  const [erro, setErro] = useState('')
  const [ramal, setRamal] = useState(getRamalSalvo())
  const [codigo, setCodigo] = useState('')
  const [pareando, setPareando] = useState(false)

  const [discar, setDiscar] = useState('')
  const [chamadaEstado, setChamadaEstado] = useState(null) // saindo | tocando | recebendo | ativa
  const [chamadaDe, setChamadaDe] = useState('')
  const [duracao, setDuracao] = useState(0)
  const [mudo, setMudo] = useState(false)

  const clientRef = useRef(null)
  const callRef = useRef(null)
  const timerRef = useRef(null)

  // ── PWA: manifest + service worker ──
  useEffect(() => {
    document.title = 'Autsend Atendente'
    let link = document.querySelector('link[rel="manifest"]')
    const criado = !link
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
    const antigo = link.getAttribute('href')
    link.setAttribute('href', '/atendente.webmanifest')
    let meta = document.querySelector('meta[name="theme-color"]')
    const metaCriado = !meta
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
    const metaAntigo = meta.getAttribute('content')
    meta.setAttribute('content', '#0c0a09')
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-atendente.js', { scope: '/atendente' }).catch(() => {})
    return () => { // restaura ao sair da rota
      if (criado) link.remove(); else if (antigo) link.setAttribute('href', antigo)
      if (metaCriado) meta.remove(); else if (metaAntigo) meta.setAttribute('content', metaAntigo)
    }
  }, [])

  const pararTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const iniciarTimer = () => { pararTimer(); setDuracao(0); timerRef.current = setInterval(() => setDuracao((d) => d + 1), 1000) }
  const encerrarUI = useCallback(() => { callRef.current = null; setChamadaEstado(null); setChamadaDe(''); setMudo(false); pararTimer() }, [])

  // ── Conecta o softphone (TelnyxRTC) usando o token efêmero ──
  const conectar = useCallback(async () => {
    setFase('conectando'); setErro('')
    try {
      const { token, numero, nome } = await obterTokenWebrtc()
      if (numero || nome) { const r = { numero, nome }; setRamal(r); salvarSessao(getSessao(), r) }
      if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } clientRef.current = null }
      const client = new TelnyxRTC({ login_token: token })
      client.remoteElement = 'atendente-remote-audio'
      client.enableMicrophone = true
      client.on('telnyx.ready', () => setFase('pronto'))
      client.on('telnyx.error', () => setErro('Erro na conexão de voz. Tentando de novo…'))
      client.on('telnyx.socket.close', () => { /* deixa o SDK tentar reconectar */ })
      client.on('telnyx.notification', (n) => {
        if (n.type !== 'callUpdate' || !n.call) return
        const call = n.call
        const st = call.state
        const inbound = call.direction === 'inbound'
        if (st === 'hangup' || st === 'destroy') { encerrarUI(); return }
        callRef.current = call
        if (st === 'ringing' && inbound) {
          setChamadaDe(call.options?.remoteCallerNumber || call.options?.callerNumber || '')
          setChamadaEstado('recebendo')
        } else if (st === 'active') {
          setChamadaEstado('ativa'); if (!timerRef.current) iniciarTimer()
        } else if (st === 'ringing' || st === 'early') {
          setChamadaEstado('tocando')
        } else if (!inbound && (st === 'new' || st === 'requesting' || st === 'trying')) {
          setChamadaEstado('saindo')
        }
      })
      client.connect()
      clientRef.current = client
    } catch (e) {
      if (e.message === 'SEM_SESSAO') { setFase('login'); return }
      setErro(e.message || 'Não consegui conectar.'); setFase(getSessao() ? 'erro' : 'login')
    }
  }, [encerrarUI])

  // ── Boot: ?k= da URL (QR) → pareia; senão sessão salva → conecta; senão login ──
  useEffect(() => {
    const url = new URL(window.location.href)
    const k = url.searchParams.get('k')
    const boot = async () => {
      if (k) {
        url.searchParams.delete('k'); window.history.replaceState({}, '', url.pathname)
        setPareando(true)
        try { const { sessao, ramal: r } = await parear(k.trim().toUpperCase()); salvarSessao(sessao, r); setRamal(r); await conectar() }
        catch (e) { setErro(e.message); setFase('login') }
        finally { setPareando(false) }
        return
      }
      if (getSessao()) { await conectar(); return }
      setFase('login')
    }
    boot()
    return () => { pararTimer(); if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } } }
  }, [conectar])

  const parearManual = async () => {
    const key = codigo.trim().toUpperCase()
    if (key.length < 6) { setErro('Digite o código do ramal.'); return }
    setPareando(true); setErro('')
    try { const { sessao, ramal: r } = await parear(key); salvarSessao(sessao, r); setRamal(r); setCodigo(''); await conectar() }
    catch (e) { setErro(e.message) }
    finally { setPareando(false) }
  }

  const desconectar = () => {
    if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } clientRef.current = null }
    limparSessao(); setRamal(null); setFase('login'); encerrarUI()
  }

  const ligar = () => {
    if (!clientRef.current || fase !== 'pronto' || !discar) return
    try {
      const call = clientRef.current.newCall({ destinationNumber: normDestino(discar), callerNumber: ramal?.numero, audio: true, video: false })
      callRef.current = call; setChamadaEstado('saindo')
    } catch { setErro('Não consegui iniciar a ligação.') }
  }
  const atender = () => { try { callRef.current?.answer() } catch { /* ignore */ } }
  const desligar = () => { try { callRef.current?.hangup() } catch { /* ignore */ } encerrarUI() }
  const toggleMudo = () => { try { callRef.current?.toggleAudioMute(); setMudo((v) => !v) } catch { /* ignore */ } }
  const tecla = (t) => setDiscar((v) => (v + t).slice(0, 20))
  const apagar = () => setDiscar((v) => v.slice(0, -1))

  // ═══════════════ RENDER ═══════════════
  // O <audio> remoto fica FIXO fora do conteúdo que troca (senão remontaria a cada render e cortaria o áudio).
  const conteudo = () => {
  if (fase === 'carregando' || pareando) {
    return <div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400"><Loader2 className="w-8 h-8 animate-spin text-emerald-400" /><p className="text-sm">{pareando ? 'Pareando dispositivo…' : 'Carregando…'}</p></div>
  }

  if (fase === 'login') {
    return (
        <div className="flex-1 flex flex-col justify-center px-6 py-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 mb-4"><Phone className="w-8 h-8 text-emerald-400" /></div>
            <h1 className="text-2xl font-bold">Autsend Atendente</h1>
            <p className="text-sm text-stone-400 mt-1">Escaneie o QR do seu ramal ou digite o código.</p>
          </div>
          <label className="block text-xs font-medium text-stone-400 mb-2">Código do ramal</label>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters"
            onKeyDown={(e) => e.key === 'Enter' && parearManual()}
            className="w-full rounded-xl bg-stone-900 border border-stone-700 px-4 py-3.5 text-center text-2xl font-black tracking-widest tabular-nums focus:border-emerald-500 focus:outline-none" />
          {erro && <p className="text-sm text-red-400 mt-3 text-center">{erro}</p>}
          <button onClick={parearManual} disabled={pareando} className="mt-5 w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
            {pareando ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
          </button>
          <p className="text-xs text-stone-500 text-center mt-6">O acesso vale por 30 dias neste aparelho.</p>
        </div>
    )
  }

  if (fase === 'conectando' || fase === 'erro') {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          {fase === 'erro' ? <WifiOff className="w-10 h-10 text-red-400" /> : <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />}
          <p className="text-sm text-stone-300">{fase === 'erro' ? (erro || 'Sem conexão de voz.') : 'Conectando à central…'}</p>
          {fase === 'erro' && <button onClick={conectar} className="rounded-xl bg-emerald-500 text-stone-950 font-bold px-6 py-2.5">Tentar de novo</button>}
          {fase === 'erro' && <button onClick={desconectar} className="text-xs text-stone-500 underline">Sair e parear de novo</button>}
        </div>
    )
  }

  // Tela de chamada (recebendo / saindo / tocando / ativa)
  if (chamadaEstado) {
    const recebendo = chamadaEstado === 'recebendo'
    const ativa = chamadaEstado === 'ativa'
    const rotulo = recebendo ? 'Chamada recebida' : ativa ? fmtDur(duracao) : chamadaEstado === 'saindo' ? 'Chamando…' : 'Tocando…'
    const quem = recebendo ? (chamadaDe || 'Desconhecido') : discar || chamadaDe
    return (
        <div className="flex-1 flex flex-col items-center justify-between py-16 px-6">
          <div className="flex flex-col items-center gap-3 mt-10">
            <div className={`w-24 h-24 rounded-full bg-stone-800 flex items-center justify-center ${recebendo ? 'animate-pulse' : ''}`}>
              {recebendo ? <PhoneIncoming className="w-10 h-10 text-emerald-400" /> : <Phone className="w-10 h-10 text-stone-300" />}
            </div>
            <p className="text-2xl font-bold tabular-nums mt-2">{fmtNum(quem)}</p>
            <p className={`text-sm ${ativa ? 'text-emerald-400 font-semibold tabular-nums' : 'text-stone-400'}`}>{rotulo}</p>
          </div>
          <div className="flex items-center justify-center gap-8">
            {ativa && (
              <button onClick={toggleMudo} className={`w-14 h-14 rounded-full flex items-center justify-center ${mudo ? 'bg-white text-stone-900' : 'bg-stone-800 text-white'}`}>
                {mudo ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
            )}
            {recebendo && (
              <button onClick={atender} className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center shadow-lg"><Phone className="w-7 h-7 text-stone-950" /></button>
            )}
            <button onClick={desligar} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg"><PhoneOff className="w-7 h-7 text-white" /></button>
          </div>
        </div>
    )
  }

  // Discador (pronto)
  return (
      <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
        <div className="min-w-0">
          <p className="font-semibold truncate">{ramal?.nome || 'Ramal'}</p>
          <p className="text-xs text-stone-400 tabular-nums flex items-center gap-1.5"><Wifi className="w-3 h-3 text-emerald-400" /> {fmtNum(ramal?.numero)}</p>
        </div>
        <button onClick={desconectar} title="Sair" className="text-stone-500 hover:text-stone-300 p-2"><LogOut className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 flex flex-col justify-end px-6 pb-8">
        <div className="text-center py-8 min-h-[80px]">
          <p className="text-3xl font-bold tabular-nums break-all">{discar || <span className="text-stone-600">Digite um número</span>}</p>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {TECLAS.map((t) => (
            <button key={t} onClick={() => tecla(t)} className="h-16 rounded-full bg-stone-900 hover:bg-stone-800 text-2xl font-semibold active:scale-95 transition">{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 items-center">
          <div />
          <button onClick={ligar} disabled={!discar} className="w-16 h-16 mx-auto rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 flex items-center justify-center shadow-lg"><Phone className="w-7 h-7 text-stone-950" /></button>
          <button onClick={apagar} disabled={!discar} className="w-12 h-12 mx-auto rounded-full flex items-center justify-center text-stone-400 disabled:opacity-30"><Delete className="w-6 h-6" /></button>
        </div>
      </div>
      </>
  )
  }

  return (
    <div className="min-h-screen bg-stone-950 text-white flex flex-col items-center">
      <audio id="atendente-remote-audio" autoPlay />
      <div className="w-full max-w-md flex-1 flex flex-col">{conteudo()}</div>
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { TelnyxRTC } from '@telnyx/webrtc'
import { Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed, Delete, Mic, MicOff, Loader2, LogOut, Wifi, WifiOff, Grid3x3, Clock, Menu as MenuIcon } from 'lucide-react'
import { parear, obterTokenWebrtc, getSessao, getRamalSalvo, salvarSessao, limparSessao, getHistorico, addHistorico, enviarPresenca } from '../../lib/atendente'
import logo from '../../assets/autsendlogo.png'

function fmtNum(n) {
  const only = String(n || '').replace(/\D/g, '')
  if (only.length === 11 && only.startsWith('1')) return `+1 (${only.slice(1, 4)}) ${only.slice(4, 7)}-${only.slice(7)}`
  return n || '—'
}
function fmtDur(s) {
  const m = Math.floor(s / 60), ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
function fmtQuando(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  const d = new Date(ts)
  const mesmoDia = new Date().toDateString() === d.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
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

  const [aba, setAba] = useState('teclado') // teclado | recentes | menu
  const [historico, setHistorico] = useState(getHistorico())
  const [discar, setDiscar] = useState('')
  const [chamadaEstado, setChamadaEstado] = useState(null) // saindo | tocando | recebendo | ativa
  const [chamadaDe, setChamadaDe] = useState('')
  const [duracao, setDuracao] = useState(0)
  const [mudo, setMudo] = useState(false)

  const [registrado, setRegistrado] = useState(null) // diagnóstico: registrou pra RECEBER?
  const [ultimoEvento, setUltimoEvento] = useState('') // diagnóstico: último evento do SDK

  const clientRef = useRef(null)
  const callRef = useRef(null)
  const timerRef = useRef(null)
  const infoRef = useRef(null) // dados da ligação atual (pro histórico)
  const regTimerRef = useRef(null)
  const presTimerRef = useRef(null)

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
    meta.setAttribute('content', '#4a46de')
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-atendente.js', { scope: '/atendente' }).catch(() => {})
    return () => {
      if (criado) link.remove(); else if (antigo) link.setAttribute('href', antigo)
      if (metaCriado) meta.remove(); else if (metaAntigo) meta.setAttribute('content', metaAntigo)
    }
  }, [])

  const pararTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const iniciarTimer = () => { pararTimer(); setDuracao(0); timerRef.current = setInterval(() => setDuracao((d) => d + 1), 1000) }
  const encerrarUI = useCallback(() => { callRef.current = null; setChamadaEstado(null); setChamadaDe(''); setMudo(false); pararTimer() }, [])

  // Grava a ligação que acabou no histórico local.
  const registrarEfim = useCallback(() => {
    const info = infoRef.current
    if (!info) return
    infoRef.current = null
    const dur = info.atendida && info.ini ? Math.max(1, Math.round((Date.now() - info.ini) / 1000)) : 0
    setHistorico(addHistorico({ id: `${Date.now()}_${Math.round(Math.random() * 999)}`, dir: info.dir, num: info.num, atendida: !!info.atendida, dur, ts: Date.now() }))
  }, [])

  // ── Conecta o softphone (TelnyxRTC) usando o token efêmero ──
  const conectar = useCallback(async () => {
    setFase('conectando'); setErro('')
    try {
      const { login, password, numero, nome, fotoUrl } = await obterTokenWebrtc()
      if (numero || nome) { const r = { numero, nome, fotoUrl: fotoUrl || '' }; setRamal(r); salvarSessao(getSessao(), r) }
      if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } clientRef.current = null }
      // Registra com login/senha SIP (não com token JWT) — só assim o softphone RECEBE chamadas.
      const client = new TelnyxRTC({ login, password })
      client.remoteElement = 'atendente-remote-audio'
      client.enableMicrophone = true
      const prontoTimer = setTimeout(() => { setFase((f) => (f === 'conectando' ? 'erro' : f)); setErro((e) => e || 'Demorou pra conectar à voz. Toque em tentar de novo.') }, 15000)
      const checarReg = async () => { try { setRegistrado((await client.getIsRegistered?.()) ?? null) } catch { setRegistrado(null) } }
      client.on('telnyx.ready', () => {
        clearTimeout(prontoTimer); setErro(''); setFase('pronto'); checarReg()
        if (regTimerRef.current) clearInterval(regTimerRef.current); regTimerRef.current = setInterval(checarReg, 4000)
        enviarPresenca(true); if (presTimerRef.current) clearInterval(presTimerRef.current); presTimerRef.current = setInterval(() => enviarPresenca(true), 25000)
      })
      client.on('telnyx.error', () => { clearTimeout(prontoTimer); setFase((f) => (f === 'conectando' ? 'erro' : f)); setErro('Erro na conexão de voz.') })
      client.on('telnyx.socket.close', () => { /* deixa o SDK tentar reconectar */ })
      client.on('telnyx.notification', (n) => {
        try { setUltimoEvento(`${n?.type || '?'}${n?.call?.state ? ':' + n.call.state : ''}${n?.call?.direction ? '/' + n.call.direction : ''}`) } catch { /* ignore */ }
        // eslint-disable-next-line no-console
        console.log('[telnyx.notification]', n?.type, n?.call?.state, n?.call?.direction)
        if (n.type !== 'callUpdate' || !n.call) return
        const call = n.call
        const st = call.state
        const inbound = call.direction === 'inbound'
        if (st === 'hangup' || st === 'destroy') { registrarEfim(); encerrarUI(); return }
        callRef.current = call
        if (st === 'ringing' && inbound) {
          const de = call.options?.remoteCallerNumber || call.options?.callerNumber || ''
          if (!infoRef.current) infoRef.current = { dir: 'in', num: de, atendida: false, ini: 0 }
          setChamadaDe(de); setChamadaEstado('recebendo')
        } else if (st === 'active') {
          if (infoRef.current) { infoRef.current.atendida = true; infoRef.current.ini = Date.now() }
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
  }, [encerrarUI, registrarEfim])

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
    return () => { pararTimer(); if (regTimerRef.current) clearInterval(regTimerRef.current); if (presTimerRef.current) clearInterval(presTimerRef.current); if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } } }
  }, [conectar])

  const parearManual = async () => {
    const key = codigo.trim().toUpperCase()
    if (key.replace(/[^A-Z0-9]/g, '').length < 6) { setErro('Digite o código do ramal.'); return }
    setPareando(true); setErro('')
    try { const { sessao, ramal: r } = await parear(key); salvarSessao(sessao, r); setRamal(r); setCodigo(''); await conectar() }
    catch (e) { setErro(e.message) }
    finally { setPareando(false) }
  }

  const desconectar = () => {
    enviarPresenca(false) // marca offline no site na hora
    if (regTimerRef.current) { clearInterval(regTimerRef.current); regTimerRef.current = null }
    if (presTimerRef.current) { clearInterval(presTimerRef.current); presTimerRef.current = null }
    if (clientRef.current) { try { clientRef.current.disconnect() } catch { /* ignore */ } clientRef.current = null }
    limparSessao(); setRamal(null); setHistorico([]); setRegistrado(null); setFase('login'); setAba('teclado'); encerrarUI()
  }

  const ligar = (destino) => {
    const alvo = destino != null ? destino : discar
    if (!clientRef.current || fase !== 'pronto' || !alvo) return
    try {
      const e164 = normDestino(alvo)
      infoRef.current = { dir: 'out', num: e164, atendida: false, ini: 0 }
      const call = clientRef.current.newCall({ destinationNumber: e164, callerNumber: ramal?.numero, audio: true, video: false })
      callRef.current = call; setChamadaEstado('saindo')
    } catch { setErro('Não consegui iniciar a ligação.') }
  }
  const atender = () => { try { callRef.current?.answer() } catch { /* ignore */ } }
  const desligar = () => { try { callRef.current?.hangup() } catch { /* ignore */ } registrarEfim(); encerrarUI() }
  const toggleMudo = () => { try { callRef.current?.toggleAudioMute(); setMudo((v) => !v) } catch { /* ignore */ } }
  const tecla = (t) => setDiscar((v) => (v + t).slice(0, 20))
  const apagar = () => setDiscar((v) => v.slice(0, -1))
  const ligarDeVolta = (num) => { setDiscar(num); setAba('teclado') }

  // ═══════════════ RENDER ═══════════════
  const wrap = (children) => (
    <div className="min-h-screen bg-surface-50 text-stone-800 flex flex-col items-center">
      <audio id="atendente-remote-audio" autoPlay />
      <div className="w-full max-w-md flex-1 flex flex-col bg-white shadow-sm min-h-screen">{children}</div>
    </div>
  )

  if (fase === 'carregando' || pareando) {
    return wrap(<div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /><p className="text-sm">{pareando ? 'Pareando dispositivo…' : 'Carregando…'}</p></div>)
  }

  if (fase === 'login') {
    return wrap(
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
        <div className="text-center mb-8">
          <img src={logo} alt="Autsend" className="h-9 w-auto object-contain mx-auto mb-5" />
          <h1 className="text-2xl font-bold text-stone-800">Atendente</h1>
          <p className="text-sm text-stone-500 mt-1">Escaneie o QR do seu ramal ou digite o código.</p>
        </div>
        <label className="block text-xs font-medium text-stone-500 mb-2">Código do ramal</label>
        <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters"
          onKeyDown={(e) => e.key === 'Enter' && parearManual()}
          className="w-full rounded-xl bg-white border border-surface-300 px-4 py-3.5 text-center text-2xl font-black tracking-widest tabular-nums text-stone-800 focus:border-primary-500 focus:outline-none" />
        {erro && <p className="text-sm text-red-600 mt-3 text-center">{erro}</p>}
        <button onClick={parearManual} disabled={pareando} className="mt-5 w-full rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
          {pareando ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
        </button>
        <p className="text-xs text-stone-400 text-center mt-6">O acesso vale por 30 dias neste aparelho.</p>
      </div>,
    )
  }

  if (fase === 'conectando' || fase === 'erro') {
    return wrap(
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        {fase === 'erro' ? <WifiOff className="w-10 h-10 text-red-500" /> : <Loader2 className="w-10 h-10 animate-spin text-primary-600" />}
        <p className="text-sm text-stone-600">{fase === 'erro' ? (erro || 'Sem conexão de voz.') : 'Conectando à central…'}</p>
        {fase === 'erro' && <button onClick={conectar} className="rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold px-6 py-2.5">Tentar de novo</button>}
        {fase === 'erro' && <button onClick={desconectar} className="text-xs text-stone-400 underline">Sair e parear de novo</button>}
      </div>,
    )
  }

  // Tela de chamada (overlay full-screen)
  if (chamadaEstado) {
    const recebendo = chamadaEstado === 'recebendo'
    const ativa = chamadaEstado === 'ativa'
    const rotulo = recebendo ? 'Chamada recebida' : ativa ? fmtDur(duracao) : chamadaEstado === 'saindo' ? 'Chamando…' : 'Tocando…'
    const quem = recebendo ? (chamadaDe || 'Desconhecido') : discar || chamadaDe
    return wrap(
      <div className="flex-1 flex flex-col items-center justify-between py-16 px-6">
        <div className="flex flex-col items-center gap-3 mt-10">
          <div className={`w-24 h-24 rounded-full bg-surface-100 flex items-center justify-center ${recebendo ? 'animate-pulse' : ''}`}>
            {recebendo ? <PhoneIncoming className="w-10 h-10 text-primary-600" /> : <Phone className="w-10 h-10 text-stone-500" />}
          </div>
          <p className="text-2xl font-bold tabular-nums mt-2 text-stone-800">{fmtNum(quem)}</p>
          <p className={`text-sm ${ativa ? 'text-primary-600 font-semibold tabular-nums' : 'text-stone-500'}`}>{rotulo}</p>
        </div>
        <div className="flex items-center justify-center gap-8">
          {ativa && (
            <button onClick={toggleMudo} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${mudo ? 'bg-stone-800 text-white' : 'bg-surface-100 text-stone-700'}`}>
              {mudo ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
          )}
          {recebendo && (
            <button onClick={atender} className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center shadow-lg"><Phone className="w-7 h-7 text-white" /></button>
          )}
          <button onClick={desligar} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg"><PhoneOff className="w-7 h-7 text-white" /></button>
        </div>
      </div>,
    )
  }

  // ── fase pronto: abas Teclado / Recentes / Menu + bottom nav ──
  const NavBtn = ({ id, icon: Icon, label }) => (
    <button onClick={() => setAba(id)} className={`flex-1 flex flex-col items-center gap-1 py-2.5 ${aba === id ? 'text-primary-600' : 'text-stone-400'}`}>
      <Icon className="w-6 h-6" /><span className="text-[11px] font-medium">{label}</span>
    </button>
  )

  const teclado = (
    <div className="flex-1 flex flex-col justify-end px-6 pb-4">
      <div className="text-center py-6 min-h-[72px]">
        <p className="text-3xl font-bold tabular-nums break-all text-stone-800">{discar || <span className="text-stone-300">Digite um número</span>}</p>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-5 max-w-[300px] mx-auto w-full">
        {TECLAS.map((t) => (
          <button key={t} onClick={() => tecla(t)} className="h-16 rounded-full bg-surface-100 hover:bg-surface-200 text-2xl font-semibold text-stone-800 active:scale-95 transition">{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 items-center max-w-[300px] mx-auto w-full">
        <div />
        <button onClick={() => ligar()} disabled={!discar} className="w-16 h-16 mx-auto rounded-full bg-green-500 hover:bg-green-600 disabled:opacity-30 flex items-center justify-center shadow-lg"><Phone className="w-7 h-7 text-white" /></button>
        <button onClick={apagar} disabled={!discar} className="w-12 h-12 mx-auto rounded-full flex items-center justify-center text-stone-400 disabled:opacity-30"><Delete className="w-6 h-6" /></button>
      </div>
    </div>
  )

  const recentes = (
    <div className="flex-1 overflow-y-auto">
      <h2 className="text-sm font-semibold text-stone-500 px-5 pt-4 pb-2">Recentes</h2>
      {historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-stone-400 py-20">
          <Clock className="w-8 h-8" /><p className="text-sm">Nenhuma ligação ainda.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-100">
          {historico.map((h) => {
            const perdida = h.dir === 'in' && !h.atendida
            const Icon = perdida ? PhoneMissed : h.dir === 'in' ? PhoneIncoming : PhoneOutgoing
            const cor = perdida ? 'text-red-500' : h.dir === 'in' ? 'text-green-600' : 'text-stone-500'
            const sub = perdida ? 'Perdida' : h.atendida ? fmtDur(h.dur) : 'Não atendida'
            return (
              <li key={h.id}>
                <button onClick={() => ligarDeVolta(h.num)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-50 text-left">
                  <Icon className={`w-5 h-5 shrink-0 ${cor}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold tabular-nums truncate ${perdida ? 'text-red-600' : 'text-stone-800'}`}>{fmtNum(h.num)}</p>
                    <p className="text-xs text-stone-400">{sub} · {fmtQuando(h.ts)}</p>
                  </div>
                  <Phone className="w-4 h-4 text-primary-500 shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const menu = (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt="Autsend" className="h-7 w-auto object-contain mb-6" />
        <div className="w-24 h-24 rounded-full bg-primary-50 flex items-center justify-center mb-3 overflow-hidden ring-2 ring-primary-100">
          {ramal?.fotoUrl ? <img src={ramal.fotoUrl} alt={ramal?.nome || ''} className="w-full h-full object-cover" /> : <Phone className="w-9 h-9 text-primary-600" />}
        </div>
        <p className="text-xl font-bold text-stone-800">{ramal?.nome || 'Ramal'}</p>
        <p className="text-sm text-stone-500 tabular-nums flex items-center gap-1.5 mt-1"><Wifi className="w-3.5 h-3.5 text-green-500" /> {fmtNum(ramal?.numero)}</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Conectado</span>
      </div>
      {/* Diagnóstico (temporário) — mostra se o app registrou pra RECEBER chamadas */}
      <div className="mt-8 rounded-xl bg-surface-50 border border-surface-200 p-3 text-left">
        <p className="text-xs font-semibold text-stone-600 mb-1.5">Diagnóstico</p>
        <p className="text-xs text-stone-500 flex items-center gap-1.5">
          Recebimento:
          {registrado === true ? <span className="font-semibold text-green-600">✓ registrado</span>
            : registrado === false ? <span className="font-semibold text-red-500">✗ não registrado</span>
              : <span className="text-stone-400">verificando…</span>}
        </p>
        <p className="text-xs text-stone-400 mt-1 truncate">Último evento: {ultimoEvento || '—'}</p>
      </div>
      <button onClick={desconectar} className="mt-6 w-full rounded-xl border border-red-200 bg-red-50 text-red-600 font-semibold py-3.5 flex items-center justify-center gap-2 hover:bg-red-100">
        <LogOut className="w-5 h-5" /> Desconectar este aparelho
      </button>
      <p className="text-xs text-stone-400 text-center mt-3">Você precisará do QR/código pra entrar de novo.</p>
    </div>
  )

  return wrap(
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header: logo + nome + número do ramal */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-200 shrink-0">
        <img src={logo} alt="Autsend" className="h-6 w-auto object-contain shrink-0" />
        <div className="border-l border-surface-200 pl-3 min-w-0">
          <p className="font-semibold text-stone-800 truncate leading-tight">{ramal?.nome || 'Ramal'}</p>
          <p className="text-xs text-stone-500 tabular-nums flex items-center gap-1.5"><Wifi className="w-3 h-3 text-green-500" /> {fmtNum(ramal?.numero)}</p>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {aba === 'teclado' ? teclado : aba === 'recentes' ? recentes : menu}
      </div>
      <nav className="flex items-stretch border-t border-surface-200 bg-white shrink-0">
        <NavBtn id="teclado" icon={Grid3x3} label="Teclado" />
        <NavBtn id="recentes" icon={Clock} label="Recentes" />
        <NavBtn id="menu" icon={MenuIcon} label="Menu" />
      </nav>
    </div>,
  )
}

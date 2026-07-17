import { createContext, useContext, useEffect, useState } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from './firebase'
import { getMeuPlano } from './admin'
import { planoEfetivo } from './plans'

const Ctx = createContext(null)

// Fora do provedor (ex.: tela de login) devolve tudo liberado.
export function usePlano() {
  return useContext(Ctx) || { loading: false, isAdmin: false, plano: 'free', status: 'approved', features: null, limites: null, temFeature: () => true, termosAceito: true, marcarTermosAceito: () => {}, fotoURL: null, setFotoURL: () => {} }
}

export function PlanoProvider({ children }) {
  const [user] = useAuthState(auth)
  const [state, setState] = useState({ loading: true, isAdmin: false, plano: 'free', status: 'approved', features: null, limites: null, termosAceito: true, nome: '', documento: '', emailCliente: '', fotoURL: null, temSmsApi: false, temCallVoz: false, callMin: 0 })

  useEffect(() => {
    if (!user?.uid) { setState((s) => ({ ...s, loading: false })); return }
    const cacheKey = `sendlyPlano:${user.uid}`
    // usa o cache pra não “piscar” recursos ao carregar
    try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c) setState({ ...c, loading: true }) } catch { /* ignore */ }
    getMeuPlano()
      .then((r) => {
        const ef = planoEfetivo({ plano: r.plano, overrides: r.overrides })
        // Instâncias avulsas compradas somam ao limite do plano/override.
        const extras = Number(r.instanciasExtras) || 0
        if (extras) ef.limites = { ...ef.limites, instancias: (Number(ef.limites.instancias) || 0) + extras }
        const st = { loading: false, isAdmin: !!r.isAdmin, plano: r.plano, status: r.status || 'approved', features: r.isAdmin ? null : ef.features, limites: ef.limites, termosAceito: !!r.isAdmin || r.termosAceito !== false, nome: r.nome || '', documento: r.documento || '', emailCliente: r.email || (user.email || ''), fotoURL: r.fotoURL || null, temSmsApi: !!r.temSmsApi, temCallVoz: !!r.temCallVoz, callMin: r.callMin ?? 0 }
        setState(st)
        try { localStorage.setItem(cacheKey, JSON.stringify(st)) } catch { /* ignore */ }
      })
      .catch(() => setState((s) => ({ ...s, loading: false })))
  }, [user?.uid])

  const marcarTermosAceito = () => setState((s) => {
    const next = { ...s, termosAceito: true }
    try { localStorage.setItem(`sendlyPlano:${user?.uid}`, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })

  // Atualiza a foto de perfil no contexto (reflete no menu na hora, sem recarregar).
  const setFotoURL = (url) => setState((s) => {
    const next = { ...s, fotoURL: url || null }
    try { localStorage.setItem(`sendlyPlano:${user?.uid}`, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })

  // Admin ou enquanto carrega (features null) = liberado. Só bloqueia o que estiver explicitamente false.
  const temFeature = (key) => state.isAdmin || !state.features || state.features[key] !== false
  // Quantas unidades o plano libera (admin = ilimitado). Retorna Infinity quando sem limite.
  const limiteDe = (key) => {
    if (state.isAdmin) return Infinity
    const v = state.limites?.[key]
    return v == null ? Infinity : Number(v)
  }
  // true se ainda pode criar mais (atual < limite).
  const podeMais = (key, atual) => limiteDe(key) === 0 ? false : (atual < limiteDe(key))

  return <Ctx.Provider value={{ ...state, temFeature, limiteDe, podeMais, marcarTermosAceito, setFotoURL }}>{children}</Ctx.Provider>
}
